/**
 * 自动判定：不依赖人工标注，只从会话日志能观察到的东西判一轮有没有被返工。
 *
 * 这是「效费比」的默认口径。人工标注的用途是**校准它**，不是它成立的前提。
 *
 * 判定质量（对 162 条人工标注，见 scripts/calibrate.mjs）：
 *   - 返工二分类：精确 87%｜召回 71%
 *   - 四分类 κ = 0.41
 * 召回偏低意味着自动口径会**少算返工**，所以它是一个偏乐观的效费比。
 */

const REWORK_STRONG = [
  '还是不行', '还是没', '还是报错', '还是这个', '没有反应', '没反应', '打不开', '显示不出', '没显示',
  '不对', '错了', '有问题', '报错', '没用', '不能用', '不生效', '不工作', '崩了', '挂了', '乱码',
  '重做', '重写', '修复', '改回', '退回', '漏了', '忘了', '没做到', '搞错',
  'still', 'not working', "doesn't work", 'broken', 'fail',
  // 纠正/质问语气：几乎总是「上一次没做好」
  '为什么', '怎么不', '不是哥们', '你妈', '你是猪', '好歹', '不是前面', '约定好', '不是说',
  '无法正常', '未生效', '没生效', '是空的', '你指望', '我标注个啥', '神经', '靠',
  '回退', '还原', '合并', '统一一下', '对齐', '格式化', '不遵守', '忘记',
];

const REWORK_WEAK = [
  '改一下', '改下', '修改', '改成', '调整', '优化', '修一下', '加一下', '加个', '加上', '增加',
  '去掉', '删掉', '删除', '补上', '换成', '换掉', '支持', '区分', '处理一下', '再改',
  'fix', 'change', 'add', 'remove', 'update',
];

const PIVOT = [
  '换个', '换一个', '换方案', '另一个方案', '重新设计', '不用了', '算了', '别用', '不要这个',
  '改成别的', '换种', 'instead', 'scrap', '放弃这个',
  // 另起一件新事
  '再做一个', '继续进阶', '新做一个', '我们来做一个', '单独开一个', '编写一个新的', '增加一个', '新增一个',
];

const ACCEPT = [
  '继续', '接着', '可以', '不错', '完美', '就这样', '谢谢', '收到', '辛苦了', '厉害', '好',
  'ok', 'okay', 'good', 'great', 'nice', 'thanks', 'continue',
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const hits = (text, list) => list.reduce((n, w) => (text.includes(norm(w)) ? n + 1 : n), 0);

/** 字符二元组 Jaccard，用来判「是不是又提了同一件事」。 */
export function jaccard(a, b) {
  const grams = (s) => {
    const t = norm(s);
    const set = new Set();
    for (let i = 0; i + 1 < t.length; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 反应里出现了多少「产出里出现过的专名」，用来判断是不是在说这件事。 */
function sharedTerms(reply, reaction) {
  const words = String(reply || '').match(/[A-Za-z][A-Za-z0-9_.-]{2,}|[\u4e00-\u9fa5]{2,6}/g) || [];
  const r = String(reaction || '');
  const bag = new Set();
  for (const w of words) if (r.includes(w)) bag.add(w);
  return bag.size;
}

/**
 * 判一轮的性质。
 * @param {{reason?: string, reaction?: string, prompt?: string, reply?: string}} turn
 * @returns {'accept'|'nitpick'|'change'|'ambiguous'}
 */
export function autoJudge(turn) {
  const r = norm(turn && turn.reaction);
  if (!r) return 'ambiguous';                 // 没有下一句人话
  if (r.length <= 1) return 'ambiguous';
  if (/^[\[（(【]?(系统|system)/.test(r) && r.length < 20) return 'ambiguous';

  if (hits(r, PIVOT) > 0) return 'change';

  const strong = hits(r, REWORK_STRONG);
  const weak = hits(r, REWORK_WEAK);
  const accept = hits(r, ACCEPT);

  // 又把同一件事说了一遍 → 上一次没做到
  const repeat = jaccard(turn.prompt, turn.reaction);
  if (strong > 0) return 'nitpick';
  if (repeat >= 0.5) return 'nitpick';
  if (weak > 0 && accept === 0) return 'nitpick';

  // 在讨论刚交付的东西（复用了产出里的专名），且没有否定 → 接受
  if (sharedTerms(turn.reply, turn.reaction) >= 2) return 'accept';
  if (accept > 0) return 'accept';

  // 剩下的：正常结束且不是重复要求，当作往下走
  if (turn.reason === 'completed') return repeat >= 0.3 ? 'nitpick' : 'accept';
  return 'ambiguous';
}

export const AUTO_CLASSES = ['accept', 'nitpick', 'change', 'ambiguous'];
