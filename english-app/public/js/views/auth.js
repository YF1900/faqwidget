// ログイン・新規登録・個人情報の取り扱い・このアプリについて
import { h, replace } from '../dom.js';
import { api } from '../api.js';
import { state, setTitle, refreshMe, go, isTeacher } from '../main.js';
import { disclaimer } from '../components.js';

function field(label, input, hint) {
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);
}

function afterLogin() {
  const me = state.me;
  if (isTeacher()) return go('#/t');
  if (me.needsPrivacyAgreement) return go('#/privacy');
  if (!me.target) return go('#/onboarding');
  go('#/home');
}

export async function loginView() {
  setTitle('ログイン');
  if (state.me) { afterLogin(); return null; }
  const loginId = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'ログイン');
  const form = h('form', { class: 'card form', onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; replace(msg);
    try {
      await api.post('/api/auth/login', { loginId: loginId.value, password: password.value });
      await refreshMe();
      afterLogin();
    } catch (err) { replace(msg, err.message); btn.disabled = false; }
  } }, field('ログインID', loginId), field('パスワード', password), msg, btn);
  return h('div', { class: 'stack narrow' },
    h('div', { class: 'hero' }, h('p', { class: 'hero-logo', 'aria-hidden': 'true' }, 'English Steps'), h('p', { class: 'hero-sub' }, '高校生のためのレベル別英語学習（A2・B1・B2）')),
    form,
    h('p', { class: 'center' }, '初めての人は ', h('a', { href: '#/register' }, 'クラス参加コードで登録')),
    h('p', { class: 'center small' }, h('a', { href: '#/privacy' }, '個人情報の取り扱い'), '　', h('a', { href: '#/about' }, 'このアプリについて')),
    disclaimer());
}

export async function registerView() {
  setTitle('新規登録', { back: '#/login' });
  const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true, maxlength: 12 });
  const loginId = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true, pattern: '[A-Za-z0-9._\\-]{3,32}' });
  const name = h('input', { type: 'text', autocomplete: 'nickname', required: true, maxlength: 20 });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const agree = h('input', { type: 'checkbox', required: true });
  const msg = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '登録する');
  return h('div', { class: 'stack narrow' },
    h('form', { class: 'card form', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; replace(msg);
      try {
        await api.post('/api/auth/register', { joinCode: code.value, loginId: loginId.value, displayName: name.value, password: pw.value, privacyAgreed: agree.checked });
        await refreshMe();
        go('#/onboarding');
      } catch (err) { replace(msg, err.message); btn.disabled = false; }
    } },
    h('p', null, '先生から配られた「クラス参加コード」を使って登録します。'),
    field('クラス参加コード', code, '8文字の英数字（例: ABCD2345）'),
    field('ログインID', loginId, '半角英数字3〜32文字。先生の指示がある場合はそれに従ってください（例: 1a-12）。'),
    field('表示名（ニックネーム）', name, '本名は入力しないでください。先生と自分が分かる呼び名で十分です。'),
    field('パスワード', pw, '8文字以上。他のサービスと同じパスワードは使わないでください。'),
    h('div', { class: 'consent' },
      h('p', null, '登録前に ', h('a', { href: '#/privacy', target: '_blank' }, '個人情報の取り扱い'), ' を読んでください。保護者の方と一緒に確認することをおすすめします。'),
      h('label', { class: 'check' }, agree, h('span', null, '個人情報の取り扱いを読み、内容に同意します'))),
    msg, btn));
}

export async function privacyView() {
  setTitle('個人情報の取り扱い', { back: state.me ? (isTeacher() ? '#/settings' : '#/settings') : '#/login' });
  let cfg = { orgName: '', privacyContact: '', retention: '' };
  try { cfg = await api.get('/api/config'); } catch { /* 表示は続ける */ }
  const org = cfg.orgName || '（本アプリを導入する学校。管理者が設定してください）';
  const contact = cfg.privacyContact || '（学校の担当窓口。管理者が設定してください）';
  const sec = (title, ...body) => h('section', { class: 'policy-sec' }, h('h3', null, title), ...body);
  const list = (...items) => h('ul', null, items.map((i) => h('li', null, i)));
  const needs = state.me?.needsPrivacyAgreement && !isTeacher();
  const agreeBtn = needs ? h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async () => {
    agreeBtn.disabled = true;
    try { await api.post('/api/me/privacy-agreement', { agreed: true }); await refreshMe(); go(state.me.target ? '#/home' : '#/onboarding'); } catch (e) { agreeBtn.disabled = false; alert(e.message); }
  } }, '内容を確認し、同意する') : null;
  return h('div', { class: 'stack narrow' }, h('article', { class: 'card policy' },
    h('h2', null, '個人情報の取り扱いについて'),
    h('p', { class: 'small muted' }, `版: ${state.me?.privacyVersion || '2026-09-01'}`),
    needs ? h('p', { class: 'notice' }, '内容が更新されました。確認して同意してください。') : null,
    sec('1. 運営者と問い合わせ先', h('p', null, `運営者: ${org}`), h('p', null, `問い合わせ・開示・削除の依頼: ${contact}`)),
    sec('2. 保存する情報', list('ログインID、表示名（ニックネーム）、パスワード（元に戻せない形に変換して保存）', '所属クラス、目標試験と受験予定時期', '診断結果、問題への解答と正誤、スクリプトを開いたかどうか', 'Writing の文章、Speaking のメモと自己評価、先生の評価とコメント', '学習した日時'),
      h('p', null, '本名・メールアドレス・住所・電話番号・位置情報は集めません。本名は入力しないでください。')),
    sec('3. 利用目的', list('あなたの力に合った教材や復習を提示するため', '学習の進み具合をあなたと担当の先生が確認するため', '先生が Writing・Speaking を評価し、指導するため'),
      h('p', null, 'これ以外の目的（広告、販売、成績以外の人物評価など）には使いません。')),
    sec('4. 見ることができる人', h('p', null, 'あなた本人、あなたのクラスを担当する先生、アプリの管理者だけです。ほかの生徒からは見えません。')),
    sec('5. 外部への提供・送信', h('p', null, '法令に基づく場合を除き、第三者に提供しません。解析ツール・広告・外部のAIサービスなどにデータを送信しません。Listening の音声は端末の読み上げ機能で作ります。')),
    sec('6. 録音と端末内の保存', h('p', null, 'Speaking の録音は、あなたの端末の中（ブラウザー内）だけに保存し、サーバーには送りません。録音は自分でいつでも削除できます。Writing の下書き・未送信の回答も、端末内に一時保存します。ログアウトすると、この端末に保存したこれらのデータは削除されます。'),
      h('p', null, 'Cookie は、ログイン状態を保つためのもの1つだけを使います（広告・追跡用の Cookie は使いません）。')),
    sec('7. 保存期間', h('p', null, cfg.retention || '在籍中（アプリを利用する期間）保存し、退会・卒業時や、学校が定める期間を過ぎたときに削除します。')),
    sec('8. 安全管理', list('通信の暗号化（HTTPS）', 'パスワードのハッシュ化とログイン試行回数の制限', '担当の先生だけが閲覧できるアクセス制限', '必要最小限の情報だけを保存')),
    sec('9. あなたの権利', h('p', null, '自分のデータの確認・書き出し（設定画面の「自分のデータをダウンロード」）、表示名の訂正、退会によるデータの削除、利用の停止を求めることができます。自分でできない場合は、先生または上の窓口に依頼してください。'),
      h('p', null, 'EU 域内に居住している場合は、一般データ保護規則（GDPR）に基づく権利（アクセス、訂正、消去、処理の制限、データポータビリティ、異議申立て）と、監督機関に苦情を申し立てる権利があります。')),
    sec('10. 保護者の方へ', h('p', null, '利用者は主に高校生（未成年）です。学校の方針に従って、必要な場合は保護者の同意を得たうえで利用します。内容はお子さまと一緒にご確認ください。')),
    sec('11. 変更', h('p', null, '内容を変更するときは、アプリ内でお知らせし、改めて同意をお願いします。')),
    agreeBtn));
}

export async function aboutView() {
  setTitle('このアプリについて', { back: state.me ? '#/settings' : '#/login' });
  return h('div', { class: 'stack narrow' }, h('article', { class: 'card policy' },
    h('h2', null, 'English Steps について'),
    h('p', null, '日本の高校生が A2 Key for Schools・B1 Preliminary for Schools・B2 First for Schools に向けて、4技能をレベル別に学ぶための自主教材アプリです。'),
    h('h3', null, '公式教材ではありません'),
    h('p', null, 'このアプリは Cambridge University Press & Assessment の公式製品ではなく、同機構から承認・提携を受けたものでもありません。「Cambridge English」「A2 Key」「B1 Preliminary」「B2 First」は試験名を説明するためにだけ使用しています。'),
    h('p', null, '本文・スクリプト・問題はすべてこのアプリのために独自に作成したもので、公式問題を転載していません。「試験形式を意識した問題」は出題の形式だけを参考にしています。'),
    h('h3', null, '診断と習熟度について'),
    h('p', null, '診断結果や習熟度は、教材を選ぶためのアプリ独自の目安です。Cambridge English Scale のスコアではなく、試験の合否や得点を予測・保証するものでもありません。'),
    h('h3', null, '使っていない機能'),
    h('p', null, 'AI による添削・音声認識・外部の学習管理システムとの連携は、現在は利用していません。')),
    disclaimer());
}
