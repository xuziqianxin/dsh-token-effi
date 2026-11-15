import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';

export const name = 'token-effi';
export const inject = ['connection', 'sessionQuery'];

const here = dirname(fileURLToPath(import.meta.url));

/** 随包内置的种子标注（键：会话前 8 位#轮次）。用于首次安装时就有数可看。 */
let SEED = {};
try {
  SEED = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8'));
} catch {
  SEED = {};
}

const noStore = { 'cache-control': 'no-store' };
const ok = (value) => Response.json({ ok: true, value }, { headers: noStore });
const bad = (code, message) => Response.json({ ok: false, error: { code, message } }, { headers: noStore });

/**
 * 官方约定：用户数据放在 `$DSH_HOME/<子系统>/` 下，与 dsh-office-kit 的
 * `dshHomePath('office-kit', 'outputs')` 同构。走运行时注册的同一个解析器，
 * `$DSH_HOME` 变化时自动跟随。
 */
const VALID = new Set(['accept', 'nitpick', 'change', 'ambiguous']);

/** 范围档位：天数；0 表示全部。 */
const RANGE_DAYS = { '7d': 7, '30d': 30, '365d': 365, all: 0 };

/**
 * 每个会话的最近活动时间：取会话目录里最新文件的 mtime。
 * 只做目录扫描 + stat，不解析日志；结果按 home 缓存 30 秒，切范围不会重复扫盘。
 */
const ACTIVITY_TTL = 30 * 1000;
const activityCache = new Map();

function buildActivity(home) {
  const now = Date.now();
  const cached = activityCache.get(home);
  if (cached && now - cached.at < ACTIVITY_TTL) return cached.map;

  const map = new Map();
  try {
    const root = join(home, 'sessions');
    for (const ws of readdirSync(root, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const wsDir = join(root, ws.name);
      for (const s of readdirSync(wsDir, { withFileTypes: true })) {
        if (!s.isDirectory() || !s.name.startsWith('session-')) continue;
        const id = s.name.slice('session-'.length);
        const dir = join(wsDir, s.name);
        let newest = 0;
        try {
          for (const f of readdirSync(dir)) {
            try {
              const st = statSync(join(dir, f));
              if (st.mtimeMs > newest) newest = st.mtimeMs;
            } catch { /* 单个文件读不到就跳过 */ }
          }
        } catch { /* 目录读不到就跳过 */ }
        if (newest) map.set(id, newest);
      }
    }
  } catch { /* 没有 sessions 目录就退化为 createdAt */ }
  activityCache.set(home, { at: now, map });
  return map;
}

/** Harness home：优先运行时注册的 dshHomePath，其次 DSH_HOME，最后 ~/.dsh。 */
function homeOf(ctx) {
  try {
    const f = ctx?.get ? ctx.get('dshHomePath') : undefined;
    if (typeof f === 'function') return f();
  } catch { /* 服务未就绪 */ }
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * 一次性迁移来源：<=0.1.1 把标注写在 <profile>/token-effi/ 下，更早的写在包内 data/。
 * 只在新位置还没有文件时读一次。
 */
function legacyStores(home) {
  const out = [];
  try {
    const root = join(home, 'profiles');
    for (const name of readdirSync(root)) {
      const candidate = join(root, name, 'token-effi', 'labels.json');
      if (existsSync(candidate)) out.push(candidate);
    }
  } catch { /* 没有 profiles 目录 */ }
  out.push(join(here, 'data', 'labels.json'));
  return out;
}

export function apply(ctx) {
  const evalCache = new Map();
  const home = homeOf(ctx);
  // 官方约定：<home>/token-effi/labels.json
  const storePath = join(home, 'token-effi', 'labels.json');
  const LEGACY = legacyStores(home);
  ctx.logger?.info?.(`token-effi: 标注仓库 = ${storePath}`);

  /**
   * 标注仓库：条目是 { key, sessionId, turn, human, note, updatedAt }。
   * key 是给人看的「会话名#轮次」；sessionId + turn 是索引，合并时按它转义。
   */
  let entries = [];
  let bySession = new Map();

  const reindex = () => {
    bySession = new Map();
    for (const e of entries) {
      if (!e || typeof e.sessionId !== 'string' || !Number.isFinite(e.turn)) continue;
      if (!VALID.has(e.human)) continue;
      let m = bySession.get(e.sessionId);
      if (!m) { m = new Map(); bySession.set(e.sessionId, m); }
      m.set(e.turn, { h: e.human, n: e.note || '', key: e.key });
    }
  };

  const load = () => {
    entries = [];
    try {
      if (existsSync(storePath)) {
        try {
          const raw = JSON.parse(readFileSync(storePath, 'utf8'));
          entries = Array.isArray(raw && raw.entries) ? raw.entries : [];
        } catch (parseError) {
          // 文件坏了：先原样备份，再当空表继续。绝不静默覆盖，数据还能从备份捞回来。
          const backup = `${storePath}.corrupt-${Date.now()}`;
          try {
            copyFileSync(storePath, backup);
            ctx.logger?.warn?.(`token-effi: 标注文件解析失败，已备份到 ${backup}（${String(parseError)}）`);
          } catch {
            ctx.logger?.warn?.(`token-effi: 标注文件解析失败且备份失败（${String(parseError)}）`);
          }
          entries = [];
        }
      } else {
        // 一次性迁移：老版本把标注放在 profile 或包内 data/ 下
        for (const legacy of LEGACY) {
          try {
            if (!existsSync(legacy) || legacy === storePath) continue;
            const raw = JSON.parse(readFileSync(legacy, 'utf8'));
            const moved = Array.isArray(raw && raw.entries) ? raw.entries : [];
            if (!moved.length) continue;
            entries = moved;
            if (save()) {
              ctx.logger?.info?.(`token-effi: 已从 ${legacy} 迁移 ${moved.length} 条标注到 ${storePath}`);
              break;
            }
          } catch { /* 试下一个 */ }
        }
      }
    } catch { entries = []; }
    reindex();
  };

  /** 原子写入：先写临时文件再 rename，避免中途失败把原文件截断成空。 */
  const save = () => {
    const tmp = `${storePath}.tmp-${process.pid}`;
    try {
      mkdirSync(dirname(storePath), { recursive: true });
      writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 1), 'utf8');
      renameSync(tmp, storePath);
      return true;
    } catch (error) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* 清理失败无所谓 */ }
      ctx.logger?.warn?.(`token-effi: 写入标注失败 ${String(error)}`);
      return false;
    }
  };

  load();
  ctx.logger?.info?.(`token-effi: 标注仓库 ${storePath}（种子 ${Object.keys(SEED).length} 条，本地 ${entries.length} 条）`);

  /** 某个会话的标注，转成 analyze 认的 `prefix#turn` 形态。 */
  const labelsFor = (sessionId) => {
    const prefix = String(sessionId).replace(/^session-/, '').slice(0, 8);
    const out = {};
    for (const [k, v] of Object.entries(SEED)) out[k] = v;
    const m = bySession.get(sessionId);
    if (m) for (const [turn, v] of m) out[`${prefix}#${turn}`] = { h: v.h, n: v.n };
    return out;
  };

  ctx.inject(['connection'], (scoped) => {
    const connection = scoped.get('connection');
    const register = typeof connection?.fetch?.register === 'function'
      ? connection.fetch.register.bind(connection.fetch)
      : undefined;
    if (!register) {
      ctx.logger?.warn?.('token-effi: connection.fetch.register is unavailable');
      return;
    }

    const readBody = async (request) => {
      try { return await request.json(); } catch { return null; }
    };

    // ── 会话账本 ────────────────────────────────────────────────────
    const evalRoute = async (request) => {
      const body = await readBody(request);
      const sessionId = body && body.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '') return bad('token-effi/bad-request', 'missing sessionId');
      const noCache = Boolean(body && body.noCache);
      try {
        const snapshot = await ctx.sessionQuery.readSession(sessionId);
        const events = snapshot.events;
        const cursor = events.length ? events[events.length - 1].seq : -1;
        const hit = evalCache.get(sessionId);
        if (!noCache && hit && hit.cursor === cursor) return ok(hit.value);

        let title = '';
        try {
          const t = await ctx.sessionQuery.readTitle(sessionId);
          title = (t && t.title) || '';
        } catch { /* 标题只是给标注用的名字 */ }

        const value = analyze(events, labelsFor(sessionId), sessionId);
        value.session = {
          id: sessionId,
          title: title || `${sessionId.slice(0, 8)}`,
          cwd: snapshot.session?.cwd || '',
        };
        evalCache.set(sessionId, { cursor, value });
        if (evalCache.size > 32) evalCache.delete(evalCache.keys().next().value);
        return ok(value);
      } catch (error) {
        return bad('token-effi/analyze-failed', error instanceof Error ? error.message : String(error));
      }
    };

    // ── 会话清单（按最近活动时间筛范围）──────────────────────────────
    const listRoute = async (request) => {
      const body = await readBody(request);
      const range = body && typeof body.range === 'string' && Object.hasOwn(RANGE_DAYS, body.range) ? body.range : '7d';
      const days = RANGE_DAYS[range];
      const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
      try {
        const records = await ctx.sessionQuery.listSessions();
        const activity = buildActivity(home);
        const kept = records
          .map((r) => ({ r, at: activity.get(r.header.id) || r.header.createdAt }))
          .filter((x) => x.at >= cutoff)
          .sort((a, b) => b.at - a.at)
          .slice(0, 60);

        const items = await Promise.all(kept.map(async ({ r, at }) => {
          let title = '';
          try {
            const t = await ctx.sessionQuery.readTitle(r.header.id);
            title = (t && t.title) || '';
          } catch { /* 标题只是装饰 */ }
          return {
            id: r.header.id,
            title,
            cwd: r.header.cwd || '',
            createdAt: r.header.createdAt,
            activeAt: at,
            live: Boolean(r.live),
          };
        }));
        return ok({ range, total: records.length, items });
      } catch (error) {
        return bad('token-effi/list-failed', error instanceof Error ? error.message : String(error));
      }
    };

    // ── 写一条标注 ──────────────────────────────────────────────────
    const labelRoute = async (request) => {
      const body = await readBody(request);
      if (!body) return bad('token-effi/bad-request', 'body is not JSON');
      const { sessionId, turn, human, note, key } = body;
      if (typeof sessionId !== 'string' || sessionId === '') return bad('token-effi/bad-request', 'missing sessionId');
      if (!Number.isFinite(turn)) return bad('token-effi/bad-request', 'missing turn');
      if (!VALID.has(human)) return bad('token-effi/bad-request', `bad human label: ${human}`);

      let title = '';
      try {
        const t = await ctx.sessionQuery.readTitle(sessionId);
        title = (t && t.title) || '';
      } catch { /* 忽略 */ }
      const readable = typeof key === 'string' && key ? key : `${title || sessionId.slice(0, 8)}#${turn}`;

      const at = Date.now();
      const idx = entries.findIndex((e) => e.sessionId === sessionId && e.turn === turn);
      const entry = {
        key: readable,
        sessionId,
        sessionTitle: title,
        turn,
        human,
        note: typeof note === 'string' ? note : '',
        updatedAt: at,
      };
      if (idx >= 0) entries[idx] = entry; else entries.push(entry);
      reindex();
      if (!save()) {
        ctx.logger?.warn?.(`token-effi: 写标注失败 path=${storePath}`);
        return bad('token-effi/write-failed', `写标注文件失败：${storePath}`);
      }
      ctx.logger?.info?.(`token-effi: 标注已存 ${readable} -> ${human} (共 ${entries.length} 条)`);
      evalCache.delete(sessionId);
      return ok({ key: readable, sessionId, turn, human, total: entries.length });
    };

    // ── 标注表：给页面渲染「已标」与路径 ──────────────────────────────
    const labelsRoute = async () => {
      // 只数自己的标注：种子是随包发的样例，对别人的会话不会命中，不该算进进度
      const owned = new Set();
      for (const e of entries) {
        if (!e || typeof e.sessionId !== 'string' || !Number.isFinite(e.turn)) continue;
        if (!VALID.has(e.human)) continue;
        owned.add(`${String(e.sessionId).replace(/^session-/, '').slice(0, 8)}#${e.turn}`);
      }
      let exists = false;
      try { exists = existsSync(storePath); } catch { exists = false; }
      return ok({
        path: storePath,
        exists,
        labelled: owned.size,
        stored: entries.length,
        seed: Object.keys(SEED).length,
        entries: entries.map((e) => ({
          key: e.key, sessionId: e.sessionId, sessionTitle: e.sessionTitle || '',
          turn: e.turn, human: e.human, note: e.note || '', updatedAt: e.updatedAt,
        })),
      });
    };

    ctx.effect(() => register({
      path: '/api/token-effi/eval',
      methods: ['POST'], requestBody: 'buffered', fetch: evalRoute,
    }), 'token-effi: eval route');

    ctx.effect(() => register({
      path: '/api/token-effi/sessions',
      methods: ['POST'], requestBody: 'buffered', fetch: listRoute,
    }), 'token-effi: sessions route');

    ctx.effect(() => register({
      path: '/api/token-effi/label',
      methods: ['POST'], requestBody: 'buffered', fetch: labelRoute,
    }), 'token-effi: label route');

    ctx.effect(() => register({
      path: '/api/token-effi/labels',
      methods: ['POST'], requestBody: 'buffered', fetch: () => labelsRoute(),
    }), 'token-effi: labels route');
  });
}
