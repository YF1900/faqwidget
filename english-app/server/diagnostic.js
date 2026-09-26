// 初回診断の採点。結果は「教材を選ぶための目安」であり、公式スコアや合否予測ではない。
// - Reading / Listening: 自動採点（method: 'auto'）。各レベル3問中2問以上正解したレベルのうち、
//   下のレベルから連続して到達した最も高いレベルを目安とする。
// - Writing / Speaking: 初期版では自動評価しないため、can-do 自己評価（method: 'self'）で目安を出す。
//   各レベル3項目中2項目以上「できる」を選んだレベルのうち、下から連続する最も高いレベル。
import { LEVELS } from './content.js';

export function publicDiagnostic(d) {
  // 解答前の配信用。正答・解説・根拠を取り除く
  const stripQ = ({ answer, explanation, evidence, ...q }) => q; // eslint-disable-line no-unused-vars
  const sec = (s) => ({ ...s, questions: s.questions.map(stripQ) });
  return {
    id: d.id, note: d._note,
    reading: { ...d.reading, sections: d.reading.sections.map(sec) },
    listening: { ...d.listening, sections: d.listening.sections.map(sec) },
    writing: d.writing, speaking: d.speaking,
  };
}

function highestConsecutive(passByLevel) {
  let level = null;
  for (const L of LEVELS) { if (passByLevel[L]) level = L; else break; }
  return level;
}

export function scoreDiagnostic(d, input) {
  const skills = {};
  const items = [];
  for (const skill of ['reading', 'listening']) {
    const answers = input?.[skill]?.answers || {};
    const scriptOpened = !!input?.[skill]?.scriptOpened;
    const noAudio = !!input?.[skill]?.noAudio;
    const correct = {}; const pass = {};
    for (const s of d[skill].sections) {
      let c = 0;
      for (const q of s.questions) {
        const resp = answers[q.id];
        const ok = Number.isInteger(resp) && resp === q.answer;
        if (ok) c++;
        items.push({ skill, level: s.level, question: q, response: Number.isInteger(resp) ? resp : null, correct: ok });
      }
      correct[s.level] = c;
      pass[s.level] = c >= 2;
    }
    let level = highestConsecutive(pass);
    // A2 で連続が途切れても上位レベルで2問以上正解している場合は、1段階下を目安にする
    if (!level && (pass.B1 || pass.B2)) level = 'A2';
    else if (level === 'A2' && pass.B2 && !pass.B1) level = 'B1';
    skills[skill] = {
      method: 'auto', level: level || 'A2', foundation: !level, correct, total: 3,
      supported: skill === 'listening' && (scriptOpened || noAudio), scriptOpened, noAudio,
    };
  }
  for (const skill of ['writing', 'speaking']) {
    const checked = new Set(Array.isArray(input?.[skill]?.canDo) ? input[skill].canDo : []);
    const count = {}; const pass = {};
    for (const L of LEVELS) {
      const ids = d[skill].canDo.filter((c) => c.level === L).map((c) => c.id);
      count[L] = ids.filter((id) => checked.has(id)).length;
      pass[L] = count[L] >= 2;
    }
    const level = highestConsecutive(pass);
    skills[skill] = { method: 'self', level: level || 'A2', foundation: !level, canDoCount: count };
  }
  const writingText = typeof input?.writing?.text === 'string' ? input.writing.text.slice(0, 5000) : '';
  return { skills, items, writingText, suggestedExam: suggestExam(skills) };
}

// 目標試験の候補: 4技能の目安レベルを低い順に並べ、下から2番目（低めの中央値）を候補にする。
// 無理のない目標から始め、得意な技能は上のレベルの教材で伸ばす方針。
export function suggestExam(skills) {
  const idx = Object.values(skills).map((s) => LEVELS.indexOf(s.level)).sort((a, b) => a - b);
  return LEVELS[idx[1]] || 'A2';
}
