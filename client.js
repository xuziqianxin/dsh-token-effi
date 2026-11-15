window.__ModuleLoader__.load({
  id: 'dsh-token-effi',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo } = React;

    const C = {
      acc: '#2ec4b6', bad: '#ff5c7a', unk: '#6b7280',
      blue: '#4c8dff', orange: '#ff9f45', purple: '#b588ff', pink: '#ff6b9d', gray: '#8b8b8b',
    };
    const COMP_COLOR = {
      ASSISTANT_ECHO: C.blue, TOOL_RESULT: C.acc, TOOL_SCHEMA: C.orange,
      PREFIX_SYSTEM: C.purple, USER_TURN: C.pink, COMPACTION: C.gray,
      PREFIX_DEV: C.gray, UNATTRIBUTED: C.gray,
    };
    const LABEL_COLOR = { accept: C.acc, nitpick: C.bad, change: C.orange, ambiguous: C.unk };
    const LABEL_TEXT = { accept: '接受', nitpick: '返工', change: '换目标', ambiguous: '未表态' };

    const RANGES = [
      ['7d', '近 7 天'],
      ['30d', '近 30 天'],
      ['365d', '近 1 年'],
      ['all', '全部'],
    ];

    const TIPS = [
      '「缓存命中率 99%」听着很美——那 99% 是同一段上下文第 300 次被重发。',
      'agent 的回复有超过一半是不可用的：实测失败率 52%；把要求写明确，能降到 43%。',
      '输出 token 通常只占总量的 0.3%，却能吃掉三成成本。按 token 数算账，第一天就算歪。',
      '账单里输出只占约五分之一；就算把输出砍掉 65%，最多也只省 13%。',
      '有人把一个时间戳放进提示词开头，账单涨了 20 倍。前缀缓存只认第一个字节。',
      '跑一个特性任务：输入 970 万 token，输出 3.4 万——输入输出比约 285 : 1。',
      '把工具结果截断到 600 字符，成功率从 98.6% 掉到 47.2%，总成本反而翻倍——省 token 不等于省钱。',
      'Bash 工具会改写 12% 带代码的调用；其中 80.7% 改完照样「成功执行」，做的却是另一件事。',
      '失败的一轮有时比成功的一轮多烧 4 倍资源。它有个名字，叫「昂贵的失败」。',
      '模型每多走一步，账单加的不是「一步」，是「整份上下文」。所以长会话的成本接近平方。',
      '返工通常比第一次交付更贵：它发生在上下文已经很长的时候。',
      '上下文越长，回答越容易出错——即使全部命中缓存。省钱和保真是两件事。',
      '用「没被打断」当成功标准，等于给 96% 的轮次发奖状。',
      '推理 token 不显示给你，却常常占掉输出的一半以上——它不产出，但句句计费。',
    ];

    const fmt = (n) => {
      if (!Number.isFinite(n)) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
      return String(Math.round(n));
    };
    const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
    const short = (id) => String(id || '').slice(0, 8);

    const S = {
      wrap: {
        height: '100%', minHeight: 0, boxSizing: 'border-box',
        overflowY: 'auto', overflowX: 'hidden',
        padding: '14px 16px 60px', maxWidth: 1120, margin: '0 auto',
        fontSize: 13, lineHeight: 1.5, color: 'inherit',
      },
      top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 12px' },
      title: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14, fontWeight: 600 },
      sub: { fontSize: 11.5, opacity: 0.48, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      btn: { fontSize: 11.5, padding: '3px 11px', borderRadius: 7, border: '1px solid rgba(127,127,127,0.28)', background: 'rgba(127,127,127,0.08)', color: 'inherit', cursor: 'pointer' },
      chips: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 10, marginBottom: 12 },
      chip: { border: '1px solid rgba(127,127,127,0.20)', borderRadius: 10, padding: '9px 12px', background: 'rgba(127,127,127,0.05)' },
      chipNum: { fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
      chipLabel: { fontSize: 11, opacity: 0.5, marginTop: 1 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, marginBottom: 12 },
      card: { border: '1px solid rgba(127,127,127,0.20)', borderRadius: 11, padding: '12px 14px', background: 'rgba(127,127,127,0.04)', marginBottom: 12 },
      cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
      cardTitle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, opacity: 0.92 },
      cardMeta: { fontSize: 11, opacity: 0.45, fontVariantNumeric: 'tabular-nums' },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '3.5px 0', fontSize: 12 },
      dot: { width: 9, height: 9, borderRadius: 2.5, flex: '0 0 auto' },
      rowName: { flex: '0 0 auto', opacity: 0.82, fontSize: 11.5 },
      track: { flex: 1, height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.15)', overflow: 'hidden', minWidth: 40 },
      fill: { height: '100%', borderRadius: 3 },
      val: { flex: '0 0 auto', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.9, fontSize: 11.5, minWidth: 46 },
      valMuted: { flex: '0 0 auto', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.42, fontSize: 11, minWidth: 52 },
      big: { fontSize: 24, fontWeight: 650, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 },
      bigLabel: { fontSize: 10.5, opacity: 0.48, marginTop: 1 },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5 },
      th: { textAlign: 'left', fontWeight: 600, fontSize: 10.5, opacity: 0.45, padding: '0 8px 6px 0', borderBottom: '1px solid rgba(127,127,127,0.16)' },
      td: { padding: '5px 8px 5px 0', borderBottom: '1px solid rgba(127,127,127,0.08)', verticalAlign: 'middle' },
      pill: (color) => ({ display: 'inline-block', padding: '0 7px', borderRadius: 9, fontSize: 10.5, border: `1px solid ${color}55`, background: `${color}22`, color, whiteSpace: 'nowrap' }),
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, opacity: 0.6 },
      muted: { opacity: 0.5, fontSize: 11.5 },
      legendCell: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0' },
      srow: { display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: '1px solid transparent' },
      srowActive: { background: 'rgba(76,141,255,0.10)', border: '1px solid rgba(76,141,255,0.42)' },
    };

    const post = (path, body) => fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json());

    function Card(props) {
      return h('div', { style: { ...S.card, ...(props.style || {}) } },
        h('div', { style: S.cardHead },
          h('div', { style: S.cardTitle }, props.icon ? h('span', { style: { opacity: 0.7 } }, props.icon) : null, props.title),
          props.meta ? h('div', { style: S.cardMeta }, props.meta) : null),
        props.children);
    }

    function Chip(props) {
      return h('div', { style: S.chip },
        h('div', { style: { ...S.chipNum, color: props.color || 'inherit' } }, props.value),
        h('div', { style: S.chipLabel }, props.label));
    }

    function Donut(props) {
      const total = (props.acc + props.bad + props.unk) || 1;
      const size = 104, thick = 13, r = (size - thick) / 2, circ = 2 * Math.PI * r;
      let off = 0;
      const arcs = [[props.acc, C.acc], [props.bad, C.bad], [props.unk, C.unk]]
        .filter((s) => s[0] > 0)
        .map(([v, col]) => {
          const len = (circ * v) / total;
          const el = h('circle', {
            key: col, cx: size / 2, cy: size / 2, r, fill: 'none', stroke: col, strokeWidth: thick,
            strokeDasharray: `${len} ${circ - len}`, strokeDashoffset: -off,
            transform: `rotate(-90 ${size / 2} ${size / 2})`,
          });
          off += len;
          return el;
        });
      return h('div', { style: { position: 'relative', width: size, height: size, flex: '0 0 auto' } },
        h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
          h('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'rgba(127,127,127,0.15)', strokeWidth: thick }),
          arcs),
        h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
          h('div', { style: { fontSize: 16, fontWeight: 650, fontVariantNumeric: 'tabular-nums' } }, pct(props.centerRatio)),
          h('div', { style: { fontSize: 9.5, opacity: 0.42 } }, props.centerLabel || '')));
    }

    function LegendRow(props) {
      return h('div', { style: S.legendCell },
        h('i', { style: { ...S.dot, background: props.color } }),
        h('span', { style: { opacity: 0.8 } }, props.label),
        h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', opacity: 0.9 } }, props.value),
        props.extra ? h('span', { style: { opacity: 0.4, minWidth: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, props.extra) : null);
    }

    function BarRow(props) {
      return h('div', { style: S.row },
        h('i', { style: { ...S.dot, background: props.color } }),
        h('div', { style: S.rowName }, props.name),
        h('div', { style: S.track }, h('div', { style: { ...S.fill, background: props.color, width: Math.max(1.5, props.ratio * 100) + '%' } })),
        h('div', { style: S.val }, pct(props.ratio)),
        h('div', { style: S.valMuted }, props.note || ''));
    }

    /** 一个会话的完整卡片组：tab 和洞察页共用。 */
    function DetailGrid(props) {
      const d = props.data;
      const e = d.effectiveness;
      const compTotal = d.components.reduce((s, c) => s + c.et, 0) || 1;
      const cacheTotal = d.cache.total || 1;
      const outTotal = d.output.total || 1;

      const effCard = e
        ? h(Card, { title: '效费比', icon: '◔', meta: `${e.covered} 轮已标注` },
            h('div', { style: { display: 'flex', gap: 18, alignItems: 'center', marginBottom: 10 } },
              h(Donut, { acc: e.et.acc, bad: e.et.bad, unk: e.et.unk, centerRatio: e.et.ratio, centerLabel: '有效' }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h(LegendRow, { color: C.acc, label: '有效', value: pct(e.et.ratio), extra: fmt(e.et.acc) }),
                h(LegendRow, { color: C.bad, label: '无效', value: pct(e.et.bad / e.et.total), extra: fmt(e.et.bad) }),
                h(LegendRow, { color: C.unk, label: '未表态', value: pct(e.et.unk / e.et.total), extra: fmt(e.et.unk) }))),
            h('div', { style: { display: 'flex', gap: 22, flexWrap: 'wrap' } },
              h('div', null, h('div', { style: S.big }, pct(e.token.ratio)), h('div', { style: S.bigLabel }, '有效 token 占比')),
              h('div', null, h('div', { style: { ...S.big, color: C.bad } }, e.et.inverse === null ? '—' : `1 : ${e.et.inverse.toFixed(2)}`), h('div', { style: S.bigLabel }, `有效 : 无效（按量 ${e.token.inverse === null ? '—' : `1 : ${e.token.inverse.toFixed(2)}`}）`)),
              h('div', null, h('div', { style: S.big }, fmt(e.unitCost)), h('div', { style: S.bigLabel }, '单位有效产出成本 ET/轮'))))
        : h(Card, { title: '效费比', icon: '◔', meta: '未标注' },
            h('div', { style: S.muted }, '这个会话还没有人工标注的轮次，只能看结构口径。'),
            h('div', { style: { display: 'flex', gap: 22, marginTop: 10 } },
              h('div', null, h('div', { style: S.big }, pct(d.trail.strictN ? d.trail.strictK / d.trail.strictN : 0)), h('div', { style: S.bigLabel }, `正常结束 ${d.trail.strictK}/${d.trail.strictN} 轮`)),
              h('div', null, h('div', { style: { ...S.big, color: C.unk } }, d.trail.cop ? fmt(d.trail.cop) : '—'), h('div', { style: S.bigLabel }, 'CoP（旧口径）ET/轮'))));

      const compCard = h(Card, { title: '钱花在哪', icon: '▤', meta: `输入侧 ${fmt(compTotal)} ET` },
        d.components.map((c) => h(BarRow, {
          key: c.name, name: c.name, color: COMP_COLOR[c.name] || C.gray,
          ratio: c.et / compTotal, note: fmt(c.et),
        })));

      const cacheCard = h(Card, { title: '缓存', icon: '⛁', meta: pct(d.cache.hit / cacheTotal) },
        h(BarRow, { name: '命中', color: C.acc, ratio: d.cache.hit / cacheTotal, note: fmt(d.cache.hit) }),
        h(BarRow, { name: '本该命中却漏', color: C.bad, ratio: d.cache.cacheableMiss / cacheTotal, note: fmt(d.cache.cacheableMiss) }),
        h(BarRow, { name: '新增', color: C.unk, ratio: d.cache.newContent / cacheTotal, note: fmt(d.cache.newContent) }),
        d.cache.causes.length
          ? h('div', { style: { ...S.mono, marginTop: 8, lineHeight: 1.7 } },
              d.cache.causes.slice(0, 4).map((c) => h('div', { key: c.cause }, `${c.cause} ${fmt(c.tokens)} ×${c.requests}`)))
          : null);

      const outCard = h(Card, { title: '输出分块', icon: '◫', meta: `${fmt(d.output.total)} tok` },
        h(BarRow, { name: '正文', color: C.blue, ratio: d.output.text / outTotal, note: fmt(d.output.text) }),
        h(BarRow, { name: '工具参数', color: C.acc, ratio: (d.output.toolOk + d.output.toolFail) / outTotal, note: fmt(d.output.toolOk + d.output.toolFail) }),
        h(BarRow, { name: 'reasoning', color: C.purple, ratio: d.output.reasoning / outTotal, note: fmt(d.output.reasoning) }));

      const headRow = h('tr', null,
        h('th', { style: S.th }, '轮次'),
        h('th', { style: { ...S.th, textAlign: 'right' } }, 'ET'),
        h('th', { style: { ...S.th, textAlign: 'right' } }, '步'),
        h('th', { style: S.th }, '标注'),
        h('th', { style: S.th }, '用户下一句'));

      const bodyRows = d.turnRows.slice(0, 12).map((r) => h('tr', { key: r.turn },
        h('td', { style: { ...S.td, ...S.mono } }, `#${r.turn}`),
        h('td', { style: { ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmt(r.et)),
        h('td', { style: { ...S.td, textAlign: 'right', opacity: 0.55 } }, r.requests),
        h('td', { style: S.td }, r.label
          ? h('span', { style: S.pill(LABEL_COLOR[r.label] || C.unk) }, LABEL_TEXT[r.label] || r.label)
          : h('span', { style: S.muted }, '—')),
        h('td', { style: { ...S.td, opacity: 0.6, maxWidth: 320 } }, (r.reaction || '（无后续）').slice(0, 64))));

      return h('div', null,
        h('div', { style: S.grid }, effCard, compCard),
        h('div', { style: S.grid }, cacheCard, outCard),
        h(Card, { title: '最贵的轮次', icon: '≡', meta: `共 ${d.turns} 轮` },
          h('table', { style: S.table }, h('thead', null, headRow), h('tbody', null, bodyRows))));
    }

    // ── 会话叶签：只看当前会话 ──────────────────────────────────────────
    function EffiView(props) {
      const sessionId = props.sessionId;
      const [state, setState] = useState({ status: 'loading', data: null, error: '' });
      const [tick, setTick] = useState(0);

      useEffect(() => {
        let alive = true;
        setState((s) => ({ status: s.data ? 'refreshing' : 'loading', data: s.data, error: '' }));
        post('/api/token-effi/eval', { sessionId })
          .then((json) => {
            if (!alive) return;
            if (json && json.ok) setState({ status: 'ready', data: json.value, error: '' });
            else setState({ status: 'error', data: null, error: (json && json.error && json.error.message) || '分析失败' });
          })
          .catch((error) => { if (alive) setState({ status: 'error', data: null, error: String(error) }); });
        return () => { alive = false; };
      }, [sessionId, tick]);

      const reload = useCallback(() => setTick((n) => n + 1), []);
      const d = state.data;
      const header = h('div', { style: S.top },
        h('div', { style: S.title }, '效费比', sessionId ? h('span', { style: S.sub }, short(sessionId)) : null),
        h('button', { style: S.btn, onClick: reload }, '刷新'));

      if (!d) {
        return h('div', { style: S.wrap }, header,
          state.status === 'error' ? h('div', { style: { ...S.card, color: C.bad } }, state.error) : h('div', { style: S.muted }, '正在读取这个会话的账本…'));
      }

      const chips = h('div', { style: S.chips },
        h(Chip, { value: d.turns, label: '轮次' }),
        h(Chip, { value: fmt(d.requests), label: '请求' }),
        h(Chip, { value: d.stepsPerTurn.toFixed(1), label: '步 / 轮' }),
        h(Chip, { value: fmt(d.etTotal), label: '总 ET' }),
        h(Chip, { value: fmt(d.promptTokens), label: 'prompt tok' }),
        h(Chip, { value: d.effectiveness ? d.effectiveness.covered : 0, label: '已标注轮', color: d.effectiveness ? C.acc : undefined }));

      return h('div', { style: S.wrap }, header, chips, h(DetailGrid, { data: d }));
    }

    // ── 标注手册（悬浮面板，固定口径基线）──────────────────────────────
    const MANUAL = [
      { h: '判什么', p: ['只看「用户下一句」。这一轮产出本身好不好、你喜不喜欢，都不参与判断。', '你标的是"用户当时的反应"，不是"这段代码写得怎么样"。'] },
      {
        h: '四类',
        list: [
          ['accept', '接受', '往下走 / 开新任务 / 明确认可（对、好、继续、就这么定）'],
          ['nitpick', '返工', '目标没变，但要求修 / 重做 / 删 / 改 / 重写'],
          ['change', '换目标', '用户改了要的东西本身（换方案、加范围、推翻需求）'],
          ['ambiguous', '未表态', '没有可判读的表态：无后续、系统消息、纯流程噪音'],
        ],
      },
      {
        h: '边界：按这个顺序问三句',
        list: [
          ['①', '有没有下一句人话？', '没有 → 未表态'],
          ['②', '下一句是"新的事"还是"这件事"？', '新的事 → 接受'],
          ['③', '是"这件事"：目标变了吗？', '变了 → 换目标；没变 → 返工'],
        ],
      },
      {
        h: '特殊情形（照此执行）',
        list: [
          ['会话第一轮', '看这一轮有没有交付物：有且用户继续 → 接受；有但被打回 → 返工；没有（开场、只加载、报错） → 未表态'],
          ['一轮做了几件事', '只给一个标签，按用户下一句的主要意图。若"A 接受了、B 退回了" → 按退回算，返工'],
          ['"继续 / 接着做 / 再来一轮"', '接受'],
          ['问"怎么用 / 在哪 / 是什么"', '接受（关于刚交付的东西，是在用，不是在否）'],
          ['问"为什么没用 / 还是不行"', '返工'],
          ['重复一遍同样的要求', '返工（上一次没做到）'],
          ['自己补材料 / 补前提 / 加信息', '接受（没有否定你）'],
          ['系统消息 / subagent 通知 / 定时续跑', '未表态'],
          ['报错 / 中断 / 没有产出', '未表态；若用户明确否定 → 返工'],
          ['讨论里用户反驳你的某个论断', '返工（本机口径：返工就是失败，不设例外）'],
          ['语气很冲但内容是继续', '按内容算，接受'],
        ],
      },
      {
        h: '三个例子',
        list: [
          ['例 1', '"界面重做了" → 用户："x 按钮还是点不掉"', '返工（同一件事，没做到）'],
          ['例 2', '"简历改好了" → 用户："帮我写个 GitHub README"', '接受（这是新的事）'],
          ['例 3', '"用 ESP32 方案" → 用户："ESP32 太拉了，换 STM32"', '换目标（要的东西变了）'],
        ],
      },
      {
        h: '减少漂移',
        list: [
          ['节奏', '一次连标 10–15 条，中途别去看别的会话'],
          ['拿不准', '先按规则给一个，把疑问写进 note，标完统一回看，不要中途改口径'],
          ['自检', '每 10 条回头扫一遍：同一类情形是否给了同一个答案'],
        ],
      },
    ];

    function ManualPanel(props) {
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') props.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [props]);

      const style = {
        position: 'fixed', top: 76, right: 24, width: 460, maxHeight: '74vh', overflowY: 'auto',
        zIndex: 9999, padding: '14px 16px', borderRadius: 12,
        background: 'Canvas', color: 'CanvasText',
        border: '1px solid rgba(127,127,127,0.35)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.38)',
        fontSize: 12.5, lineHeight: 1.62,
      };

      const head = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
        h('div', { style: { fontSize: 13, fontWeight: 650 } }, '标注手册 · 固定基准'),
        h('button', { style: S.btn, onClick: props.onClose }, '关闭 (Esc)'));

      const pillRow = (label) => (label === 'accept' || label === 'nitpick' || label === 'change' || label === 'ambiguous')
        ? h('span', { style: S.pill(LABEL_COLOR[label]) }, LABEL_TEXT[label])
        : null;

      const body = MANUAL.map((sec) => h('div', { key: sec.h, style: { marginBottom: 14 } },
        h('div', { style: { fontSize: 12, fontWeight: 650, opacity: 0.9, marginBottom: 5 } }, sec.h),
        sec.p ? sec.p.map((t, i) => h('div', { key: i, style: { opacity: 0.75, marginBottom: 3 } }, t)) : null,
        sec.list ? sec.list.map((row, i) => h('div', { key: i, style: { display: 'flex', gap: 8, marginBottom: 4 } },
          h('div', { style: { flex: '0 0 128px', opacity: 0.88, fontWeight: 550 } }, pillRow(row[0]) || row[0]),
          h('div', { style: { flex: 1, opacity: 0.72 } },
            pillRow(row[0]) ? row[2] : (row.length > 2 ? `${row[1]}　—　${row[2]}` : row[1])))) : null));

      return h('div', { style }, head, body);
    }

    // ── 洞察页：一屏看全部会话 ─────────────────────────────────────────
    function InsightPage() {
      const [items, setItems] = useState(null);
      const [evals, setEvals] = useState({});
      const [errors, setErrors] = useState({});
      const [selected, setSelected] = useState(null);
      const [tick, setTick] = useState(0);
      const [saving, setSaving] = useState('');
      const [manualOpen, setManualOpen] = useState(false);
      const [labelTip, setLabelTip] = useState(null);
      const [labelled, setLabelled] = useState(null);
      const [storeInfo, setStoreInfo] = useState(null);
      const [range, setRange] = useState('7d');
      const [tipIdx, setTipIdx] = useState(0);
      const [listError, setListError] = useState(null);

      useEffect(() => {
        let alive = true;
        post('/api/token-effi/labels', {})
          .then((json) => {
            if (!alive || !json || !json.ok) return;
            setLabelled(json.value.labelled);
            setStoreInfo({ path: json.value.path, exists: json.value.exists });
          })
          .catch(() => { /* 计数失败不影响主流程 */ });
        return () => { alive = false; };
      }, [tick]);

      useEffect(() => {
        let alive = true;
        post('/api/token-effi/sessions', { range })
          .then((json) => {
            if (!alive) return;
            if (!json || !json.ok) {
              setListError((json && json.error && json.error.message) || '会话清单请求失败（宿主无响应）');
              setItems([]);
              return;
            }
            setListError(null);
            const next = Array.isArray(json.value.items) ? json.value.items : [];
            setItems(next);
            setSelected((cur) => (next.some((i) => i.id === cur) ? cur : (next[0] ? next[0].id : null)));
          })
          .catch((error) => { if (alive) { setListError(String(error)); setItems([]); } });
        return () => { alive = false; };
      }, [tick, range]);

      useEffect(() => {
        if (!items) return;
        let alive = true;
        let cursor = 0;
        let done = 0;
        const load = async (id) => {
          try {
            const json = await post('/api/token-effi/eval', { sessionId: id });
            if (!alive) return;
            if (json && json.ok) setEvals((m) => ({ ...m, [id]: json.value }));
            else setErrors((m) => ({ ...m, [id]: (json && json.error && json.error.message) || '失败' }));
          } catch (error) {
            if (alive) setErrors((m) => ({ ...m, [id]: String(error) }));
          }
        };
        const worker = async () => {
          while (alive && cursor < items.length) {
            const id = items[cursor++].id;
            await load(id);
            done += 1;
          }
        };
        for (let w = 0; w < 3; w++) worker();
        return () => { alive = false; };
        // evals/errors 只由本 effect 写入，进依赖会无限重跑
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [items, tick]);

      const reload = useCallback(() => { setEvals({}); setErrors({}); setItems(null); setTick((n) => n + 1); }, []);

      /** 切范围：和「刷新」走同一条路径，立刻重新取清单，不等第二次点击。 */
      const applyRange = useCallback((value) => {
        setRange(value);
        setItems(null);
        setErrors({});
        setTick((n) => n + 1);
      }, []);

      const ranked = useMemo(() => {
        const list = (items || []).map((item) => ({ item, data: evals[item.id], error: errors[item.id] }));
        list.sort((a, b) => ((b.data && b.data.etTotal) || 0) - ((a.data && a.data.etTotal) || 0));
        return list;
      }, [items, evals, errors]);

      const agg = useMemo(() => {
        let et = 0, acc = 0, bad = 0, unk = 0, covered = 0, labeledSessions = 0, turns = 0, reqs = 0;
        for (const { data } of ranked) {
          if (!data) continue;
          et += data.etTotal || 0;
          turns += data.turns || 0;
          reqs += data.requests || 0;
          const e = data.effectiveness;
          if (e) {
            acc += e.et.acc; bad += e.et.bad; unk += e.et.unk;
            covered += e.covered; labeledSessions += 1;
          }
        }
        const total = acc + bad + unk;
        return { et, turns, reqs, acc, bad, unk, covered, labeledSessions, ratio: total ? acc / total : null, inverse: acc ? bad / acc : null };
      }, [ranked]);

      const current = selected ? evals[selected] : null;
      const loaded = ranked.filter((x) => x.data).length;
      const pending = items ? Math.max(0, items.length - loaded) : 0;

      // 常驻轮播：每 5 秒换一条
      useEffect(() => {
        const timer = setInterval(() => setTipIdx((n) => (n + 1) % TIPS.length), 5000);
        return () => clearInterval(timer);
      }, []);

      // 标注队列：从已加载的会话里抽未标注的轮次，每会话最多 2 条，按 ET 降序
      const queue = useMemo(() => {
        const out = [];
        const per = new Map();
        for (const { item, data } of ranked) {
          if (!data || !Array.isArray(data.turnRows)) continue;
          for (const t of data.turnRows) {
            if (t.label) continue;
            const used = per.get(item.id) || 0;
            if (used >= 2) continue;
            per.set(item.id, used + 1);
            out.push({
              sessionId: item.id,
              title: (data.session && data.session.title) || item.title || short(item.id),
              turn: t.turn,
              et: t.et,
              reaction: t.reaction || '',
              production: t.lastText || '',
            });
            if (out.length >= 12) break;
          }
          if (out.length >= 12) break;
        }
        return out;
      }, [ranked]);

      const applyLabel = useCallback(async (row, human) => {
        const id = `${row.sessionId}#${row.turn}`;
        setSaving(id);
        setLabelTip(null);
        try {
          const saved = await post('/api/token-effi/label', {
            sessionId: row.sessionId, turn: row.turn, human, key: `${row.title}#${row.turn}`,
          });
          if (!saved || !saved.ok) {
            const msg = (saved && saved.error && saved.error.message) || '保存失败（无返回）';
            setLabelTip({ text: `${row.title}#${row.turn} 保存失败：${msg}`, error: true });
            return;
          }
          setLabelTip({ text: `已记下 ${saved.value.key} → ${LABEL_TEXT[human]}`, error: false });
          const json = await post('/api/token-effi/eval', { sessionId: row.sessionId, noCache: true });
          if (json && json.ok) setEvals((m) => ({ ...m, [row.sessionId]: json.value }));
          else if (json && json.error) setLabelTip({ text: `重算失败：${json.error.message}`, error: true });
          const counts = await post('/api/token-effi/labels', {});
          if (counts && counts.ok) {
            setLabelled(counts.value.labelled);
            setStoreInfo({ path: counts.value.path, exists: counts.value.exists });
          }
        } catch (error) {
          setLabelTip({ text: `保存请求出错：${String(error)}`, error: true });
        } finally {
          setSaving('');
        }
      }, []);

      const LABEL_BTNS = [
        ['accept', '接受', C.acc],
        ['nitpick', '返工', C.bad],
        ['change', '换目标', C.orange],
        ['ambiguous', '未表态', C.unk],
      ];

      const labelCard = h(Card, {
        title: '标注队列',
        icon: '✎',
        meta: `队列 ${queue.length} 条 · 已标 ${labelled === null ? '…' : labelled} 轮`,
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
          h('div', { style: { ...S.muted, flex: 1 } },
            '只看「用户下一句」。标掉一条队列会自动补一条，看「已标」这个数才是在涨。'),
          h('button', { style: S.btn, onClick: () => setManualOpen((v) => !v) }, manualOpen ? '收起手册' : '标注手册')),
        queue.length === 0
          ? h('div', { style: S.muted }, loaded ? '没有待标注的轮次了（每个会话最多抽 2 条）。' : '等待会话加载…')
          : queue.map((row) => {
              const busy = saving === `${row.sessionId}#${row.turn}`;
              return h('div', {
                key: `${row.sessionId}#${row.turn}`,
                style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(127,127,127,0.08)' },
              },
                h('div', { style: { flex: '0 0 200px', minWidth: 0 } },
                  h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${row.title}#${row.turn}`),
                  h('div', { style: { ...S.mono, marginTop: 2 } }, `${fmt(row.et)} ET`)),
                h('div', { style: { flex: 1, minWidth: 120, opacity: 0.72, fontSize: 11.5 } }, (row.reaction || '（没有下一句）').slice(0, 90)),
                h('div', { style: { flex: '0 0 auto', display: 'flex', gap: 6 } },
                  LABEL_BTNS.map(([value, text, color]) => h('button', {
                    key: value,
                    disabled: busy,
                    onClick: () => applyLabel(row, value),
                    style: { ...S.btn, borderColor: `${color}66`, color, opacity: busy ? 0.4 : 1, cursor: busy ? 'default' : 'pointer' },
                  }, text))));
            }),
        labelTip ? h('div', { style: { marginTop: 8, fontSize: 11.5, color: labelTip.error ? C.bad : C.acc, opacity: 0.9 } }, labelTip.text) : null,
        storeInfo ? h('div', { style: { ...S.mono, marginTop: 8, opacity: 0.42, wordBreak: 'break-all' } },
          `标注文件：${storeInfo.path}${storeInfo.exists ? '' : '（还没有，点上面任一按钮时创建）'}`) : null,
        manualOpen ? h(ManualPanel, { onClose: () => setManualOpen(false) }) : null);

      const header = h('div', { style: S.top },
        h('div', { style: S.title }, '效费比洞察'),
        h('button', { style: S.btn, onClick: reload }, '刷新'));

      const rangeBar = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' } },
        h('span', { style: { ...S.muted, marginRight: 2 } }, '范围'),
        RANGES.map(([value, text]) => h('button', {
          key: value,
          onClick: () => applyRange(value),
          style: range === value
            ? { ...S.btn, borderColor: 'rgba(76,141,255,0.65)', background: 'rgba(76,141,255,0.16)', color: '#7cb0ff' }
            : S.btn,
        }, text)),
        h('span', { style: { ...S.muted, marginLeft: 'auto' } },
          items === null ? '读取中…' : (pending ? `分析中 ${loaded}/${items.length}` : `${items.length} 个会话 · 已分析 ${loaded}`)));

      const tipLine = h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12,
          padding: '8px 12px', borderRadius: 9,
          border: '1px solid rgba(127,127,127,0.18)', background: 'rgba(127,127,127,0.05)',
          fontSize: 13.5, lineHeight: 1.5,
        },
      },
        h('span', { style: { color: C.blue, opacity: 0.9, flex: '0 0 auto' } }, '✦'),
        h('span', { style: { opacity: 0.78 } }, TIPS[tipIdx % TIPS.length]));

      const errorLine = listError ? h('div', {
        style: { marginBottom: 10, padding: '7px 11px', borderRadius: 8, fontSize: 12, color: C.bad, border: `1px solid ${C.bad}55`, background: `${C.bad}12` },
      }, `会话清单失败：${listError}`) : null;

      const kpis = h('div', { style: S.chips },
        h(Chip, { value: items ? items.length : '…', label: '会话数' }),
        h(Chip, { value: fmt(agg.et), label: '总 ET' }),
        h(Chip, { value: agg.ratio === null ? '—' : pct(agg.ratio), label: '有效占比（已标轮 ET 合计）', color: C.acc }),
        h(Chip, { value: agg.inverse === null ? '—' : `1 : ${agg.inverse.toFixed(2)}`, label: '有效 : 无效', color: C.bad }),
        h(Chip, { value: labelled === null ? '…' : labelled, label: '已标注轮' }),
        h(Chip, { value: agg.labeledSessions, label: '有标注的会话' }));

      const listCard = h(Card, { title: '会话窗口', icon: '☰', meta: items ? `${items.length} 个` : '' },
        items === null
          ? h('div', { style: S.muted }, '读取会话列表…')
          : (items.length === 0
            ? h('div', { style: S.muted }, '这个范围内没有会话，把范围放宽一点试试。')
            : ranked.map(({ item, data, error }) => {
              const e = data && data.effectiveness;
              const ratio = e ? e.et.ratio : null;
              const bar = e
                ? h('div', { style: { display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(127,127,127,0.15)' } },
                    h('div', { style: { width: (e.et.acc / e.et.total) * 100 + '%', background: C.acc } }),
                    h('div', { style: { width: (e.et.bad / e.et.total) * 100 + '%', background: C.bad } }),
                    h('div', { style: { width: (e.et.unk / e.et.total) * 100 + '%', background: C.unk } }))
                : h('div', { style: { height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.15)' } });
              return h('div', {
                key: item.id,
                style: { ...S.srow, ...(item.id === selected ? S.srowActive : {}) },
                onClick: () => setSelected(item.id),
              },
                h('div', { style: { width: 6, height: 6, borderRadius: 3, flex: '0 0 auto', background: item.live ? '#22c55e' : 'rgba(127,127,127,0.35)' } }),
                h('div', { style: { flex: '0 1 260px', minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || short(item.id)),
                h('div', { style: { flex: '0 0 54px', opacity: 0.45, fontVariantNumeric: 'tabular-nums', fontSize: 11 } }, data ? `${data.turns} 轮` : (error ? '失败' : '…')),
                h('div', { style: { flex: '0 0 62px', opacity: 0.45, fontVariantNumeric: 'tabular-nums', fontSize: 11, textAlign: 'right' } }, data ? fmt(data.etTotal) : ''),
                h('div', { style: { flex: 1, minWidth: 80 } }, bar),
                h('div', { style: { flex: '0 0 56px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: ratio === null ? C.unk : C.acc } }, ratio === null ? '—' : pct(ratio)));
            })));

      const detail = current
        ? h(DetailGrid, { data: current })
        : h('div', { style: { ...S.card, ...S.muted } }, items ? '选择一个会话看明细。' : '正在读取…');

      return h('div', { style: S.wrap }, header, rangeBar, tipLine, errorLine, kpis, labelCard, listCard, detail);
    }

    function NavIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20;
      const stroke = props && props.active ? 2.1 : 1.8;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        h('rect', { x: 3, y: 12, width: 4, height: 9, rx: 1 }),
        h('rect', { x: 10, y: 6, width: 4, height: 15, rx: 1 }),
        h('rect', { x: 17, y: 9, width: 4, height: 12, rx: 1 }));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const KEY = 'token-effi';
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'effi',
          order: 40,
          label: '效费比',
        }, EffiView));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: KEY,
        }, InsightPage));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: KEY,
          order: 25,
          label: '效费比洞察',
        }, NavIcon));
      },
    };
  },
});
