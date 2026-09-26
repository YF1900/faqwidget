// スタンプ（理解の証）と称号の判定
//
// スタンプの条件（1問・1枚のカードごと）:
//   - スクリプトなどの支援を使わない正解が3回以上連続している
//   - その連続した正解が2日以上にまたがっている（その場で3回続けて解くだけでは取れない）
// 間違えるか支援を使うと、連続はリセットされる。一度もらったスタンプは消えない。
// 日付は日本時間で数える。
export const STAMP_STREAK = 3;
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (iso) => DAY_FMT.format(new Date(iso));

/**
 * @param {Array<{correct:boolean, supported:boolean, created_at:string}>} attempts 古い順
 * @returns {{earned:boolean, earnedAt:string|null, streak:number, days:number, needsNewDay:boolean, remaining:number}}
 */
export function evaluateStamp(attempts, now = new Date().toISOString()) {
  let streak = []; let earnedAt = null;
  for (const a of attempts) {
    if (a.correct && !a.supported) streak.push(a); else streak = [];
    if (!earnedAt && streak.length >= STAMP_STREAK && new Set(streak.map((x) => dayKey(x.created_at))).size >= 2) earnedAt = a.created_at;
  }
  const days = new Set(streak.map((x) => dayKey(x.created_at))).size;
  // 連続中の正解がすべて同じ日なら、次の正解は別の日（明日以降）である必要がある
  const needsNewDay = !earnedAt && streak.length > 0 && days <= 1;
  const remaining = earnedAt ? 0 : Math.max(STAMP_STREAK - streak.length, needsNewDay ? 1 : 0);
  const answeredToday = streak.length > 0 && dayKey(streak[streak.length - 1].created_at) === dayKey(now);
  return { earned: !!earnedAt, earnedAt, streak: streak.length, days, remaining, needsNewDay, answeredToday };
}

// レベルごとの称号（そのレベルでもらえるスタンプ総数に対する割合）
export const TITLES = [
  { key: 'beginner', name: 'ビギナー', min: 0, minCount: 1 },
  { key: 'bronze', name: 'ブロンズ', min: 0.2 },
  { key: 'silver', name: 'シルバー', min: 0.4 },
  { key: 'gold', name: 'ゴールド', min: 0.6 },
  { key: 'platinum', name: 'プラチナ', min: 0.8 },
  { key: 'master', name: 'マスター', min: 1 },
];

export function titleFor(count, total) {
  let current = null;
  for (const t of TITLES) {
    const need = t.minCount ?? Math.ceil(total * t.min);
    if (total > 0 && count >= Math.max(need, 1)) current = t;
  }
  const idx = current ? TITLES.indexOf(current) : -1;
  const next = TITLES[idx + 1] || null;
  const nextNeed = next ? Math.max(next.minCount ?? Math.ceil(total * next.min), 1) : null;
  return { title: current, next, remainingToNext: next ? Math.max(0, nextNeed - count) : 0 };
}
