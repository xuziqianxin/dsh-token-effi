/**
 * 校准脚本：用人工标注当标准答案，量「自动判定」的准确率与 κ。
 *
 * 不依赖 DSH 运行时：直接读 ~/.dsh/sessions 下的会话日志。
 *
 * 用法：node scripts/calibrate.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { analyze } from '../analyze.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const SESSIONS_ROOT = join(HOME, 'sessions');

// ── 日志读取 ──────────────────────────────────────────────────────────────

function decodeLog(file) {
  const buf = readFileSync(file);
  if (!file.endsWith('.zstd')) return buf.toString('utf8');
  const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  const offsets = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offsets.push(i);
  }
  if (!offsets.length) return '';
  const parts = [];
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8')); } catch { /* 残帧 */ }
  }
  return parts.join('');
}

function loadEvents(dir, files) {
  const bySeq = new Map();
  for (const f of files) {
    const text = decodeLog(join(dir, f));
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let ev;
      try { ev = JSON.parse(t); } catch { continue; }
      if (typeof ev.seq !== 'number') continue;
      const prev = bySeq.get(ev.seq);
      if (!prev || (ev.time || 0) >= (prev.time || 0)) bySeq.set(ev.seq, ev);
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function discover() {
  const out = new Map();
  if (!existsSync(SESSIONS_ROOT)) return out;
  for (const ws of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue;
    const base = join(SESSIONS_ROOT, ws.name);
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue;
      const dir = join(base, entry.name);
      let files;
      try {
        files = readdirSync(dir).filter((f) => f.startsWith('session') && (f.endsWith('.jsonl') || f.endsWith('.jsonl.zstd')));
      } catch { continue; }
      if (files.length) out.set(entry.name.replace(/^session-/, ''), { dir, files });
    }
  }
  return out;
}

// ── 文本特征 ──────────────────────────────────────────────────────────────

const { autoJudge } = await import('../auto.js');
// ── 指标 ──────────────────────────────────────────────────────────────────

const CLASSES = ['accept', 'nitpick', 'change', 'ambiguous'];

function kappa(pairs) {
  const n = pairs.length;
  if (!n) return 0;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const pa = {}; const pb = {};
  for (const [a, b] of pairs) { pa[a] = (pa[a] || 0) + 1; pb[b] = (pb[b] || 0) + 1; }
  let pe = 0;
  for (const c of CLASSES) pe += ((pa[c] || 0) / n) * ((pb[c] || 0) / n);
  return pe === 1 ? 1 : (agree - pe) / (1 - pe);
}

function report(pairs) {
  const n = pairs.length;
  if (!n) { console.log('没有可对比的样本'); return; }
  console.log(`样本 ${n} 条｜一致 ${pairs.filter(([a, b]) => a === b).length} 条｜κ = ${kappa(pairs).toFixed(3)}`);
  console.log('\n混淆矩阵（行=人工，列=自动）');
  console.log('          ' + CLASSES.map((c) => c.padEnd(10)).join(''));
  for (const a of CLASSES) {
    const row = CLASSES.map((b) => pairs.filter(([x, y]) => x === a && y === b).length);
    console.log(a.padEnd(10) + row.map((v) => String(v).padEnd(10)).join(''));
  }
  console.log('\n每类（人工为基准）');
  for (const c of CLASSES) {
    const total = pairs.filter(([a]) => a === c).length;
    const right = pairs.filter(([a, b]) => a === c && b === c).length;
    const called = pairs.filter(([, b]) => b === c).length;
    const prec = called ? pairs.filter(([a, b]) => a === c && b === c).length / called : 0;
    console.log(`  ${c.padEnd(10)} 召回 ${total ? (right / total * 100).toFixed(0).padStart(3) : '  -'}% (${right}/${total})   精确 ${called ? (prec * 100).toFixed(0).padStart(3) : '  -'}%`);
  }

  // 二分类：返工（nitpick+change）vs 非返工 —— 这才是效费比真正依赖的拆分
  const isR = (c) => c === 'nitpick' || c === 'change';
  const tp = pairs.filter(([a, b]) => isR(a) && isR(b)).length;
  const fp = pairs.filter(([a, b]) => !isR(a) && isR(b)).length;
  const fn = pairs.filter(([a, b]) => isR(a) && !isR(b)).length;
  const tn = pairs.filter(([a, b]) => !isR(a) && !isR(b)).length;
  const prec = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  console.log(`\n返工二分类：精确 ${(prec * 100).toFixed(0)}%｜召回 ${(rec * 100).toFixed(0)}%｜漏检 ${fn} 条｜误报 ${fp} 条（TP ${tp} / FP ${fp} / FN ${fn} / TN ${tn}）`);
}

// ── 主流程 ────────────────────────────────────────────────────────────────

const storePath = join(HOME, 'token-effi', 'labels.json');
if (!existsSync(storePath)) { console.log('没有标注文件：', storePath); process.exit(1); }
const store = JSON.parse(readFileSync(storePath, 'utf8'));
const entries = Array.isArray(store.entries) ? store.entries : [];

const bySession = new Map();
for (const e of entries) {
  if (!e || typeof e.sessionId !== 'string' || !Number.isFinite(e.turn)) continue;
  if (!CLASSES.includes(e.human)) continue;
  const id = String(e.sessionId).replace(/^session-/, '');
  if (!bySession.has(id)) bySession.set(id, new Map());
  bySession.get(id).set(e.turn, e.human);
}
console.log(`标注 ${entries.length} 条，涉及 ${bySession.size} 个会话`);

const sessions = discover();
const pairs = [];
const misses = [];
let used = 0;

for (const [id, turns] of bySession) {
  const s = sessions.get(id);
  if (!s) { misses.push(id); continue; }
  const events = loadEvents(s.dir, s.files);
  if (!events.length) { misses.push(id); continue; }

  // 每个轮次的触发消息：该轮第一个请求之前最近的一条用户消息
  const promptOfTurn = new Map();
  let lastUser = '';
  let curTurn = null;
  const seenTurn = new Set();
  for (const ev of events) {
    if (ev.type === 'user/message') {
      const c = ev.data && Array.isArray(ev.data.content) ? ev.data.content.filter((b) => b.type === 'text').map((b) => b.text).join('') : '';
      lastUser = String(c || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    }
    if (ev.type === 'assistant/message' && ev.data && Number.isFinite(ev.data.turn)) {
      curTurn = ev.data.turn;
      if (!promptOfTurn.has(curTurn)) promptOfTurn.set(curTurn, lastUser);
    }
  }
  void curTurn; void seenTurn;

  const out = analyze(events, {}, `session-${id}`);
  used++;
  for (const row of out.turnRows) {
    const human = turns.get(row.turn);
    if (!human) continue;
    const auto = autoJudge({
      reason: row.reason,
      reaction: row.reaction,
      prompt: promptOfTurn.get(row.turn) || '',
      reply: row.lastText || '',
    });
    pairs.push([human, auto, { turn: row.turn, reason: row.reason, reaction: row.reaction, prompt: promptOfTurn.get(row.turn) || '', reply: row.lastText || '' }]);
  }
}

if (misses.length) console.log(`跳过 ${misses.length} 个找不到日志的会话`);
console.log(`实际参与对比 ${used} 个会话\n`);
report(pairs);

if (process.argv.includes('--misses')) {
  const isR = (c) => c === 'nitpick' || c === 'change';
  console.log('\n漏检的返工：');
  for (const [human, auto, d] of pairs) {
    if (!isR(human) || isR(auto) || !d) continue;
    console.log(`--- 人工=${human} 自动=${auto} #${d.turn} reason=${d.reason}`);
    console.log(`  触发: ${String(d.prompt).replace(/\s+/g, ' ').slice(0, 60)}`);
    console.log(`  产出: ${String(d.reply).replace(/\s+/g, ' ').slice(0, 60)}`);
    console.log(`  反应: ${String(d.reaction).replace(/\s+/g, ' ').slice(0, 90)}`);
  }
}
