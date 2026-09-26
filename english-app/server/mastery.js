// 習熟度（SkillProgress）の算出ロジック
//
// 方針（README「習熟度の算出方法」にも同じ説明があります）:
// 1. Reading / Listening は、生徒の「現在の学習レベル」の問題への解答から算出する。
//    - 問題ごとに直近3回までの解答を見て、各回を次の点数にする:
//        支援なしで正解 = 1.0 / スクリプトを開いて正解・音声なしで正解 = 0.5 / 不正解 = 0
//    - 問題ごとの平均を、さらに問題間で平均したものを「正答スコア」とする（1問を何度も解いても偏らない）。
//    - 解いた問題が3問未満のときは「データ不足」とし、習熟度を断定しない。
// 2. Writing / Speaking は、正答率ではなく評価で扱う。
//    - 教員評価（各観点0〜5点）があれば、課題ごとの最新評価の平均を使う。
//    - 自己評価しかない場合は「自己評価のみ」と区別して表示し、教員評価と混ぜない。
// 3. 4技能を平均して1つの級にまとめることはしない。
export const SKILLS = ['reading', 'listening', 'writing', 'speaking'];
export const SKILL_JA = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', vocabulary: '語彙', grammar: '文法' };
export const MIN_QUESTIONS = 3;

export function attemptValue(a) {
  if (!a.correct) return 0;
  const s = a.support || {};
  return s.scriptOpened || s.noAudio ? 0.5 : 1;
}

export function statusFromScore(score) {
  if (score < 0.5) return 'needs-work';
  if (score < 0.8) return 'developing';
  return 'secure';
}

export const STATUS_JA = {
  'not-started': 'まだ取り組んでいません',
  insufficient: 'データが少なく判定できません',
  'needs-work': '重点的に練習しましょう',
  developing: '力がついてきています',
  secure: '安定しています',
  'self-only': '自己評価のみ（教員評価待ち）',
};

/**
 * @param {object} p
 * @param {Array} p.attempts  [{question_id, skill, level, correct, support, created_at}] 古い順
 * @param {Array} p.submissions [{id, kind, level, activity_id, self_scores, created_at}]
 * @param {Array} p.feedback [{submission_id, scores}]
 * @param {object} p.levels { reading: {level, level_source}, ... }
 */
export function computeSkillProgress({ attempts = [], submissions = [], feedback = [], levels = {} }) {
  const out = {};
  for (const skill of ['reading', 'listening']) {
    const level = levels[skill]?.level || 'A2';
    const byQ = new Map();
    for (const a of attempts) {
      if (a.skill !== skill || a.level !== level) continue;
      if (!byQ.has(a.question_id)) byQ.set(a.question_id, []);
      byQ.get(a.question_id).push(a);
    }
    const perQ = [];
    let supported = 0; let total = 0;
    for (const list of byQ.values()) {
      const recent = list.slice(-3);
      perQ.push(recent.reduce((s, a) => s + attemptValue(a), 0) / recent.length);
      for (const a of list) { total++; if (a.support?.scriptOpened || a.support?.noAudio) supported++; }
    }
    const n = perQ.length;
    const score = n ? perQ.reduce((s, x) => s + x, 0) / n : null;
    let status = 'not-started';
    if (n > 0 && n < MIN_QUESTIONS) status = 'insufficient';
    else if (n >= MIN_QUESTIONS) status = statusFromScore(score);
    out[skill] = {
      skill, level, levelSource: levels[skill]?.level_source || 'default', kind: 'objective',
      score, questions: n, attempts: total, supportedAttempts: supported, status,
      explanation: explainObjective(skill, level, n, score, supported, total),
    };
  }
  const fbBySub = new Map();
  for (const f of feedback) fbBySub.set(f.submission_id, f); // 後のものが優先（古い順で渡す）
  for (const skill of ['writing', 'speaking']) {
    const level = levels[skill]?.level || 'A2';
    const subs = submissions.filter((s) => s.kind === skill && s.level === level);
    // 課題ごとに、教員評価のついた最新の提出と、最新の提出（自己評価用）を取る
    const latestRated = new Map(); const latestAny = new Map();
    for (const s of subs) {
      latestAny.set(s.activity_id, s);
      if (fbBySub.has(s.id)) latestRated.set(s.activity_id, s);
    }
    const avgOf = (scores) => { const v = Object.values(scores || {}).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const teacher = [...latestRated.values()].map((s) => avgOf(fbBySub.get(s.id).scores)).filter((x) => x != null);
    const self = [...latestAny.values()].map((s) => avgOf(s.self_scores)).filter((x) => x != null);
    const teacherAvg = teacher.length ? teacher.reduce((a, b) => a + b, 0) / teacher.length : null;
    const selfAvg = self.length ? self.reduce((a, b) => a + b, 0) / self.length : null;
    let status = 'not-started';
    if (teacherAvg != null) status = statusFromScore(teacherAvg / 5);
    else if (subs.length) status = 'self-only';
    out[skill] = {
      skill, level, levelSource: levels[skill]?.level_source || 'default', kind: 'rated',
      score: teacherAvg != null ? teacherAvg / 5 : null, teacherAvg, teacherRated: teacher.length, selfAvg, submissions: subs.length, status,
      explanation: explainRated(skill, level, subs.length, teacherAvg, teacher.length, selfAvg),
    };
  }
  return out;
}

function pct(x) { return `${Math.round(x * 100)}%`; }

function explainObjective(skill, level, n, score, supported, total) {
  const name = SKILL_JA[skill];
  if (!n) return `${level}の${name}問題にまだ解答していません。`;
  const base = `${level}の${name}問題 ${n}問の直近の解答から算出（正答スコア ${pct(score)}）。`;
  const sup = supported ? `うち${supported}回はスクリプトを見て解答したため、半分の点数で数えています。` : '';
  const few = n < MIN_QUESTIONS ? `あと${MIN_QUESTIONS - n}問以上解くと判定できます。` : '';
  return base + sup + few + (total && !few ? '' : '');
}

function explainRated(skill, level, subs, teacherAvg, rated, selfAvg) {
  const name = SKILL_JA[skill];
  if (!subs) return `${level}の${name}課題をまだ提出していません。`;
  if (teacherAvg != null) return `${level}の${name}課題 ${rated}件の教員評価の平均（5点満点で${teacherAvg.toFixed(1)}点）から判定しています。`;
  return `${level}の${name}課題を${subs}件提出済み。教員評価がまだないため判定していません` + (selfAvg != null ? `（自己評価の平均は${selfAvg.toFixed(1)}点／5点。参考値です）。` : '。');
}

/** 焦点（問題の種類）別の正答率。よく間違える項目の表示に使う */
export function focusStats(attempts) {
  const m = new Map();
  for (const a of attempts) {
    if (!a.focus) continue;
    const e = m.get(a.focus) || { focus: a.focus, total: 0, correct: 0 };
    e.total++; if (a.correct) e.correct++;
    m.set(a.focus, e);
  }
  return [...m.values()].map((e) => ({ ...e, rate: e.correct / e.total }));
}

export const FOCUS_JA = {
  'main-idea': '主旨の把握', 'specific-info': '具体的な情報', inference: '推論', attitude: '筆者・話者の意図や態度',
  vocabulary: '語彙', grammar: '文法', function: '表現の働き', reference: '指示語の理解',
};
