// 生徒の学習状況の集計（ダッシュボード・教員画面で共用）
import { computeSkillProgress, focusStats, SKILLS, SKILL_JA, STATUS_JA, FOCUS_JA } from './mastery.js';
import { LEVELS } from './content.js';

const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function getLevels(db, userId) {
  const rows = db.prepare('SELECT skill, level, level_source, set_by, updated_at FROM skill_progress WHERE user_id = ?').all(userId);
  const out = {};
  for (const s of SKILLS) out[s] = rows.find((r) => r.skill === s) || { skill: s, level: 'A2', level_source: 'default', set_by: null, updated_at: null };
  return out;
}

export function getTarget(db, userId) {
  return db.prepare('SELECT exam, planned_month, updated_at FROM exam_targets WHERE user_id = ?').get(userId) || null;
}

export function learningAttempts(db, userId) {
  return db.prepare(`SELECT a.question_id, a.question_version, a.correct, a.support, a.created_at, a.context, a.activity_id,
      q.skill, q.level, q.focus, q.data, q.activity_id AS q_activity
    FROM attempts a LEFT JOIN questions q ON q.id = a.question_id
    WHERE a.user_id = ? AND a.context IN ('unit','review') ORDER BY a.created_at, a.rowid`).all(userId)
    .map((a) => ({ ...a, correct: !!a.correct, support: J(a.support, {}) }));
}

export function userSubmissions(db, userId) {
  return db.prepare(`SELECT s.*, u.level, act.data AS act_data FROM submissions s
    LEFT JOIN activities act ON act.id = s.activity_id LEFT JOIN units u ON u.id = act.unit_id
    WHERE s.user_id = ? ORDER BY s.created_at, s.rowid`).all(userId)
    .map((s) => ({ ...s, self_scores: J(s.self_scores, {}), self_check: J(s.self_check, []), activity_title: J(s.act_data, {}).title || s.activity_id, act_data: undefined }));
}

export function feedbackFor(db, userId) {
  return db.prepare(`SELECT f.* FROM feedback f JOIN submissions s ON s.id = f.submission_id WHERE s.user_id = ? ORDER BY f.created_at, f.rowid`).all(userId)
    .map((f) => ({ ...f, scores: J(f.scores, {}) }));
}

export function progressFor(db, userId) {
  const levels = getLevels(db, userId);
  const attempts = learningAttempts(db, userId);
  const submissions = userSubmissions(db, userId);
  const feedback = feedbackFor(db, userId);
  const skills = computeSkillProgress({ attempts, submissions, feedback, levels });
  for (const s of SKILLS) skills[s].statusJa = STATUS_JA[skills[s].status];
  return { levels, attempts, submissions, feedback, skills };
}

export function completionsFor(db, userId) {
  return new Map(db.prepare('SELECT activity_id, completed_at FROM activity_completions WHERE user_id = ?').all(userId).map((r) => [r.activity_id, r.completed_at]));
}

export function unitsWithProgress(db, userId) {
  const done = completionsFor(db, userId);
  const units = db.prepare("SELECT * FROM units WHERE status = 'published' ORDER BY theme, order_no, level").all();
  return units.map((u) => {
    const acts = db.prepare("SELECT id, step, kind, skill, data FROM activities WHERE unit_id = ? AND status = 'published' ORDER BY step").all(u.id)
      .map((a) => ({ id: a.id, step: a.step, kind: a.kind, skill: a.skill, title: J(a.data, {}).title, minutes: J(a.data, {}).minutes, completed: done.has(a.id) }));
    const completed = acts.filter((a) => a.completed).length;
    return {
      id: u.id, theme: u.theme, themeLabel: u.theme_label, level: u.level, exam: u.exam, order: u.order_no, title: u.title, titleJa: u.title_ja,
      estimatedMinutes: u.estimated_minutes, activities: acts, completed, total: acts.length, isComplete: acts.length > 0 && completed === acts.length,
    };
  });
}

const STATUS_PRIORITY = { 'needs-work': 0, 'not-started': 1, insufficient: 2, 'self-only': 3, developing: 4, secure: 5 };

export function overallLevel(target, levels) {
  if (target && LEVELS.includes(target.exam)) return target.exam;
  const idx = SKILLS.map((s) => LEVELS.indexOf(levels[s].level)).sort((a, b) => a - b);
  return LEVELS[idx[1]] || 'A2';
}

/** 今日の推奨課題（最大3件）。理由を平易な日本語で返す */
export function recommend(db, userId, { target, skills, levels, dueCount, hasDiagnostic, units }) {
  const recs = [];
  if (!target) return [{ type: 'onboarding', title: '目標試験を設定する', reason: 'まず目標とする試験と受験予定時期を決めましょう（未定でもかまいません）。', minutes: 2 }];
  if (!hasDiagnostic) recs.push({ type: 'diagnostic', title: '4技能の診断を受ける', reason: '今の力に合った教材を選ぶため、Reading・Listening・Writing・Speaking の目安を確認します。途中でやめても続きから再開できます。', minutes: 45 });
  if (dueCount > 0) recs.push({ type: 'review', title: `復習（${dueCount}問）`, reason: `復習の予定日になった問題が${dueCount}問あります。間違えた問題を日をあけて解き直すと定着しやすくなります。`, minutes: Math.min(10, 2 + dueCount) });
  const kindOf = { reading: 'reading', listening: 'listening', writing: 'writing', speaking: 'speaking' };
  const ordered = SKILLS.slice().sort((a, b) => (STATUS_PRIORITY[skills[a].status] - STATUS_PRIORITY[skills[b].status]) || ((skills[a].score ?? 0) - (skills[b].score ?? 0)));
  for (const skill of ordered) {
    const L = levels[skill].level;
    const unit = units.find((u) => u.level === L && u.activities.some((a) => a.kind === kindOf[skill] && !a.completed));
    if (!unit) continue;
    const act = unit.activities.find((a) => a.kind === kindOf[skill] && !a.completed);
    recs.push({
      type: 'activity', unitId: unit.id, step: act.step, skill, level: L, title: `${act.title}（${L}）`, minutes: act.minutes || 8,
      reason: `${SKILL_JA[skill]}は「${STATUS_JA[skills[skill].status]}」の状態です。あなたの${SKILL_JA[skill]}の学習レベル（${L}）の単元から、まだ終えていない課題を選びました。`,
    });
    break;
  }
  const main = overallLevel(target, levels);
  const mainUnit = units.find((u) => u.level === main && !u.isComplete);
  if (mainUnit) {
    const act = mainUnit.activities.find((a) => !a.completed);
    if (act && !recs.some((r) => r.unitId === mainUnit.id && r.step === act.step)) {
      recs.push({
        type: 'activity', unitId: mainUnit.id, step: act.step, level: main, title: `${act.title}（${mainUnit.titleJa}・${main}）`, minutes: act.minutes || 8,
        reason: `目標（${main}）の単元を順番に進めています。次は step ${act.step} です。`,
      });
    }
  }
  if (!recs.some((r) => r.type === 'activity')) {
    // 自分のレベルの課題がすべて終わっている場合は、上のレベルの単元への挑戦を提案する
    const above = LEVELS.slice(LEVELS.indexOf(main) + 1);
    const challenge = units.find((u) => above.includes(u.level) && !u.isComplete);
    const act = challenge?.activities.find((a) => !a.completed);
    if (act) {
      recs.push({
        type: 'activity', unitId: challenge.id, step: act.step, level: challenge.level, title: `${act.title}（${challenge.titleJa}・${challenge.level}）`, minutes: act.minutes || 8,
        reason: `${main}の単元はすべて終わっています。同じテーマの1つ上のレベル（${challenge.level}）に挑戦してみましょう。`,
      });
    }
  }
  return recs.slice(0, 3);
}

export function dueReviewCount(db, userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM review_items r JOIN questions q ON q.id = r.question_id AND q.status='published'
    WHERE r.user_id = ? AND r.due_at <= ?`).get(userId, new Date().toISOString()).n;
}

export function frequentMistakes(attempts) {
  const byQ = new Map();
  for (const a of attempts) {
    if (!a.data) continue;
    const e = byQ.get(a.question_id) || { questionId: a.question_id, wrong: 0, total: 0, last: null, skill: a.skill, level: a.level, stem: J(a.data, {}).stem };
    e.total++; if (!a.correct) e.wrong++; e.last = a.correct;
    byQ.set(a.question_id, e);
  }
  const items = [...byQ.values()].filter((e) => e.wrong >= 2 || (e.wrong >= 1 && e.last === false))
    .sort((a, b) => b.wrong - a.wrong).slice(0, 5);
  const focus = focusStats(attempts).filter((f) => f.total >= 3 && f.rate < 0.6).sort((a, b) => a.rate - b.rate)
    .map((f) => ({ ...f, label: FOCUS_JA[f.focus] || f.focus }));
  return { items, focus };
}

export function recentChanges(attempts) {
  const t = Date.now();
  const week = 7 * 864e5;
  const out = [];
  for (const skill of ['reading', 'listening', 'vocabulary', 'grammar']) {
    const cur = attempts.filter((a) => a.skill === skill && t - Date.parse(a.created_at) < week);
    const prev = attempts.filter((a) => a.skill === skill && t - Date.parse(a.created_at) >= week && t - Date.parse(a.created_at) < 2 * week);
    if (cur.length >= 3 && prev.length >= 3) {
      const r = (l) => l.filter((a) => a.correct).length / l.length;
      out.push({ skill, label: SKILL_JA[skill], current: r(cur), previous: r(prev), n: cur.length });
    }
  }
  return out;
}

export function historyFor(db, userId, limit = 15) {
  const ev = [];
  for (const c of db.prepare(`SELECT c.completed_at AS at, a.data, u.title_ja, u.level FROM activity_completions c
      JOIN activities a ON a.id = c.activity_id JOIN units u ON u.id = a.unit_id WHERE c.user_id = ? ORDER BY c.completed_at DESC LIMIT ?`).all(userId, limit))
    ev.push({ at: c.at, type: 'completed', text: `${c.title_ja}（${c.level}）「${J(c.data, {}).title}」を完了` });
  for (const s of db.prepare('SELECT s.created_at AS at, s.kind, s.revision, a.data FROM submissions s LEFT JOIN activities a ON a.id = s.activity_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT ?').all(userId, limit))
    ev.push({ at: s.at, type: 'submitted', text: `${s.kind === 'writing' ? 'Writing' : 'Speaking'}「${J(s.data, {}).title || ''}」を${s.revision > 1 ? `再提出（${s.revision}回目）` : '提出'}` });
  for (const f of db.prepare('SELECT f.created_at AS at, a.data FROM feedback f JOIN submissions s ON s.id = f.submission_id LEFT JOIN activities a ON a.id = s.activity_id WHERE s.user_id = ? ORDER BY f.created_at DESC LIMIT ?').all(userId, limit))
    ev.push({ at: f.at, type: 'feedback', text: `「${J(f.data, {}).title || ''}」に先生の評価が届きました` });
  for (const d of db.prepare('SELECT created_at AS at FROM diagnostic_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 3').all(userId))
    ev.push({ at: d.at, type: 'diagnostic', text: '4技能の診断を受けました' });
  return ev.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

export function latestDiagnostic(db, userId) {
  const r = db.prepare('SELECT result, created_at FROM diagnostic_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
  return r ? { ...J(r.result, {}), createdAt: r.created_at } : null;
}

export function dashboardFor(db, userId) {
  const target = getTarget(db, userId);
  const { levels, attempts, skills } = progressFor(db, userId);
  const units = unitsWithProgress(db, userId);
  const dueCount = dueReviewCount(db, userId);
  const diag = latestDiagnostic(db, userId);
  const today = recommend(db, userId, { target, skills, levels, dueCount, hasDiagnostic: !!diag, units });
  return {
    target, skills, today, dueCount,
    diagnostic: diag ? { createdAt: diag.createdAt, suggestedExam: diag.suggestedExam, skills: diag.skills } : null,
    completedUnits: units.filter((u) => u.isComplete).map((u) => ({ id: u.id, titleJa: u.titleJa, level: u.level })),
    unitsInProgress: units.filter((u) => u.completed > 0 && !u.isComplete).map((u) => ({ id: u.id, titleJa: u.titleJa, level: u.level, completed: u.completed, total: u.total })),
    mistakes: frequentMistakes(attempts),
    changes: recentChanges(attempts),
    history: historyFor(db, userId),
    stats: { attempts: attempts.length, supported: attempts.filter((a) => a.support?.scriptOpened || a.support?.noAudio).length },
  };
}
