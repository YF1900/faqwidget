# 株式会社コアテック 採用動画（RECRUITING MOVIE）

HTML / CSS / Canvas で組んだモーショングラフィックスを、Playwright でコマ送りキャプチャして
MP4 に書き出す構成の採用動画です。**編集ソフト不要・テキストで差分管理できる**のが狙いです。

- 尺: **1分32秒** / 1920×1080 / 30fps / BGM付き（-15 LUFS）
- 完成データ: [`dist/coretech-recruit.mp4`](dist/coretech-recruit.mp4)（Web配信向けエンコード / 約16MB）
- サムネイル: [`docs/poster.png`](docs/poster.png)
- 台本・絵コンテ: [`docs/絵コンテ・台本.md`](docs/絵コンテ・台本.md)

> リポジトリに入れている MP4 は容量を抑えた配信用エンコード（CRF 24）です。
> `npm run render` を実行すると、同じ絵のマスター品質（CRF 18 / 約35MB）が同じパスに書き出されます。

## セットアップと書き出し

```bash
npm install          # playwright と和文Webフォントを取得
npm run setup        # assets/fonts/ に woff2 を配置（フォントはリポジトリに含めない）
npm run bgm          # assets/bgm.wav を合成（BGM。約92秒 / 数十秒で生成）
npm run preview      # http://localhost:8080 でブラウザ再生（シークバー付き）
npm run render       # dist/coretech-recruit.mp4 を書き出し（映像+BGM / 約10〜15分）
npm run render:draft # 15fps / 960×540 の確認用（数分）
```

ffmpeg が必要です（`ffmpeg` にパスが通っていれば自動検出。無い場合は
`pip install imageio-ffmpeg` でも動きます。`FFMPEG_PATH=/path/to/ffmpeg` で明示指定も可）。

### よく使うオプション

```bash
node render.mjs --bgm 別の曲.mp3            # BGM を差し替える（映像尺に合わせてカット）
node render.mjs --from 38000 --to 56000    # VALUE シーンだけ書き出し
node render.mjs --fps 60 --crf 16          # 高品質版
```

## 構成

```
recruit-movie/
├─ index.html            # 動画本体（タイムライン + 全シーン）
├─ render.mjs            # Playwright → ffmpeg 書き出し
├─ scripts/setup-fonts.mjs
├─ scripts/make-bgm.mjs   # BGM をコードから合成
├─ docs/絵コンテ・台本.md  # 台本 / ナレーション案 / 尺表
└─ dist/coretech-recruit.mp4
```

`index.html` のアニメーションは **すべて時刻 `t`(ms) の純関数** として実装しています
(`window.__seek(t)`)。CSS アニメーションや `Date.now()` に依存しないため、
何度書き出しても同じ絵になり、途中のフレームだけ差し替えることもできます。

### 文言・デザインを直す場所

| 直したいもの | 場所 |
|--------------|------|
| テロップ・コピー | `index.html` の各 `<section class="scene">` 内 |
| シーンの尺 | `index.html` の `SCENES` 配列（`start` / `end` ミリ秒） |
| 各要素の登場タイミング | `updaters` 内の `seg(l, 開始ms, 終了ms)` |
| ブランドカラー | `:root { --accent / --accent2 / --accent3 }` |
| BGM の構成・音量 | `scripts/make-bgm.mjs`（コード進行・セクション・各音色の音量） |
| 書体 | `@font-face` と `scripts/setup-fonts.mjs` |

## 掲載内容の出典と、確認していただきたい点

公式サイト `https://core-tech.jp/recruit/` は本作業環境のネットワークポリシーで直接取得できなかったため、
**公開されている二次情報から裏取りできた事実のみ**を使い、断定できない情報は動画に入れていません。

動画で使用している事実情報（要ご確認）:

| 内容 | 出典 |
|------|------|
| 2009年2月設立 / 資本金9,000万円 / 東京都目黒区青葉台 | 会社概要系の公開情報 |
| バリュー「COllaboration / REspect / TECHnology」 | 同社の価値観として公開されている記述 |
| 5事業（Webインテグレーション／Webマーケティング／デジタル広告／クロスプラットフォーム／クリエイティブ） | 事業内容の公開情報 |
| 月間トータル1億PV超の大規模サイト実績 | 実績紹介の公開情報 |
| 「スキルと同じくらい"ひとがら"を見ている」 | 採用ページの記述として紹介されている内容 |

**意図的に入れなかった項目（数値が情報源によって食い違うため）**

- 従業員数（192人 / 325人 と情報源により差異あり）
- 平均年齢・男女比・有給取得率などの社内データ
- 募集職種の一覧と各募集要項

**ブランド要素の仮置き**

- アクセントカラー（`#19C9E8` / `#2E6BFF` / `#7C5CFF`）は公式ブランドカラーが確認できなかったための仮設定です。
- ロゴは欧文タイプで組んだ簡易表現です。正式ロゴデータがあれば `index.html` の `.logo-mark` を画像に差し替えてください。
- 書体は Noto Sans JP / Zen Kaku Gothic New（SIL OFL 1.1）を使用しています。
- BGM は既成曲を使わず `scripts/make-bgm.mjs` でコードから合成したオリジナル（Am–F–C–G / 100BPM）です。
  そのため権利処理は不要です。指定の楽曲に差し替える場合は `node render.mjs --bgm <file>` で再書き出しできます。
- ナレーションは未収録です。原稿は `docs/絵コンテ・台本.md` のナレーション案をご利用ください。

上記の公式データ（正式ロゴ・ブランドカラー・確定した数値・募集職種）をいただければ、差し替えて再書き出しできます。
