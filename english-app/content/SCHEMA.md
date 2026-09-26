# 教材データのスキーマ（content/）

教材はすべて JSON の構造化データです。初回起動時にデータベースへ取り込まれ（seed）、以降は教員の教材編集画面で編集します。
編集のたびに問題・活動の版（version）が上がり、過去の版は `content_versions` に保存されます。

**著作権**: すべての本文・スクリプト・設問はこのアプリのために独自に作成したものです。Cambridge University Press & Assessment
の公式問題を転載・翻案しないでください。「試験形式を意識した」問題は、形式（設問の型）だけを参考にしています。

## ユニット（content/units/*.json）

```jsonc
{
  "id": "school-life-a2-u1",          // 一意。英小文字・数字・ハイフン
  "theme": "school-life",             // テーマキー
  "themeLabel": "学校生活・部活動",
  "level": "A2",                      // "A2" | "B1" | "B2"（CEFR）
  "exam": "A2 Key for Schools",       // 対象試験（表示用）
  "order": 1,                         // テーマ内の単元番号
  "title": "My School, My Club",      // 英語タイトル
  "titleJa": "私の学校と部活動",        // 日本語タイトル
  "estimatedMinutes": 50,
  "objectives": [                     // LearningObjective：この単元でできるようになること（4〜6個）
    { "id": "a2u1-obj-r", "skill": "reading", "text": "部活動を紹介する短いメールを読んで、曜日・時間・場所などの情報を見つけられる。" }
    // skill: "reading" | "listening" | "writing" | "speaking" | "vocabulary" | "grammar"
  ],
  "activities": [ /* 下の 8 種を表の順に並べる。同じ種類は複数置ける（例: Reading 1〜3）。step は 1 から連番 */ ]
}
```

### 活動（activities）共通フィールド

```jsonc
{ "id": "school-life-a2-u1-reading", "step": 3, "kind": "reading", "skill": "reading",
  "title": "Reading: クラブ紹介のメール", "instructions": "（日本語の指示文）", "minutes": 8 }
```

`kind` の順序（全ユニット共通）。各種類を1つ以上含め、`wrapup` は最後に1つだけ置きます。
初期教材では Speaking と wrapup 以外を各3つ（例: intro 1〜3 → explain 1〜3 → reading 1〜3 → …）、合計20ステップにしています。
2つ目以降の活動の id は `<unitId>-<kind>-2` のように番号を付けます。

| 順序 | kind      | skill       | 内容 |
|------|-----------|-------------|------|
| 1    | intro     | vocabulary  | 重要語彙と表現・語彙チェック（最初の intro で目標 objectives も表示） |
| 2    | explain   | grammar     | 短い解説と例・確認 |
| 3    | reading   | reading     | Reading 課題 |
| 4    | listening | listening   | Listening 課題（スクリプトから音声読み上げ） |
| 5    | writing   | writing     | Writing 課題 |
| 6    | speaking  | speaking    | Speaking 課題 |
| 7    | check     | mixed       | 試験形式を意識した確認問題 |
| 8    | wrapup    | mixed       | ふり返り・復習・次の学習提案 |

### step 1: intro
```jsonc
"vocabulary": [ { "term": "club activity", "meaning": "部活動", "example": "I have club activities after school." } ],  // 10〜14語
"questions": [ /* 語彙チェック 3〜4問（Question） */ ]
```

### step 2: explain
```jsonc
"points": [ { "heading": "頻度を表す副詞", "text": "（日本語の短い解説）", "examples": ["I usually practise on Mondays."] } ], // 2〜4個
"questions": [ /* 確認 2〜3問 */ ]
```

### step 3: reading
```jsonc
"passage": { "title": "An email from Kenta", "paragraphs": ["...", "..."] },
"questions": [ /* 5〜6問。evidence は本文中の文字列と完全一致させる */ ]
```

### step 4: listening
```jsonc
"setting": "（場面の日本語説明）",
"script": [ { "speaker": "Emma", "voice": "female", "text": "..." }, { "speaker": "Kenta", "voice": "male", "text": "..." } ],
"questions": [ /* 5問。evidence はいずれかの script[].text 内の文字列と完全一致 */ ]
```

### step 5: writing
```jsonc
"rubricId": "writing-a2",
"task": {
  "promptEn": "（英語の課題文）", "promptJa": "（日本語訳・補足）",
  "points": ["含めるべき内容1（日本語）", "..."],
  "minWords": 25, "maxWords": 45,
  "usefulLanguage": ["I'm in the ... club.", "..."],
  "modelAnswer": "（模範解答・英語）",
  "selfCheck": ["3つの内容をすべて書いた", "..."]            // 日本語の自己点検項目 4〜6個
}
```

### step 6: speaking
```jsonc
"rubricId": "speaking-a2",
"task": {
  "introJa": "（日本語の説明）",
  "parts": [ { "question": "What's your favourite school subject? Why?", "questionJa": "…", "prepSeconds": 15, "answerSeconds": 30,
               "hints": ["My favourite subject is ... because ..."] } ],  // 2〜4個
  "usefulLanguage": ["..."],
  "modelAnswer": "（参考となる回答例・英語）",
  "selfCheck": ["質問に答えられた", "..."]
}
```

### step 7: check（試験形式を意識した確認問題 5〜7問）
```jsonc
"examNote": "A2 Key for Schools の Reading Part 1（お知らせ・短いメッセージ）の形式を参考にした独自問題です。",
"stimuli": { "notice1": "（お知らせ・掲示などの短い英文。設問の stimulus から参照）" },
"questions": [ /* Question。"stimulus": "notice1" で参照可 */ ]
```

### step 8: wrapup
```jsonc
"summary": ["（この単元のポイント・日本語）", "..."],
"commonMistakes": [ { "wrong": "I am belong to the tennis club.", "right": "I belong to the tennis club.", "note": "（日本語）" } ],
"next": { "text": "（次の学習提案・日本語）", "challenge": "（1つ上のレベルへの挑戦の案内）", "support": "（難しかった人への案内）" }
```

## 問題（Question）

```jsonc
{
  "id": "a2u1-r1",                    // 一意
  "type": "mcq",                      // "mcq"（選択式）| "text"（短答入力）
  "stem": "What time does the club start on Wednesdays?",
  "options": ["3:30", "4:00", "4:30"],// mcq のみ。A2 は 3 択、B1・B2 は 3〜4 択
  "answer": 1,                        // mcq: 正解の options の添字（0始まり）
  "accept": ["played"],               // text のみ: 正解として受け付ける表記（小文字、前後空白は無視して比較）
  "explanation": "（日本語: なぜその答えになるか、他の選択肢がなぜ違うか）",
  "evidence": "we start at four o'clock on Wednesdays",  // 根拠となる本文・スクリプト中の文字列（完全一致）。語彙・文法問題では省略可
  "focus": "specific-info",           // main-idea | specific-info | inference | attitude | vocabulary | grammar | function | reference
  "difficulty": 2,                    // 1〜3（そのレベル内での難度）
  "objectiveId": "a2u1-obj-r"         // 対応する学習目標
}
```

## 評価基準（content/rubrics.json）と診断（content/diagnostic.json）
各ファイル先頭のコメント的フィールド `_note` を参照してください。
