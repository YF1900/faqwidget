// 単語・熟語・構文カード。教材の「語彙（intro の vocabulary）」と「解説（explain の points[].patterns）」から作る。
// カード ID は活動 ID と見出し語から作るため、教材の並び順を変えても変わらない。
import { now, tx } from './db.js';
import { newId } from './auth.js';
import { evaluateStamp } from './stamps.js';

export const CARD_TYPES = { word: '単語', phrase: '熟語・表現', structure: '構文' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';

export function cardsForUnit(db, unitId, { includeHidden = false } = {}) {
  const u = db.prepare('SELECT id, level, title_ja, status FROM units WHERE id = ?').get(unitId);
  if (!u || (!includeHidden && u.status !== 'published')) return [];
  const acts = db.prepare("SELECT id, kind, status, data FROM activities WHERE unit_id = ? AND kind IN ('intro','explain') ORDER BY step").all(unitId)
    .filter((a) => includeHidden || a.status === 'published');
  const cards = [];
  for (const a of acts) {
    const data = JSON.parse(a.data);
    const used = new Set();
    const push = (c) => {
      let id = `${a.id}:${slug(c.front)}`;
      for (let i = 2; used.has(id); i++) id = `${a.id}:${slug(c.front)}-${i}`;
      used.add(id);
      cards.push({ id, unitId, unitTitle: u.title_ja, level: u.level, activityId: a.id, ...c });
    };
    if (a.kind === 'intro') for (const v of data.vocabulary || []) {
      if (!v.term || !v.meaning) continue;
      push({ type: /\s/.test(v.term.trim()) ? 'phrase' : 'word', front: v.term, meaning: v.meaning, example: v.example || '' });
    }
    if (a.kind === 'explain') for (const p of data.points || []) for (const pt of p.patterns || []) {
      if (!pt.pattern || !pt.meaning) continue;
      push({ type: 'structure', front: pt.pattern, meaning: pt.meaning, example: pt.example || '', note: p.heading });
    }
  }
  return cards;
}

export function allCards(db, level) {
  const units = db.prepare("SELECT id FROM units WHERE status = 'published'" + (level ? ' AND level = ?' : '') + ' ORDER BY theme, order_no').all(...(level ? [level] : []));
  return units.flatMap((u) => cardsForUnit(db, u.id));
}

export function findCard(db, cardId) {
  const actId = String(cardId).split(':')[0];
  const a = db.prepare('SELECT unit_id FROM activities WHERE id = ?').get(actId);
  if (!a) return null;
  return cardsForUnit(db, a.unit_id).find((c) => c.id === cardId) || null;
}

// ---- スタンプの記録（問題・カード共通） ----
export function questionAttemptsFor(db, userId, questionId) {
  return db.prepare("SELECT correct, support, created_at FROM attempts WHERE user_id = ? AND question_id = ? AND context IN ('unit','review') ORDER BY created_at, rowid")
    .all(userId, questionId).map((a) => { const s = JSON.parse(a.support || '{}'); return { correct: !!a.correct, supported: !!(s.scriptOpened || s.noAudio), created_at: a.created_at }; });
}
export function cardAttemptsFor(db, userId, cardId) {
  return db.prepare('SELECT correct, created_at FROM card_attempts WHERE user_id = ? AND card_id = ? ORDER BY created_at, rowid')
    .all(userId, cardId).map((a) => ({ correct: !!a.correct, supported: false, created_at: a.created_at }));
}

/** 解答のたびに呼ぶ。条件を満たしていればスタンプを記録し、今回もらえたかどうかを返す */
export function syncStamp(db, userId, { type, itemId, unitId, level, category }) {
  const attempts = type === 'question' ? questionAttemptsFor(db, userId, itemId) : cardAttemptsFor(db, userId, itemId);
  const ev = evaluateStamp(attempts);
  const had = db.prepare('SELECT earned_at FROM stamps WHERE user_id = ? AND item_type = ? AND item_id = ?').get(userId, type, itemId);
  let newlyEarned = false;
  if (ev.earned && !had) {
    db.prepare('INSERT INTO stamps (user_id, item_type, item_id, unit_id, level, category, earned_at) VALUES (?,?,?,?,?,?,?)')
      .run(userId, type, itemId, unitId, level, category, ev.earnedAt);
    newlyEarned = true;
  }
  return { earned: ev.earned || !!had, newlyEarned, streak: ev.streak, remaining: had ? 0 : ev.remaining, needsNewDay: had ? false : ev.needsNewDay };
}

export function recordCardAttempt(db, userId, { clientId, card, response }) {
  const prev = db.prepare('SELECT * FROM card_attempts WHERE client_id = ?').get(clientId);
  if (prev) return { duplicate: true, correct: !!prev.correct, userId: prev.user_id };
  const correct = typeof response === 'string' && response === card.meaning;
  return tx(db, () => {
    db.prepare('INSERT INTO card_attempts (id, client_id, user_id, card_id, unit_id, response, correct, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(newId('k_'), clientId, userId, card.id, card.unitId, String(response).slice(0, 200), correct ? 1 : 0, now());
    const stamp = syncStamp(db, userId, { type: 'card', itemId: card.id, unitId: card.unitId, level: card.level, category: card.type });
    return { correct, stamp };
  });
}
