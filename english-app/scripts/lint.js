// 簡易 Lint（外部依存なし）
// 1. すべての JavaScript の構文チェック
// 2. 画面のコードで innerHTML / outerHTML / insertAdjacentHTML / document.write / eval を使わない（XSS 対策）
// 3. 画面のファイルから外部 URL を読み込まない（個人情報が第三者に送られないようにする）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = ['public', 'server', 'scripts', 'test'].flatMap((d) => walk(path.join(root, d)));
let problems = 0;
const report = (f, msg) => { problems++; console.error(`${path.relative(root, f)}: ${msg}`); };

for (const f of files.filter((x) => /\.(m?js)$/.test(x))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { report(f, e.stderr.toString().split('\n').slice(0, 4).join(' ')); }
}
for (const f of files.filter((x) => x.includes(`${path.sep}public${path.sep}`) && /\.(js|html|css|webmanifest)$/.test(x))) {
  const src = fs.readFileSync(f, 'utf8');
  if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/.test(src)) report(f, '安全でない DOM 操作（innerHTML など）を使用しています');
  const urls = src.match(/https?:\/\/[^\s'"`)]+/g) || [];
  for (const u of urls) if (!/^http:\/\/www\.w3\.org\//.test(u)) report(f, `外部 URL を参照しています: ${u}`);
  if (/\bconsole\.log\(/.test(src)) report(f, 'console.log が残っています');
}
if (problems) { console.error(`\n${problems} 件の問題があります`); process.exit(1); }
console.log(`Lint OK（${files.length} ファイル）`);
