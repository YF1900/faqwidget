/**
 * assets/fonts/ に Web フォント（Noto Sans JP / Zen Kaku Gothic New）を配置する。
 * フォント本体はリポジトリに含めず、npm 経由で取得したものをコピーする。
 *   使い方: npm install && npm run setup
 * ライセンス: SIL Open Font License 1.1（各パッケージの LICENSE を参照）
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets/fonts');
mkdirSync(out, { recursive: true });

const JOBS = [
  ...['400', '700', '900'].flatMap(w => ['latin', 'japanese'].map(sub => [
    `@fontsource/noto-sans-jp/files/noto-sans-jp-${sub}-${w}-normal.woff2`,
    `noto-sans-jp-${sub}-${w}.woff2`
  ])),
  ...['latin', 'japanese'].map(sub => [
    `@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-${sub}-900-normal.woff2`,
    `zen-kaku-gothic-new-${sub}-900.woff2`
  ])
];

let ok = 0;
for (const [from, to] of JOBS) {
  const src = resolve(root, 'node_modules', from);
  if (!existsSync(src)) {
    console.error(`✗ 見つかりません: ${from}（npm install を先に実行してください）`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(src, resolve(out, to));
  ok++;
}
console.log(`✓ フォント ${ok} ファイルを assets/fonts/ に配置しました`);
