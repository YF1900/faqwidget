// アイコン PNG を SVG から生成する（開発時に一度だけ実行。Playwright を使用）
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
// playwright はグローバルにインストールされたものを使う
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
import fs from 'node:fs';
const svg = fs.readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname, omitBackground: false });
}
await browser.close();
