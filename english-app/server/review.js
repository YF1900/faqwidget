// ReviewSchedule: 間隔をあけて復習する（ライトナー方式）
// - 不正解、またはスクリプトを見て正解した問題は、翌日に復習する（箱1）
// - 復習で支援なしに正解するたびに箱が1つ進み、次の復習までの間隔が伸びる
// - 箱5で正解すると復習リストから外れる
export const INTERVAL_DAYS = [1, 3, 7, 14, 30];

export function nextReviewState(current, { correct, supported }, at = Date.now()) {
  const ok = correct && !supported;
  if (!current) {
    if (ok) return null;
    return { box: 1, due_at: new Date(at + INTERVAL_DAYS[0] * 864e5).toISOString(), reason: correct ? 'supported' : 'incorrect' };
  }
  if (!ok) return { box: 1, due_at: new Date(at + INTERVAL_DAYS[0] * 864e5).toISOString(), reason: correct ? 'supported' : 'incorrect' };
  const box = current.box + 1;
  if (box > INTERVAL_DAYS.length) return null; // 定着したので外す
  return { box, due_at: new Date(at + INTERVAL_DAYS[box - 1] * 864e5).toISOString(), reason: current.reason };
}
