// iPhone 縦画面相当（Playwright の iPhone 13 エミュレーション: 390×844, タッチ, モバイル Safari の UA）で
// 主要な学習フローを通しで検証する。Chromium で動かすため、実機 Safari（WebKit）での動作確認の代わりにはならない。
// 使い方: npm run e2e   （一時データベースを使うので、既存の data/app.db には影響しない）
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(execSync('npm root -g').toString().trim() + '/');
const { chromium, devices } = req('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-e2e-'));
const shotsDir = path.join(root, 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });
const env = { ...process.env, DB_FILE: path.join(tmp, 'e2e.db'), PORT: '3998', NODE_ENV: 'test' };
execSync('node --disable-warning=ExperimentalWarning scripts/seed-demo.js', { cwd: root, env });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1200));
const base = 'http://127.0.0.1:3998';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: [] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
let shotNo = 0;
const shot = async (name) => page.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`) });
const noHScroll = async (label) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (sw > cw) check(`横スクロールなし: ${label}`, false, `${sw} > ${cw}`);
  return sw <= cw;
};
const go = async (hash) => { await page.goto(`${base}/${hash}`); await page.waitForTimeout(500); };
const clickText = (t) => page.getByRole('button', { name: t }).first().click();
const confirmIfDialog = async () => { const d = page.locator('dialog[open] .btn-primary, dialog[open] .btn-danger'); if (await d.count()) await d.first().click(); };

try {
  // ---- 1. 新規登録 → 目標設定 → 診断 ----
  await go('#/register');
  await page.fill('input[autocapitalize=characters]', 'DEMO2026');
  await page.fill('input[autocomplete=username]', 'e2e-student');
  await page.fill('input[autocomplete=nickname]', 'テスト生徒');
  await page.fill('input[autocomplete=new-password]', 'e2e-pass-123');
  await page.check('.consent input[type=checkbox]');
  await shot('register');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/onboarding/);
  await page.check('input[value=B1]');
  await shot('onboarding');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/diagnostic/);
  check('新規生徒が目標を選び診断に進める', true);
  await noHScroll('診断');
  await clickText('次へ →'); // intro → r-A2
  for (let pg = 0; pg < 18; pg++) {
    const cards = page.locator('.qcard');
    const n = await cards.count();
    for (let i = 0; i < n; i++) await cards.nth(i).locator('.option').first().click();
    if (pg === 9) {
      // Listening A2: 音声の再生ボタン（ユーザー操作で開始）を確認
      check('Listening に再生ボタンがある（自動再生しない）', await page.getByRole('button', { name: /再生/ }).count() > 0);
      await shot('diagnostic-listening');
    }
    await noHScroll(`診断ページ${pg + 2}`);
    await clickText('次へ →');
  }
  await page.fill('#diag-writing', 'I am in the tennis club. We practise every day after school. It is hard but fun because my friends are kind.');
  await page.locator('.check input').nth(0).check(); await page.locator('.check input').nth(1).check(); await page.locator('.check input').nth(3).check();
  await clickText('次へ →');
  await page.locator('.check input').nth(0).check(); await page.locator('.check input').nth(1).check();
  await clickText('次へ →');
  await clickText('回答を送信して結果を見る');
  await page.waitForSelector('text=診断の結果（教材を選ぶための目安）');
  check('診断結果に「目安」「公式スコアではない」旨を表示', await page.locator('text=Cambridge English Scale のスコア').count() > 0);
  await shot('diagnostic-result');
  await clickText('ダッシュボードへ');
  await page.waitForSelector('#today-title');
  await shot('home');
  await noHScroll('ホーム');
  const todayHref = await page.locator('.today-main').getAttribute('href');
  check('ダッシュボードに今日の推奨課題が表示される', !!todayHref, todayHref);
  await page.click('.today-main');
  await page.waitForSelector('.act-title');
  check('推奨教材を開ける', true, page.url().split('#')[1]);

  // ---- 2. A2・B1・B2 の第1単元を最後まで進める ----
  for (const lv of ['a2', 'b1', 'b2']) {
    const unitId = `school-life-${lv}-u1`;
    const unit = (await (await page.request.get(`${base}/api/units/${unitId}`)).json()).unit;
    for (const act of unit.activities) {
      await go(`#/unit/${unitId}/step/${act.step}`);
      await page.waitForSelector('.act-title');
      if (act.kind === 'listening') {
        await page.getByRole('button', { name: '音声が聞こえない・使えない場合' }).click();
        if (lv === 'a2') check('音声が使えないときスクリプトで学習を続けられる', await page.locator('.script-line').count() > 0);
      }
      if (act.kind === 'reading' && act.questions.length) await page.getByRole('tab', { name: /設問/ }).click();
      // 設問: 正答を選んで解答（A2 のみ 1問目はわざと不正解にして復習を作る）
      for (const [qi, q] of act.questions.entries()) {
        const card = page.locator(`#q-${q.id}`);
        const wrong = lv === 'a2' && qi === 0 && act.kind === 'reading';
        if (q.type === 'mcq') await card.locator('.option').nth(wrong ? (q.answer + 1) % q.options.length : q.answer).click();
        else await card.locator('input.text-answer').fill(q.accept[0]);
        await card.getByRole('button', { name: '解答する' }).click();
        await card.locator('.result').waitFor();
      }
      if (act.kind === 'reading' && lv === 'a2') {
        const card = page.locator(`#q-${act.questions[0].id}`);
        check('Reading 回答後に解説と根拠を表示', await card.locator('.explanation').count() > 0 && await card.locator('.evidence-box').count() > 0);
        await card.getByRole('button', { name: '本文で確認する' }).click();
        check('根拠を本文中で強調表示', await page.locator('.pane-passage mark.evidence').isVisible());
        await shot('reading-evidence');
      }
      if (act.kind === 'listening' && lv === 'b1') {
        const card = page.locator(`#q-${act.questions[0].id}`);
        check('Listening 回答後に解説と根拠を表示', await card.locator('.explanation').count() > 0 && await card.locator('.evidence-box blockquote').count() > 0);
        await shot('listening-answered');
      }
      if (act.kind === 'writing') {
        const ta = page.locator('textarea[id^=ta-]');
        const words = Array.from({ length: act.task.minWords + 2 }, (_, i) => (i % 7 === 6 ? 'club.' : 'we like our club')).join(' ').split(' ').slice(0, act.task.minWords + 2).join(' ');
        await ta.fill(words.slice(0, 40));
        await page.waitForTimeout(700);
        if (lv === 'a2') {
          // キーボード表示中（入力欄にフォーカス）は固定フッターを隠し、提出ボタンに到達できる
          await ta.focus();
          check('入力中は下部の固定バーを隠す', await page.evaluate(() => document.body.classList.contains('kbd-open')) && !(await page.locator('.step-footer').isVisible()));
          await shot('writing-keyboard');
          // 画面を離れて戻る（再読み込み）→ 下書き復元
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await page.reload(); await page.waitForSelector('textarea[id^=ta-]');
          const restored = await page.locator('textarea[id^=ta-]').inputValue();
          check('Writing の下書きを再読み込み後に復元', restored === words.slice(0, 40), `"${restored.slice(0, 20)}…"`);
          check('復元したことを表示', (await page.locator('.draft-status').textContent()).includes('復元'));
        }
        await page.locator('textarea[id^=ta-]').fill(words);
        await page.locator('.card .check input').first().check();
        const submit = page.getByRole('button', { name: '提出する' });
        await submit.scrollIntoViewIfNeeded();
        check(`Writing(${lv}) の提出ボタンが画面内に表示できる`, await submit.isVisible());
        await submit.click();
        await page.locator('.save-saved').first().waitFor();
      }
      if (act.kind === 'speaking') {
        // マイクの許可を与えていない状態で「録音して練習する」→ 拒否 → 録音なしで継続
        await page.getByRole('button', { name: '🎙 録音して練習する' }).click();
        await page.waitForTimeout(500);
        if (lv === 'a2') {
          const txt = await page.locator('main').textContent();
          check('録音の許可を求める理由を事前に説明', txt.includes('マイクの使用許可が必要') && txt.includes('サーバーや先生には送信されません'));
          check('録音を拒否しても録音なしで練習に切り替わる', txt.includes('録音なしで練習'));
          await shot('speaking-denied');
        }
        await page.getByRole('button', { name: /準備を始める/ }).first().click();
        await page.getByRole('button', { name: '準備を終えて話す' }).click();
        await page.getByRole('button', { name: '話し終えた' }).click();
        await page.locator('.speak-part textarea').first().fill('I am in the tennis club.');
        await page.getByRole('button', { name: '練習を記録する' }).click();
        await page.locator('.save-saved').first().waitFor();
        if (lv === 'a2') check('録音なしで Speaking 練習を記録できる', true);
      }
      await noHScroll(`${lv} step ${act.step}`);
      if (act.kind === 'wrapup') await shot(`${lv}-wrapup`);
      // 次へ（完了）
      const next = page.locator('.step-footer .btn').last();
      await next.click();
      await page.waitForTimeout(400);
    }
    const u = (await (await page.request.get(`${base}/api/units`)).json()).units.find((x) => x.id === unitId);
    check(`${lv.toUpperCase()} 第1単元を最後まで完了`, u.isComplete, `${u.completed}/${u.total}`);
  }

  // ---- 3. 再読み込み後も進捗・提出が保持される ----
  await go('#/home'); await page.reload(); await page.waitForSelector('#today-title');
  const dash = await (await page.request.get(`${base}/api/dashboard`)).json();
  check('再読み込み後も完了単元と提出が保持', dash.completedUnits.length === 3 && dash.history.some((e) => e.type === 'submitted'), `完了単元 ${dash.completedUnits.length}`);
  check('復習が自動で提案される', dash.dueCount >= 0 && (await (await page.request.get(`${base}/api/review`)).json()).upcoming.length + dash.dueCount > 0);
  await shot('home-after');

  // ---- 4. 通信エラー時に保存状態を誤表示しない ----
  await go('#/unit/school-life-a2-u1/step/1');
  await page.waitForSelector('.qcard');
  const q0 = page.locator('.qcard').first();
  await q0.getByRole('button', { name: 'もう一度解く' }).click();
  await ctx.setOffline(true);
  await q0.locator('.option').first().click();
  await q0.getByRole('button', { name: '解答する' }).click();
  await q0.locator('.save-badge').waitFor();
  const badge = await q0.locator('.save-badge').textContent();
  check('オフライン時は「未送信」と表示し「保存済み」と表示しない', badge.includes('未送信') && !badge.includes('保存済み'), badge);
  check('未送信件数と再送ボタンを表示', await page.locator('#netbar').isVisible() && (await page.locator('#netbar').textContent()).includes('未送信'));
  await shot('offline');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  check('通信回復後に再送して未送信が0件になる', await page.locator('#netbar').isHidden());

  // ---- 5. 教員が教材を編集 → 生徒画面に反映 ----
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tp = await tctx.newPage();
  tp.on('pageerror', (e) => errors.push('teacher: ' + e.message));
  await tp.goto(`${base}/#/login`);
  await tp.fill('input[autocomplete=username]', 'demo-teacher');
  await tp.fill('input[type=password]', 'demo-pass-123');
  await tp.click('button[type=submit]');
  await tp.waitForURL(/#\/t$/);
  await tp.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-teacher-home-pc.png`) });
  await tp.goto(`${base}/#/t/content/school-life-a2-u1`);
  await tp.waitForSelector('.editor-block');
  await tp.locator('.editor-block').first().locator('summary').first().click();
  const qe = tp.locator('.qeditor').first();
  await qe.locator('summary').click();
  const stem = qe.locator('textarea').first();
  const newStem = `${await stem.inputValue()} (edited)`;
  await stem.fill(newStem);
  await qe.getByRole('button', { name: '問題を保存' }).click();
  await qe.locator('.ok-text').waitFor();
  check('教員が問題を編集すると版が上がる', (await qe.locator('.ok-text').textContent()).includes('v2'));
  await tp.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-editor-pc.png`) });
  await go('#/home'); await go('#/unit/school-life-a2-u1/step/1'); await page.waitForSelector('.qcard');
  check('編集内容が生徒画面に反映される', (await page.locator('.qcard .qstem').first().textContent()).includes('(edited)'));

  // 教員: 生徒の状況と Writing 評価
  await tp.goto(`${base}/#/t`);
  await tp.waitForSelector('.class-list a');
  await tp.locator('.class-list a').first().click();
  await tp.waitForSelector('.data-table');
  check('教員がクラスの生徒の技能別状況を見られる', (await tp.locator('.data-table').textContent()).includes('テスト生徒'));
  await tp.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-teacher-class-pc.png`) });
  await tp.goto(`${base}/#/t`);
  await tp.locator('a[href^="#/t/submission/"]').first().click();
  await tp.waitForSelector('.score-group');
  for (const g of await tp.locator('.score-group').all()) await g.locator('.score').nth(4).click();
  await tp.fill('#fb-comment', 'Good job! 理由をもう1つ加えましょう。');
  await tp.getByRole('button', { name: /評価を保存/ }).click();
  await tp.waitForTimeout(800);
  check('教員が Writing/Speaking に評価とコメントを付けられる', (await tp.locator('.feedback').count()) > 0);
  // 教員（iPhone 幅）でも生徒の状況を確認できる
  const tm = await browser.newContext({ ...devices['iPhone 13'] });
  const tmp2 = await tm.newPage();
  await tmp2.goto(`${base}/#/login`);
  await tmp2.fill('input[autocomplete=username]', 'demo-teacher');
  await tmp2.fill('input[type=password]', 'demo-pass-123');
  await tmp2.click('button[type=submit]');
  await tmp2.waitForURL(/#\/t$/);
  await tmp2.locator('.class-list a').first().click();
  await tmp2.waitForSelector('.data-table');
  const [tsw, tcw] = await tmp2.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  check('教員画面も iPhone 幅でページ全体が横スクロールしない（表は枠内でスクロール）', tsw <= tcw, `${tsw}/${tcw}`);
  await tmp2.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-teacher-class-iphone.png`) });
  await tm.close();

  // ---- 6. 生徒側に評価が届く・キーボード操作 ----
  await go('#/home');
  check('生徒の履歴に先生の評価が届く', (await page.locator('.timeline').textContent()).includes('先生の評価'));
  await go('#/unit/school-life-b1-u1/step/1');
  await page.waitForSelector('.qcard');
  await page.locator('.qcard').first().getByRole('button', { name: 'もう一度解く' }).click();
  await page.locator('.qcard input[type=radio]').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('キーボードだけで選択・解答できる', await page.locator('.qcard').first().locator('.result').count() > 0);

  // ---- 6b. 単語帳・スタンプ ----
  await go('#/cards/school-life-a2-u1');
  await page.waitForSelector('.flashcard');
  check('単語帳でカードを表示できる', await page.locator('.flash-front').isVisible());
  await page.getByRole('button', { name: '意味を見る' }).click();
  check('カードの意味と例文を表示できる', await page.locator('.flash-meaning').isVisible());
  await shot('cards-learn');
  await noHScroll('単語帳');
  await page.getByRole('tab', { name: /小テスト/ }).click();
  await page.locator('.qcard .option').first().click();
  await page.getByRole('button', { name: '解答する' }).click();
  await page.locator('.qcard .result').waitFor();
  check('単語帳の小テストでスタンプの進み具合を表示', await page.locator('.qcard .stamp-line').count() > 0);
  await shot('cards-quiz');
  await go('#/unit/school-life-b2-u1/step/1');
  await page.waitForSelector('.qcard .result');
  await page.locator('.qcard').first().getByRole('button', { name: 'もう一度解く' }).click();
  await page.locator('.qcard').first().locator('.option').first().click();
  await page.locator('.qcard').first().getByRole('button', { name: '解答する' }).click();
  await page.locator('.qcard').first().locator('.result').waitFor();
  check('単元の問題でもスタンプの進み具合を表示', await page.locator('.qcard').first().locator('.stamp-line').count() > 0);
  await go('#/stamps');
  await page.waitForSelector('.stamp-book');
  check('スタンプ帳にレベル別の称号と進み具合を表示', await page.locator('.stamp-book').count() === 3 && await page.locator('.stamp-grid span').count() > 100);
  await shot('stamps');
  await noHScroll('スタンプ帳');
  check('タブは5つ以内（単語帳・スタンプを含む）', await page.locator('#tabbar .tab').count() === 5 && await page.locator('#settings-link').isVisible());
  await go('#/home');
  check('ホームにスタンプのまとめを表示', await page.locator('.stamp-summary').isVisible());

  // ---- 7. セーフエリア: 下部バーが env(safe-area-inset-bottom) を考慮 ----
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.tabbar')).paddingBottom);
  check('下部バーの余白にセーフエリアを加算（CSS）', fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8').includes('env(safe-area-inset-bottom'), `現在の padding-bottom ${pad}`);
  const fontOk = await page.evaluate(() => [...document.querySelectorAll('input, textarea, select')].every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16 || e.type === 'radio' || e.type === 'checkbox'));
  check('入力欄の文字サイズが16px以上（Safari の自動拡大を防ぐ）', fontOk);
  await tctx.close();
} catch (e) {
  check('E2E の実行', false, e.stack || e.message);
  await shot('failure').catch(() => {});
} finally {
  if (errors.length) check('ページで JavaScript エラーが発生しない', false, errors.join(' | ')); else check('ページで JavaScript エラーが発生しない', true);
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 件成功。スクリーンショット: screenshots/`);
  process.exit(failed.length ? 1 : 0);
}
