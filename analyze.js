/**
 * 会话账本分析核心：从原始会话事件算出六分量、缓存审计、轮次与效费比。
 *
 * 口径与 token-effi 探针一致：
 *   - 成本 ET = miss×1 + hit×0.1 + write×1.25 + out×4（相对权重）
 *   - 归属：provider 报的 prompt 总量按节点字符权重分摊（最大余数法，可加总守恒）
 *   - 缓存：按前缀顺序消费 cacheRead，与上一请求的公共前缀对账（最早分叉模型）
 *   - 有效/无效：按人工标注的轮次归类；没有标注就只报结构口径
 */

const W = { miss: 1, hit: 0.1, write: 1.25, out: 4 };

import { autoJudge } from './auto.js';

/** 自动判定的实测质量（scripts/calibrate.mjs，162 条人工标注）。用于偏差校正。 */
const AUTO_PRECISION = 0.87;
const AUTO_RECALL = 0.71;

const SURFACE = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);

const COMPONENT_OF = {
  'system/message': 'PREFIX_SYSTEM',
  'developer/message': 'PREFIX_DEV',
  'user/message': 'USER_TURN',
  'assistant/message': 'ASSISTANT_ECHO',
  'tool/result': 'TOOL_RESULT',
};

const COMPONENTS = [
  'TOOL_SCHEMA', 'PREFIX_SYSTEM', 'PREFIX_DEV', 'ASSISTANT_ECHO',
  'TOOL_RESULT', 'USER_TURN', 'COMPACTION', 'UNATTRIBUTED',
];

function blockChars(block) {
  if (!block) return 0;
  let n = 0;
  if (typeof block.text === 'string') n += block.text.length;
  if (typeof block.arguments === 'string') n += block.arguments.length;
  if (Array.isArray(block.content)) for (const inner of block.content) n += blockChars(inner);
  if (n === 0) n = Math.max(0, JSON.stringify(block).length - 60);
  return n;
}

function messageOf(ev) {
  if (ev.type === 'user/message') return ev.data;
  return ev.data && ev.data.message;
}

function nodeChars(ev) {
  const msg = messageOf(ev);
  if (!msg || !Array.isArray(msg.content)) return 0;
  let n = 0;
  for (const b of msg.content) n += blockChars(b);
  return n;
}

function messageText(ev) {
  const msg = messageOf(ev);
  if (!msg || !Array.isArray(msg.content)) return '';
  let s = '';
  for (const b of msg.content) if (b && b.type === 'text' && typeof b.text === 'string') s += b.text + '\n';
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/** 最大余数法：把整数 total 按权重摊到各 key，Σ 结果严格等于 total。 */
function largestRemainder(entries, total) {
  const out = new Map();
  if (!(total > 0) || !entries.length) return out;
  const sum = entries.reduce((a, e) => a + e.w, 0);
  if (!(sum > 0)) return out;
  const parts = [];
  let floorSum = 0;
  for (const e of entries) {
    const exact = (total * e.w) / sum;
    const floor = Math.floor(exact);
    floorSum += floor;
    parts.push({ key: e.key, n: floor, frac: exact - floor });
  }
  let rest = total - floorSum;
  parts.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rest && parts.length; i++) parts[i % parts.length].n++;
  for (const p of parts) out.set(p.key, (out.get(p.key) || 0) + p.n);
  return out;
}

function wilsonLower(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

/**
 * 缓存审计：prompt = 命中 + 本该命中却漏 + 新增。
 * 只把最早的分叉记到原因上，避免重复计数。
 */
function cacheAudit(requests) {
  const causes = new Map();
  const bump = (cause, tokens) => {
    const cur = causes.get(cause) || { tokens: 0, requests: 0 };
    cur.tokens += tokens; cur.requests += 1; causes.set(cause, cur);
  };
  const TTL = 60 * 60 * 1000;
  let hit = 0, cacheableMiss = 0, newContent = 0, total = 0, compared = 0, intact = 0;

  for (let i = 0; i < requests.length; i++) {
    const cur = requests[i];
    total += cur.prompt; hit += cur.hit;
    let lcpTokens = 0;
    if (i > 0) {
      const prev = requests[i - 1];
      let lcp = 0;
      while (lcp < prev.surface.length && lcp < cur.surface.length && prev.surface[lcp] === cur.surface[lcp]) lcp++;
      lcpTokens = cur.alloc.get('tools') || 0;
      for (let j = 0; j < lcp; j++) lcpTokens += cur.alloc.get('#' + cur.surface[j]) || 0;
      compared++;
      if (lcp === prev.surface.length) intact++;
    }
    const stable = Math.max(lcpTokens, cur.hit);
    const lost = Math.max(0, lcpTokens - cur.hit);
    cacheableMiss += lost;
    newContent += Math.max(0, cur.prompt - stable);
    if (lost <= 0 || i === 0) continue;

    const prev = requests[i - 1];
    let cause;
    if (lost <= 512) cause = 'block_granularity';
    else if (cur.lastReplaceSeq > prev.seq) cause = 'compaction_replace';
    else if (cur.headerKey !== prev.headerKey) cause = 'param_changed';
    else if (cur.toolsChars !== prev.toolsChars) cause = 'tools_changed';
    else if (cur.time - prev.time > TTL) cause = 'ttl_gap';
    else cause = 'provider_side';
    bump(cause, lost);
  }
  return { hit, cacheableMiss, newContent, total, compared, intact, causes: [...causes].map(([cause, v]) => ({ cause, ...v })) };
}

/**
 * 主入口。
 * @param {readonly object[]} events 会话原始事件（seq 升序）
 * @param {Record<string, {h: string, n?: string}>} labels 标注表，键为 `前8位#轮次`
 */
export function analyze(events, labels, sessionId) {
  const labelOf = labels || {};
  const prefix = String(sessionId || '').replace(/^session-/, '').slice(0, 8);
  const nodeMeta = new Map();
  let surface = [];
  let toolsChars = 0;
  let headerKey = '';
  let lastReplaceSeq = -1;
  let compactionET = 0;

  const turns = new Map();
  const userMsgs = [];
  const requests = [];
  let lastUserText = '';
  const comp = new Map(COMPONENTS.map((c) => [c, { hit: 0, miss: 0, write: 0, et: 0 }]));
  const outClass = { reasoning: 0, text: 0, toolOk: 0, toolFail: 0, other: 0 };
  let outSumAll = 0;

  // 预扫：工具调用成败
  const callError = new Map();
  for (const ev of events) {
    if (ev.type !== 'tool/result' || !ev.data) continue;
    const msg = ev.data.message;
    const id = (msg && msg.source && msg.source.callId) || (msg && msg.content && msg.content[0] && msg.content[0].toolCallId);
    if (!id) continue;
    callError.set(id, Boolean(ev.data.error) || Boolean(msg.isError) || Boolean(msg.content && msg.content.some((b) => b.isError === true)));
  }

  const turnOf = (n) => {
    if (!turns.has(n)) turns.set(n, { turn: n, requests: [], endReason: null });
    return turns.get(n);
  };

  for (const ev of events) {
    if (ev.type === 'request/header' && ev.data && ev.data.header) {
      const tools = ev.data.header.tools || [];
      toolsChars = tools.reduce((a, t) => a + JSON.stringify(t).length, 0);
      const cfg = ev.data.header.config || {};
      headerKey = `${cfg.model || ''}|${cfg.provider || ''}|${cfg.reasoningEffort || ''}`;
      continue;
    }
    if (ev.type === 'turn/end' && ev.data) {
      const t = turnOf(ev.data.turn);
      t.endReason = ev.data.reason || null;
      t.endSeq = ev.seq;
      continue;
    }
    if (ev.type === 'user/message') {
      const text = messageText(ev);
      lastUserText = text;
      userMsgs.push({ seq: ev.seq, time: ev.time, text });
      // 不 continue：它还要走下面的 surface 登记
    }
    if (ev.type === 'compaction/summary' && ev.data && ev.data.usage) {
      const u = ev.data.usage;
      const et = (u.inputTokens || 0) * W.miss + (u.cacheReadTokens || 0) * W.hit + (u.outputTokens || 0) * W.out;
      const bucket = comp.get('COMPACTION');
      bucket.miss += u.inputTokens || 0;
      bucket.hit += u.cacheReadTokens || 0;
      bucket.et += et;
      compactionET += et;
      continue;
    }

    if (SURFACE.has(ev.type)) {
      const op = ev.surfaceOp;
      if (op && typeof op === 'object' && op.op === 'replace') {
        const shadow = Array.isArray(ev.sourceEventSeqs) && ev.sourceEventSeqs.length
          ? new Set(ev.sourceEventSeqs)
          : new Set(surface.filter((s) => s >= op.start && s <= op.end));
        surface = surface.filter((s) => !shadow.has(s));
        lastReplaceSeq = ev.seq;
      }
      nodeMeta.set(ev.seq, { type: ev.type, chars: nodeChars(ev) });
      surface.push(ev.seq);
    }

    const usage = ev.data && ev.data.usage;
    if (!usage) continue;
    if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt') continue;

    const prompt = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
    const out = usage.outputTokens || 0;
    outSumAll += out;

    // 输出侧分块
    const msg = ev.data.message;
    const classChars = { reasoning: 0, text: 0, toolOk: 0, toolFail: 0, other: 0 };
    if (msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        const n = blockChars(b);
        if (b.type === 'reasoning') classChars.reasoning += n;
        else if (b.type === 'text') classChars.text += n;
        else if (b.type === 'tool-call') { if (callError.get(b.id) === true) classChars.toolFail += n; else classChars.toolOk += n; }
        else classChars.other += n;
      }
    }
    const outAlloc = largestRemainder(
      Object.entries(classChars).filter(([, w]) => w > 0).map(([key, w]) => ({ key, w })),
      out,
    );
    for (const [k, v] of outAlloc) outClass[k] += v;

    // 输入侧分摊
    const entries = [];
    if (toolsChars > 0) entries.push({ key: 'tools', w: toolsChars });
    for (const seq of surface) {
      const meta = nodeMeta.get(seq);
      if (meta && meta.chars > 0) entries.push({ key: '#' + seq, w: meta.chars });
    }
    if (!entries.length) entries.push({ key: 'tools', w: 1 });
    const alloc = largestRemainder(entries, prompt);

    let hitLeft = usage.cacheReadTokens || 0;
    const perComponent = new Map();
    const bumpC = (name, bucket, tokens) => {
      if (!tokens) return;
      if (!perComponent.has(name)) perComponent.set(name, { hit: 0, miss: 0, write: 0 });
      perComponent.get(name)[bucket] += tokens;
    };
    for (const e of entries) {
      const tokens = alloc.get(e.key) || 0;
      const take = Math.min(hitLeft, tokens);
      hitLeft -= take;
      const miss = tokens - take;
      const name = e.key === 'tools'
        ? 'TOOL_SCHEMA'
        : (COMPONENT_OF[(nodeMeta.get(Number(e.key.slice(1))) || {}).type] || 'UNATTRIBUTED');
      bumpC(name, 'hit', take);
      bumpC(name, 'miss', miss);
    }
    const write = usage.cacheWriteTokens || 0;
    if (write) bumpC('UNATTRIBUTED', 'write', write);

    let et = out * W.out;
    for (const [name, b] of perComponent) {
      const slot = comp.get(name);
      slot.hit += b.hit; slot.miss += b.miss; slot.write += b.write;
      const e = b.hit * W.hit + b.miss * W.miss + b.write * W.write;
      slot.et += e;
      et += e;
    }

    const turnNo = (ev.data && ev.data.turn) ?? -1;
    const t = turnOf(turnNo);
    if (t.promptText === undefined) t.promptText = lastUserText;
    const reply = Array.isArray(msg && msg.content)
      ? msg.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
      : '';
    if (reply) t.lastText = reply;
    t.lastSeq = ev.seq;
    t.lastTime = ev.time;
    t.requests.push({ et, prompt, out, hit: usage.cacheReadTokens || 0 });

    requests.push({
      seq: ev.seq, time: ev.time,
      prompt, hit: usage.cacheReadTokens || 0, out, et,
      surface: surface.slice(), alloc, headerKey, toolsChars, lastReplaceSeq,
    });
  }

  // ── 轮次 ──
  const turnRows = [];
  for (const t of turns.values()) {
    if (!t.requests.length || !Number.isFinite(t.turn) || t.turn < 0) continue;
    const et = t.requests.reduce((s, r) => s + r.et, 0);
    const tokens = t.requests.reduce((s, r) => s + r.prompt + r.out, 0);
    const reaction = userMsgs.find((u) => u.seq > (t.lastSeq ?? -1));
    const label = labelOf[`${prefix}#${t.turn}`];
    const reason = (t.endReason && t.endReason.kind) || 'unknown';
    turnRows.push({
      turn: t.turn, et, tokens,
      requests: t.requests.length,
      reason,
      lastText: t.lastText || '',
      reaction: reaction ? reaction.text : '',
      reactionGapMs: reaction ? Math.max(0, reaction.time - (t.lastTime || 0)) : 0,
      label: label ? label.h : '',
      note: label ? (label.n || '') : '',
      auto: autoJudge({
        reason,
        reaction: reaction ? reaction.text : '',
        prompt: t.promptText || '',
        reply: t.lastText || '',
      }),
    });
  }
  turnRows.sort((a, b) => a.turn - b.turn);

  // ── 标注口径 ──
  const by = { accept: { n: 0, et: 0, tok: 0 }, nitpick: { n: 0, et: 0, tok: 0 }, change: { n: 0, et: 0, tok: 0 }, ambiguous: { n: 0, et: 0, tok: 0 } };
  let covered = 0, coveredET = 0;
  for (const r of turnRows) {
    if (!by[r.label]) continue;
    by[r.label].n += 1; by[r.label].et += r.et; by[r.label].tok += r.tokens;
    covered += 1; coveredET += r.et;
  }

  const audit = cacheAudit(requests);
  const etTotal = turnRows.reduce((s, t) => s + t.et, 0) + compactionET;
  const strictK = turnRows.filter((t) => t.reason === 'completed').length;

  // ── 自动口径：不依赖任何标注，直接按会话信号判 ──
  const autoBy = {
    accept: { n: 0, et: 0, tok: 0 }, nitpick: { n: 0, et: 0, tok: 0 },
    change: { n: 0, et: 0, tok: 0 }, ambiguous: { n: 0, et: 0, tok: 0 },
  };
  let autoCompared = 0;
  let autoAgree = 0;
  for (const row of turnRows) {
    const slot = autoBy[row.auto];
    if (slot) { slot.n += 1; slot.et += row.et; slot.tok += row.tokens; }
    if (row.label) {
      autoCompared += 1;
      if (row.label === row.auto) autoAgree += 1;
    }
  }
  const auto = (() => {
    const acc = autoBy.accept;
    const bad = {
      n: autoBy.nitpick.n + autoBy.change.n,
      et: autoBy.nitpick.et + autoBy.change.et,
      tok: autoBy.nitpick.tok + autoBy.change.tok,
    };
    const unk = autoBy.ambiguous;
    const etAll = acc.et + bad.et + unk.et;
    const tkAll = acc.tok + bad.tok + unk.tok;
    if (!etAll) return null;

    // 判定器会漏掉一部分返工（召回 71%），所以原始比例是**上界**：真实返工只会更多。
    // 校正值同时给出，但小样本会撞到 100% 上限，只作参考，不做主口径。
    const known = acc.et + bad.et;
    const badC = Math.min(known, bad.et / AUTO_RECALL);
    const accC = Math.max(0, known - badC);
    return {
      covered: turnRows.length,
      et: {
        acc: acc.et, bad: bad.et, unk: unk.et, total: known + unk.et,
        ratio: known > 0 ? acc.et / known : null,
        inverse: acc.et > 0 ? bad.et / acc.et : null,
      },
      token: {
        acc: acc.tok, bad: bad.tok, unk: unk.tok, total: tkAll,
        ratio: (acc.tok + bad.tok) > 0 ? acc.tok / (acc.tok + bad.tok) : null,
        inverse: acc.tok > 0 ? bad.tok / acc.tok : null,
      },
      unitCost: acc.n > 0 ? etAll / Math.max(1, acc.n) : null,
      raw: {
        acc: acc.et, bad: bad.et,
        ratio: known > 0 ? acc.et / known : null,
      },
      corrected: {
        acc: accC, bad: badC,
        ratio: known > 0 ? accC / known : null,
      },
      calibration: { precision: AUTO_PRECISION, recall: AUTO_RECALL },
      agreement: autoCompared ? autoAgree / autoCompared : null,
      compared: autoCompared,
      by: autoBy,
    };
  })();

  return {
    turns: turnRows.length,
    requests: requests.length,
    etTotal,
    promptTokens: audit.total,
    outTokens: outSumAll,
    stepsPerTurn: turnRows.length ? requests.length / turnRows.length : 0,
    components: COMPONENTS
      .map((name) => ({ name, ...comp.get(name) }))
      .filter((c) => c.et > 0)
      .sort((a, b) => b.et - a.et),
    cache: {
      hit: audit.hit, cacheableMiss: audit.cacheableMiss, newContent: audit.newContent,
      total: audit.total, compared: audit.compared, intact: audit.intact,
      causes: audit.causes.sort((a, b) => b.tokens - a.tokens),
    },
    output: {
      reasoning: outClass.reasoning, text: outClass.text,
      toolOk: outClass.toolOk, toolFail: outClass.toolFail,
      total: outSumAll,
      strictEff: outSumAll > 0 ? (outClass.text + outClass.toolOk) / outSumAll : 0,
    },
    trail: {
      strictK, strictN: turnRows.length,
      strictLower: wilsonLower(strictK, turnRows.length),
      cop: strictK ? etTotal / strictK : null,
    },
    labeled: { covered, coveredET, share: turnRows.length ? covered / turnRows.length : 0, by },
    auto,
    effectiveness: (() => {
      const acc = by.accept, bad = { n: by.nitpick.n + by.change.n, et: by.nitpick.et + by.change.et, tok: by.nitpick.tok + by.change.tok }, unk = by.ambiguous;
      const etAll = acc.et + bad.et + unk.et;
      const tkAll = acc.tok + bad.tok + unk.tok;
      if (!covered || !etAll) return null;
      return {
        covered,
        et: {
          acc: acc.et, bad: bad.et, unk: unk.et, total: etAll,
          ratio: acc.et / etAll,
          // 没有有效轮次时不给「1 : 巨大数」这种假比值
          inverse: acc.et > 0 ? bad.et / acc.et : null,
        },
        token: {
          acc: acc.tok, bad: bad.tok, unk: unk.tok, total: tkAll,
          ratio: acc.tok / Math.max(1, tkAll),
          inverse: acc.tok > 0 ? bad.tok / acc.tok : null,
        },
        unitCost: acc.n > 0 ? etAll / acc.n : null,
      };
    })(),
    turnRows: turnRows
      .slice()
      .sort((a, b) => b.et - a.et)
      .slice(0, 40),
  };
}
