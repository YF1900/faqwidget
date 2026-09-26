// 音声（ブラウザーの読み上げ機能）と録音。どちらも機能検出してから使う
import { h, replace } from './dom.js';

// ---------------- 読み上げ（Listening） ----------------
export function ttsSupported() {
  return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

function pickVoices() {
  const all = (window.speechSynthesis.getVoices() || []).filter((v) => /^en[-_]/i.test(v.lang));
  // 端末内の音声を優先（オンライン音声はテキストが外部に送られる可能性があるため）
  const localVoices = all.filter((v) => v.localService);
  const pool = localVoices.length ? localVoices : [];
  const gb = pool.filter((v) => /GB/i.test(v.lang));
  const ordered = [...gb, ...pool.filter((v) => !gb.includes(v))];
  return ordered;
}

/**
 * 再生ボタン付きの読み上げプレイヤーを作る。自動再生はしない（生徒のタップで開始）。
 * 一時停止は「今の行で止めて、同じ行から再開」する方式（iOS の pause/resume の不安定さを避ける）
 */
export function createPlayer(lines, { onUnavailable } = {}) {
  let index = 0; let playing = false; let rate = 1; let startedAny = false; let token = 0;
  const status = h('p', { class: 'player-status', 'aria-live': 'polite' }, '「再生」を押すと音声が流れます。');
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary btn-play', onclick: () => (playing ? pause() : play()) }, '▶ 再生');
  const restartBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { stop(); index = 0; play(); } }, '↺ 最初から');
  const rateBtn = h('button', { type: 'button', class: 'btn btn-secondary', 'aria-pressed': 'false', onclick: () => {
    rate = rate === 1 ? 0.8 : 1; rateBtn.textContent = rate === 1 ? '速度: ふつう' : '速度: ゆっくり'; rateBtn.setAttribute('aria-pressed', String(rate !== 1));
    if (playing) { stop(); play(); }
  } }, '速度: ふつう');
  const bar = h('div', { class: 'player-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': lines.length, 'aria-valuenow': 0, 'aria-label': '再生位置' }, h('span'));
  const el = h('div', { class: 'player' }, h('div', { class: 'player-buttons' }, playBtn, restartBtn, rateBtn), bar, status);

  const update = () => {
    playBtn.textContent = playing ? '❚❚ 一時停止' : index > 0 && index < lines.length ? '▶ 続きから再生' : '▶ 再生';
    bar.firstChild.style.width = `${(index / lines.length) * 100}%`;
    bar.setAttribute('aria-valuenow', index);
  };

  function play() {
    if (!ttsSupported()) { onUnavailable?.('この端末・ブラウザーでは音声の読み上げを利用できません。'); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    if (index >= lines.length) index = 0;
    playing = true; const my = ++token;
    const voices = pickVoices();
    const speakers = [...new Set(lines.map((l) => l.speaker))];
    // 行ごとに発話を登録（ユーザー操作の中でまとめて登録すると iOS でも連続再生できる）
    for (let i = index; i < lines.length; i++) {
      const line = lines[i];
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = 'en-GB'; u.rate = rate;
      const si = speakers.indexOf(line.speaker);
      if (voices.length) u.voice = voices[si % voices.length];
      u.pitch = line.voice === 'female' ? 1.15 : line.voice === 'male' ? 0.85 : 1;
      u.onstart = () => { if (my !== token) return; startedAny = true; index = i; status.textContent = `再生中（${i + 1} / ${lines.length}）`; update(); };
      u.onend = () => {
        if (my !== token) return;
        index = i + 1;
        if (index >= lines.length) { playing = false; status.textContent = '再生が終わりました。もう一度聞くこともできます。'; }
        update();
      };
      u.onerror = (e) => {
        if (my !== token || e.error === 'interrupted' || e.error === 'canceled') return;
        playing = false; update();
        status.textContent = '音声を再生できませんでした。';
        onUnavailable?.('音声を再生できませんでした。スクリプトを読んで学習を続けられます。');
      };
      synth.speak(u);
    }
    status.textContent = '再生を準備しています…';
    update();
    setTimeout(() => {
      if (my === token && playing && !startedAny) {
        status.textContent = '音声が始まらない場合は、端末の消音（マナーモード）や音量を確認してください。';
      }
    }, 4000);
  }
  function pause() { token++; playing = false; if (ttsSupported()) window.speechSynthesis.cancel(); status.textContent = `一時停止中（${Math.min(index + 1, lines.length)}行目から再開します）`; update(); }
  function stop() { token++; playing = false; if (ttsSupported()) window.speechSynthesis.cancel(); update(); }
  update();
  return { el, stop, destroy: stop };
}

/** 1文だけ読み上げる小さなボタン（語彙・Speaking の質問用） */
export function speakButton(text, label = '🔊 聞く') {
  if (!ttsSupported()) return null;
  return h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': `「${text}」を読み上げる`, onclick: () => {
    const s = window.speechSynthesis; s.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB';
    const v = pickVoices(); if (v.length) u.voice = v[0];
    s.speak(u);
  } }, label);
}

// ---------------- 録音（Speaking） ----------------
export function recorderSupported() {
  return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function pickMime() {
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* 未対応 */ }
  }
  return '';
}

/**
 * 録音する。マイクの許可はこの関数を呼んだ時点（ユーザーのタップ後）に初めて求める。
 * 戻り値のオブジェクトの stop() で停止し、結果は onDone(blob, {interrupted}) で受け取る。
 */
export async function startRecording({ maxSeconds = 120, onDone, onError }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    onError?.(denied ? 'マイクの使用が許可されませんでした。録音せずに練習を続けられます（設定アプリ → Safari → マイク で変更できます）。'
      : 'マイクを使用できませんでした。録音せずに練習を続けられます。');
    return null;
  }
  const mime = pickMime();
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch {
    stream.getTracks().forEach((t) => t.stop());
    onError?.('この端末では録音を開始できませんでした。録音せずに練習を続けられます。');
    return null;
  }
  const chunks = []; let interrupted = false; let finished = false;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    if (finished) return; finished = true;
    stream.getTracks().forEach((t) => t.stop());
    document.removeEventListener('visibilitychange', onHide);
    clearTimeout(timer);
    const blob = chunks.length ? new Blob(chunks, { type: rec.mimeType || mime || 'audio/mp4' }) : null;
    onDone?.(blob, { interrupted });
  };
  rec.onerror = () => { interrupted = true; try { rec.stop(); } catch { rec.onstop(); } };
  const onHide = () => { if (document.visibilityState === 'hidden' && rec.state === 'recording') { interrupted = true; rec.stop(); } };
  document.addEventListener('visibilitychange', onHide);
  const timer = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, maxSeconds * 1000);
  rec.start(1000);
  return { stop: () => { if (rec.state === 'recording') rec.stop(); }, cancel: () => { interrupted = true; if (rec.state === 'recording') rec.stop(); } };
}

/** カウントダウン表示（準備時間・回答時間） */
export function countdown(seconds, { label, onEnd }) {
  let left = seconds; let timer = null;
  const text = h('span', { class: 'countdown-num' }, String(left));
  const el = h('div', { class: 'countdown', role: 'timer', 'aria-live': 'off' }, h('span', { class: 'countdown-label' }, label), text, h('span', null, '秒'));
  const tick = () => {
    left--; text.textContent = String(Math.max(0, left));
    if (left <= 0) { clearInterval(timer); timer = null; onEnd?.(); }
  };
  return {
    el,
    start() { if (!timer) timer = setInterval(tick, 1000); },
    stop() { clearInterval(timer); timer = null; },
    reset(sec = seconds) { this.stop(); left = sec; replace(text, String(left)); },
  };
}
