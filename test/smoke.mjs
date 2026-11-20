/**
 * 冒烟测试：不需要 DSH 运行时。
 *
 * 用 stub ctx 把宿主插件挂起来，然后：
 *   1. 逐个调用四个 HTTP 路由，断言没有抛异常且 ok:true
 *   2. 构造损坏的标注文件，断言不会覆盖、且会另存备份
 *   3. 构造缺 turn 的事件，断言不会产生「第 -1 轮」
 *
 * 用法：node test/smoke.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');

let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

/** 挂载插件，返回路由表与调用器。 */
async function mount({ home, sessions = [], titles = {} }) {
  const mod = await import(`file:///${pkg.replace(/\\/g, '/')}/index.js?t=${Date.now()}`);
  const routes = new Map();
  const ctx = {
    effect: (fn) => fn(),
    inject: (deps, cb) => cb(ctx),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    connection: { fetch: { register: (cfg) => { routes.set(cfg.path, cfg); return () => {}; } } },
    sessionQuery: {
      listSessions: async () => sessions,
      readTitle: async (id) => ({ title: titles[id] || '' }),
      readSession: async (id) => ({ events: [], session: { id, cwd: '' } }),
    },
  };
  ctx.get = (n) => (n === 'connection' ? ctx.connection : n === 'dshHomePath' ? (() => home) : undefined);
  mod.apply(ctx);

  const call = async (path, body) => {
    const cfg = routes.get(path);
    if (!cfg) throw new Error(`路由未注册: ${path}`);
    const req = new Request('http://x' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const res = await cfg.fetch(req);
    return JSON.parse(await res.text());
  };
  return { routes, call };
}

const tmpHome = mkdtempSync(join(tmpdir(), 'token-effi-smoke-'));
try {
  // ── 0. 打包清单：每个顶层 .js / 文档都必须在 files 里 ──────────────
  console.log('打包清单');
  {
    const pkgJson = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    const files = Array.isArray(pkgJson.files) ? pkgJson.files : [];
    const topJs = readdirSync(pkg).filter((f) => f.endsWith('.js'));
    const missing = topJs.filter((f) => !files.includes(f));
    check('每个顶层 .js 都列在 files 里', missing.length === 0, `缺: ${missing.join(', ')}`);
    for (const f of ['README.md', 'LICENSE']) {
      check(`${f} 在 files 里`, files.includes(f));
    }
    check('test/ 和 scripts/ 不打进包', !files.some((f) => f.startsWith('test') || f.startsWith('scripts')));
  }

  // ── 1. 四个路由 ────────────────────────────────────────────────────
  console.log('路由');
  {
    const { routes, call } = await mount({
      home: tmpHome,
      sessions: [
        { header: { id: 'session-aaaa1111', createdAt: Date.now() - 3600e3, cwd: 'D:/a' }, live: true },
        { header: { id: 'session-bbbb2222', createdAt: Date.now() - 400 * 86400e3, cwd: 'D:/b' } },
      ],
      titles: { 'session-aaaa1111': '近的会话', 'session-bbbb2222': '远的会话' },
    });
    check('四条路由都注册了', routes.size === 4, [...routes.keys()].join(','));

    const r7 = await call('/api/token-effi/sessions', { range: '7d' });
    check('sessions 7d 返回 ok', r7.ok === true, JSON.stringify(r7).slice(0, 120));
    check('sessions 7d 只留近的会话', r7.ok && r7.value.items.length === 1, JSON.stringify(r7.value?.items?.length));

    const rAll = await call('/api/token-effi/sessions', { range: 'all' });
    check('sessions all 保留两个', rAll.ok && rAll.value.items.length === 2, String(rAll.value?.items?.length));

    const rBad = await call('/api/token-effi/sessions', { range: 'toString' });
    check('range 传原型链属性不会炸', rBad.ok === true && rBad.value.range === '7d', JSON.stringify(rBad.value?.range));

    const rLabels = await call('/api/token-effi/labels', {});
    check('labels 返回路径与计数', rLabels.ok && rLabels.value.path === join(tmpHome, 'token-effi', 'labels.json'), rLabels.value?.path);
    check('空仓库 labelled = 0', rLabels.ok && rLabels.value.labelled === 0, String(rLabels.value?.labelled));

    const rEval = await call('/api/token-effi/eval', { sessionId: 'session-aaaa1111' });
    check('eval 空事件不炸', rEval.ok === true, JSON.stringify(rEval).slice(0, 120));

    const rBadEval = await call('/api/token-effi/eval', {});
    check('eval 缺 sessionId 返回错误', rBadEval.ok === false && rBadEval.error.code === 'token-effi/bad-request');

    const rLabel = await call('/api/token-effi/label', { sessionId: 'session-aaaa1111', turn: 3, human: 'nitpick' });
    check('label 写入成功', rLabel.ok === true, JSON.stringify(rLabel).slice(0, 120));
    check('写入后 labelled = 1', (await call('/api/token-effi/labels', {})).value.labelled === 1);

    const rBadLabel = await call('/api/token-effi/label', { sessionId: 'session-aaaa1111', turn: 3, human: 'nope' });
    check('拒绝非法标签值', rBadLabel.ok === false);

    const store = join(tmpHome, 'token-effi', 'labels.json');
    const raw = JSON.parse(readFileSync(store, 'utf8'));
    check('落盘内容正确', raw.entries.length === 1 && raw.entries[0].human === 'nitpick', JSON.stringify(raw).slice(0, 120));
    check('没有残留 .tmp 文件', readdirSync(join(tmpHome, 'token-effi')).every((f) => !f.includes('.tmp-')), readdirSync(join(tmpHome, 'token-effi')).join(','));
  }

  // ── 2. 损坏文件：备份而不是覆盖 ────────────────────────────────────
  console.log('损坏文件');
  {
    const home = mkdtempSync(join(tmpdir(), 'token-effi-corrupt-'));
    const dir = join(home, 'token-effi');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'labels.json'), '{ this is not json', 'utf8');

    const { call } = await mount({ home, sessions: [] });
    const r = await call('/api/token-effi/labels', {});
    check('坏文件不会让插件崩', r.ok === true);
    check('坏文件当作空表', r.value.labelled === 0, String(r.value.labelled));

    const backups = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    check('坏文件被另存为备份', backups.length === 1, readdirSync(dir).join(','));
    if (backups.length) {
      check('备份保留了原始内容', readFileSync(join(dir, backups[0]), 'utf8') === '{ this is not json');
    }
    rmSync(home, { recursive: true, force: true });
  }

  // ── 3. 缺 turn 的事件不产生「-1 轮」─────────────────────────────────
  console.log('轮次边界');
  {
    const { analyze } = await import(`file:///${pkg.replace(/\\/g, '/')}/analyze.js?t=${Date.now()}`);
    const events = [
      { seq: 1, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }] } },
      {
        seq: 2, time: Date.now(), type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'ok' }] }, usage: { inputTokens: 100, outputTokens: 10 } },
      },
      {
        seq: 3, time: Date.now(), type: 'assistant/message',
        data: { turn: 0, message: { content: [{ type: 'text', text: 'ok2' }] }, usage: { inputTokens: 50, outputTokens: 5 } },
      },
    ];
    const out = analyze(events, {}, 'session-x');
    check('没有 turn -1 的伪轮次', out.turnRows.every((r) => r.turn >= 0), JSON.stringify(out.turnRows.map((r) => r.turn)));
    check('仍在统计范围内', out.turnRows.length === 1, String(out.turnRows.length));

    const relabeled = analyze(events, { 'x#' : null }, 'session-x');
    check('空标注不影响结构口径', relabeled.turnRows.length === 1);

    // 全返工：没有有效轮次时不给假比值
    const allBad = analyze(
      [
        { seq: 1, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: 'go' }] } },
        {
          seq: 2, time: Date.now(), type: 'assistant/message',
          data: { turn: 0, message: { content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 10, outputTokens: 5 } },
        },
        { seq: 3, time: Date.now(), type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
      ],
      { 'x#0': { h: 'nitpick' } },
      'session-x',
    );
    check('全返工时 inverse 为 null', allBad.effectiveness.et.inverse === null, String(allBad.effectiveness.et.inverse));
    check('全返工时 unitCost 为 null', allBad.effectiveness.unitCost === null, String(allBad.effectiveness.unitCost));
    check('全返工时 ratio 为 0', allBad.effectiveness.et.ratio === 0, String(allBad.effectiveness.et.ratio));

    // 不标注也要出数：自动口径必须存在
    const noLabels = analyze(
      [
        { seq: 1, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: '帮我写个脚本' }] } },
        {
          seq: 2, time: Date.now(), type: 'assistant/message',
          data: { turn: 0, message: { content: [{ type: 'text', text: '写好了' }] }, usage: { inputTokens: 10, outputTokens: 5 } },
        },
        { seq: 3, time: Date.now(), type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
        { seq: 4, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: '还是不行，报错了' }] } },
      ],
      {},
      'session-y',
    );
    check('没有标注时 effectiveness 为 null', noLabels.effectiveness === null);
    check('没有标注时 auto 仍然有数', noLabels.auto !== null && noLabels.auto.covered === 1, JSON.stringify(noLabels.auto?.covered));
    check('自动判定把「还是不行」判成返工', noLabels.turnRows[0].auto === 'nitpick', noLabels.turnRows[0].auto);
    check('自动口径给出比例', typeof noLabels.auto.et.ratio === 'number' && noLabels.auto.et.ratio >= 0 && noLabels.auto.et.ratio <= 1, String(noLabels.auto.et.ratio));
    check('自动口径带校准参数', noLabels.auto.calibration.recall === 0.71 && noLabels.auto.calibration.precision === 0.87);

    // 没有下一句 → 自动判为未表态
    const noReaction = analyze(
      [
        { seq: 1, time: Date.now(), type: 'user/message', data: { content: [{ type: 'text', text: '做个东西' }] } },
        {
          seq: 2, time: Date.now(), type: 'assistant/message',
          data: { turn: 0, message: { content: [{ type: 'text', text: '做好了' }] }, usage: { inputTokens: 10, outputTokens: 5 } },
        },
      ],
      {},
      'session-z',
    );
    check('没有下一句判为未表态', noReaction.turnRows[0].auto === 'ambiguous', noReaction.turnRows[0].auto);
  }
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}

console.log(failed === 0 ? '\n冒烟测试通过' : `\n冒烟测试失败：${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
