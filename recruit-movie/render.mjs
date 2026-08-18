/**
 * index.html のタイムラインをコマ送りでキャプチャして MP4 に書き出す。
 *
 *   node render.mjs                         # 1920x1080 / 30fps / dist/coretech-recruit.mp4
 *   node render.mjs --fps 15 --scale 0.5    # 確認用の軽いドラフト
 *   node render.mjs --bgm bgm.mp3           # BGM を合成
 *   node render.mjs --from 38000 --to 56000 # 一部シーンだけ書き出し
 *
 * 前提: npm install && npm run setup（フォント配置）
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/* ---------- 引数 ---------- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const FPS = Number(arg('fps', 30));
const SCALE = Number(arg('scale', 1));
const OUT = resolve(root, arg('out', 'dist/coretech-recruit.mp4'));
const BGM = arg('bgm', null);
const FROM = arg('from', null) === null ? null : Number(arg('from'));
const TO = arg('to', null) === null ? null : Number(arg('to'));
const QUALITY = Number(arg('quality', 96));   // 中間 JPEG の品質
const CRF = arg('crf', '18');

/* ---------- ffmpeg を探す ---------- */
function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  // pip の imageio-ffmpeg（フル機能ビルド）にフォールバック
  const py = spawnSync('python3',
    ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  throw new Error('ffmpeg が見つかりません。インストールするか FFMPEG_PATH を指定してください。');
}
const FFMPEG = findFfmpeg();

/* ---------- 本体 ---------- */
const W = Math.round(1920 * SCALE), H = Math.round(1080 * SCALE);
mkdirSync(dirname(OUT), { recursive: true });

if (!existsSync(resolve(root, 'assets/fonts/noto-sans-jp-japanese-900.woff2'))) {
  console.warn('⚠ assets/fonts が空です。`npm install && npm run setup` を実行すると本来の書体で書き出せます。');
}

/**
 * Chromium 起動。バンドル済みブラウザが見つからない環境（CI やコンテナで
 * PLAYWRIGHT_BROWSERS_PATH に別ビルドが置かれている場合）では、
 * 実在する chrome バイナリを探して executablePath として渡す。
 */
async function launchChromium() {
  const args = ['--force-color-profile=srgb', '--font-render-hinting=none'];
  try {
    return await chromium.launch({ args });
  } catch (err) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const found = process.env.CHROME_PATH || (base && existsSync(base)
      ? readdirSync(base)
          .filter(d => d.startsWith('chromium-'))
          .map(d => resolve(base, d, 'chrome-linux/chrome'))
          .find(existsSync)
      : null);
    if (!found) throw err;
    console.warn(`… 既定のブラウザが見つからないため ${found} を使用します`);
    return await chromium.launch({ args, executablePath: found });
  }
}

const browser = await launchChromium();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: SCALE
});
await page.goto(pathToFileURL(resolve(root, 'index.html')).href + '?render=1');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

const duration = await page.evaluate(() => window.__duration);
const start = FROM ?? 0;
const end = TO ?? duration;
const total = Math.round(((end - start) / 1000) * FPS);

const ff = spawn(FFMPEG, [
  '-y',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
  ...(BGM ? ['-i', resolve(process.cwd(), BGM)] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
  '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-vf', `scale=${W}:${H}:flags=lanczos`,
  ...(BGM ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
  '-movflags', '+faststart',
  OUT
], { stdio: ['pipe', 'inherit', 'inherit'] });

const write = buf => new Promise(res => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

console.log(`▶ 書き出し開始: ${total} フレーム / ${FPS}fps / ${W}x${H}`);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const t = start + (i / FPS) * 1000;
  await page.evaluate(ms => window.__seek(ms), t);
  const shot = await page.screenshot({ type: 'jpeg', quality: QUALITY });
  await write(shot);
  if (i % 60 === 0 || i === total - 1) {
    const pct = ((i + 1) / total * 100).toFixed(1);
    const eta = ((Date.now() - t0) / (i + 1) * (total - i - 1) / 1000).toFixed(0);
    process.stdout.write(`\r  ${pct}%  (${i + 1}/${total})  残り約 ${eta}s   `);
  }
}
process.stdout.write('\n');

ff.stdin.end();
await new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
await browser.close();
console.log(`✓ 完成: ${OUT}`);
