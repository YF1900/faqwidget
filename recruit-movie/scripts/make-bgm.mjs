/**
 * 動画用の BGM（92秒）をコードから合成して assets/bgm.wav を書き出す。
 * 外部の音源素材を一切使わないため、権利関係のクリアが不要。
 *   使い方: npm run bgm
 *
 * 構成: Am – F – C – G の循環（100BPM / 4拍子 / 全38小節）を、
 *       映像のシーン切り替えに合わせて段階的に厚くしていく。
 *   0:00 イントロ（パッド＋アルペジオ）
 *   0:11 リズムイン（キック＋ハイハット＋ベース）
 *   0:24 クラップ追加
 *   0:38 リード（VALUEシーン）
 *   1:11 ブレイクダウン（ドラムを抜く）
 *   1:19 再構築 → 1:24 クライマックス → フェードアウト
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 44100;
const BPM = 100;
const BEAT = 60 / BPM;          // 0.6s
const BAR = BEAT * 4;           // 2.4s
const DUR = 92.4;               // 映像（92.0s）より気持ち長く取り、末尾でフェード
const N = Math.floor(SR * DUR);

/* ---------- バス ---------- */
const dryL = new Float32Array(N);
const dryR = new Float32Array(N);
const send = new Float32Array(N);   // リバーブ送り（モノ）

const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const idx = t => Math.floor(t * SR);

/** 汎用: 任意の波形関数をバスに書き込む */
function place(t0, dur, fn, { pan = 0, sendAmt = 0 } = {}) {
  const s0 = idx(t0), len = Math.floor(dur * SR);
  if (s0 >= N) return;
  const gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan);
  for (let i = 0; i < len; i++) {
    const j = s0 + i;
    if (j >= N) break;
    const v = fn(i / SR, i / len);
    dryL[j] += v * gl;
    dryR[j] += v * gr;
    if (sendAmt) send[j] += v * sendAmt;
  }
}

const adsr = (t, dur, a, d, s, r) => {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  return Math.max(0, s * (1 - (t - (dur - r)) / r));
};

/* ---------- 音色 ---------- */
// やわらかいパッド（倍音を重ねた2オシレーターのデチューン）
function pad(note, t0, dur, amp = 0.062, pan = 0) {
  const f = midi(note);
  place(t0, dur, t => {
    const env = adsr(t, dur, 0.9, 0.4, 0.85, 0.9);
    let v = 0;
    for (const [h, a] of [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]]) {
      v += a * (Math.sin(2 * Math.PI * f * h * t) + Math.sin(2 * Math.PI * f * 1.0015 * h * t)) * 0.5;
    }
    // ゆっくりした揺らぎ
    return v * env * amp * (0.9 + 0.1 * Math.sin(2 * Math.PI * 0.13 * t));
  }, { pan, sendAmt: 0.42 });
}

// ベース（正弦＋軽い倍音）
function bass(note, t0, dur, amp = 0.26) {
  const f = midi(note);
  place(t0, dur, t => {
    const env = adsr(t, dur, 0.012, 0.10, 0.72, 0.14);
    const v = Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t);
    return Math.tanh(v * 1.2) * env * amp;
  });
}

// アルペジオのプラック
function pluck(note, t0, amp = 0.13, pan = 0) {
  const f = midi(note), dur = 0.9;
  place(t0, dur, t => {
    const env = Math.exp(-t * 5.2);
    const v = Math.sin(2 * Math.PI * f * t)
      + 0.38 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 9)
      + 0.14 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 14);
    return v * env * amp;
  }, { pan, sendAmt: 0.5 });
}

// リード（三角波に近い倍音構成）
function lead(note, t0, dur, amp = 0.085) {
  const f = midi(note);
  place(t0, dur + 0.25, t => {
    const env = adsr(t, dur + 0.25, 0.07, 0.15, 0.8, 0.25);
    const v = Math.sin(2 * Math.PI * f * t)
      + Math.sin(6 * Math.PI * f * t) / 9
      + Math.sin(10 * Math.PI * f * t) / 25;
    const vib = 1 + 0.0025 * Math.sin(2 * Math.PI * 5.2 * t);
    return Math.sin(2 * Math.PI * f * vib * t) * 0.35 * env * amp + v * env * amp * 0.65;
  }, { sendAmt: 0.55 });
}

// キック
function kick(t0, amp = 0.40) {
  place(t0, 0.42, t => {
    const f = 48 + 95 * Math.exp(-t * 26);
    const env = Math.exp(-t * 7.5);
    return Math.tanh(Math.sin(2 * Math.PI * f * t) * 1.6) * env * amp;
  });
}

// ハイハット（ノイズを微分してハイ寄りに）
let noiseSeed = 12345;
const noise = () => {
  noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
  return (noiseSeed / 0x3fffffff) - 1;
};
function hat(t0, amp = 0.05, pan = 0.25) {
  let prev = 0;
  place(t0, 0.09, t => {
    const n = noise();
    const hp = n - prev; prev = n;
    return hp * Math.exp(-t * 62) * amp;
  }, { pan, sendAmt: 0.12 });
}

// クラップ（帯域を絞ったノイズ）
function clap(t0, amp = 0.085) {
  let p1 = 0, p2 = 0;
  place(t0, 0.26, t => {
    const n = noise();
    p1 += (n - p1) * 0.35;          // ローパス
    const band = p1 - p2; p2 += (p1 - p2) * 0.06;   // ハイパス → バンド
    const env = Math.exp(-t * 15) * (t < 0.02 ? t / 0.02 : 1);
    return band * env * amp * 3.2;
  }, { sendAmt: 0.35 });
}

/* ---------- 進行 ---------- */
// Am – F – C – G
const CHORDS = [
  { pad: [57, 60, 64, 69], bass: 45, arp: [69, 72, 76, 72] },   // Am
  { pad: [53, 57, 60, 65], bass: 41, arp: [65, 69, 72, 69] },   // F
  { pad: [60, 64, 67, 72], bass: 48, arp: [72, 76, 79, 76] },   // C
  { pad: [55, 59, 62, 67], bass: 43, arp: [67, 71, 74, 71] }    // G
];
// リードのモチーフ（コードトーンのみ・4小節ワンフレーズ）
const MOTIF = [
  [[0, 1.2, 76], [1.5, 0.9, 72]],
  [[0, 1.2, 72], [1.5, 0.9, 69]],
  [[0, 1.8, 79], [2.1, 0.6, 76]],
  [[0, 2.4, 74]]
];

const BARS = Math.ceil(DUR / BAR);
for (let b = 0; b < BARS; b++) {
  const t = b * BAR;
  if (t > DUR - 0.2) break;
  const c = CHORDS[b % 4];
  const drums = (t >= 11 && t < 71) || t >= 79;
  const claps = (t >= 24 && t < 71) || t >= 79;
  const hasBass = (t >= 11 && t < 71) || t >= 79;
  const hasLead = t >= 38;

  // パッドは常時
  c.pad.forEach((n, i) => pad(n, t, BAR + 0.5, 0.062, (i % 2 ? 0.22 : -0.22)));

  // アルペジオ（8分の裏を含む4音）
  c.arp.forEach((n, i) => {
    const amp = t < 11 ? 0.10 : 0.12;
    pluck(n, t + i * BEAT, amp, i % 2 ? 0.3 : -0.3);
    if (t >= 24) pluck(n + 12, t + i * BEAT + BEAT / 2, amp * 0.35, i % 2 ? -0.35 : 0.35);
  });

  if (hasBass) {
    bass(c.bass, t, BEAT * 1.7);
    bass(c.bass, t + BEAT * 2, BEAT * 1.7);
  }
  if (drums) {
    kick(t); kick(t + BEAT * 2);
    if (t >= 24) kick(t + BEAT * 3.5, 0.28);
    for (let i = 0; i < 8; i++) hat(t + i * (BEAT / 2), i % 2 ? 0.022 : 0.038);
  }
  if (claps) { clap(t + BEAT); clap(t + BEAT * 3); }
  if (hasLead) {
    const phrase = MOTIF[(b - Math.round(38 / BAR)) % 4] || MOTIF[b % 4];
    // ブレイクダウン中はリードのみ残す
    phrase.forEach(([off, dur, note]) => lead(note, t + off, dur, t >= 71 && t < 79 ? 0.075 : 0.085));
  }
}

// 1:24 のクライマックスに合わせたコードの一撃
[84.0].forEach(t => {
  [57, 60, 64, 69, 72].forEach((n, i) => pad(n, t, 8.0, 0.062, i % 2 ? 0.25 : -0.25));
  kick(t, 0.46);
});

/* ---------- リバーブ（Schroeder）---------- */
function reverb(input, combDelays, combFb, apDelays) {
  const out = new Float32Array(N);
  for (let ci = 0; ci < combDelays.length; ci++) {
    const d = combDelays[ci], fb = combFb[ci], buf = new Float32Array(d);
    let p = 0, damp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[p];
      damp += (y - damp) * 0.42;                 // 高域を落として自然に
      buf[p] = input[i] + damp * fb;
      p = (p + 1) % d;
      out[i] += y * 0.25;
    }
  }
  for (const d of apDelays) {
    const buf = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < N; i++) {
      const bufOut = buf[p];
      const y = -0.6 * out[i] + bufOut;
      buf[p] = out[i] + 0.6 * bufOut;
      p = (p + 1) % d;
      out[i] = y;
    }
  }
  return out;
}
const wetL = reverb(send, [1557, 1617, 1491, 1422], [0.80, 0.79, 0.78, 0.77], [225, 556]);
const wetR = reverb(send, [1601, 1663, 1531, 1465], [0.79, 0.78, 0.79, 0.76], [241, 593]);

/* ---------- ミックス ---------- */
const out = new Float32Array(N * 2);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 2.0);
  const fadeOut = t > 89.6 ? Math.max(0, 1 - (t - 89.6) / 2.4) : 1;
  const g = fadeIn * fadeOut;
  let l = (dryL[i] + wetL[i] * 0.62) * g;
  let r = (dryR[i] + wetR[i] * 0.62) * g;
  l = Math.tanh(l * 1.05); r = Math.tanh(r * 1.05);
  out[i * 2] = l; out[i * 2 + 1] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const norm = 0.82 / (peak || 1);

/* ---------- WAV 書き出し（16bit PCM）---------- */
const bytes = Buffer.alloc(44 + N * 4);
bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + N * 4, 4); bytes.write('WAVE', 8);
bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 4, 28);
bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
bytes.write('data', 36); bytes.writeUInt32LE(N * 4, 40);
let rms = 0;
for (let i = 0; i < N * 2; i++) {
  const v = Math.max(-1, Math.min(1, out[i] * norm));
  rms += v * v;
  bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
mkdirSync(resolve(root, 'assets'), { recursive: true });
const outPath = resolve(root, 'assets/bgm.wav');
writeFileSync(outPath, bytes);
console.log(`✓ ${outPath}`);
console.log(`  長さ ${DUR}s / ピーク ${(20 * Math.log10(peak * norm)).toFixed(1)}dBFS / RMS ${(10 * Math.log10(rms / (N * 2))).toFixed(1)}dBFS`);
