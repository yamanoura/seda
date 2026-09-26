# seda — 構造化設計アシスタント

**SEDA = Structured Engineering Design Assistant**

sedaは、設計を「読める文書」から「検証して動かせるデータ」へ変えるCLIツールです。

YAMLで設計情報を定義し、整合性の検証・設計テスト・テキストワイヤーフレームの表示と操作を支援します。

名前の由来は「設計データ」。その響きに、ツールの役割を表す英語の意味を持たせた名称です。小文字の4文字で表記し、CLIでも入力しやすい名前としています。

CLIコマンド名は `seda` です。旧コマンド `yaml-design` も互換用の別名として利用できます。npmパッケージ名は引き続き `yaml-design-verifier` です。

## 目的

YAML形式の設計書を元にAIがプログラムを実装できること、そして別のYAMLテストファイルによって設計の整合性と実装の動作を検証できることを確認する。

設計YAMLを仕様の正本とする。仕様に不足や曖昧さがあれば、AIが実装時に暗黙の補完をするのではなく、設計に明記してから実装する。

設計方針の詳細は [YAMLによる構造化設計書 PoC](docs/design-principles.md) を参照。Structure・Behaviorをspec、Layout・Appearanceをview、具体的なスタイルをDesign Systemで管理する。

## 現在のファイル

- `design-yaml/project.yaml`: 設計ファイルをまとめる入口。
- `design-yaml/design-system.yaml`: 配色・文字・余白・幅・部品サイズ・ブレークポイントの共通定義。
- `design-yaml/features/screen01/screen01.spec.yaml`: ユーザ登録画面の項目・アクション・入力検証の定義。
- `design-yaml/features/screen01/screen01.view.yaml`: 項目の意味的な配置・見た目の役割・メッセージの表示位置。
- `design-yaml/features/screen01/screen01.test.yaml`: 正常系、必須・数値チェック、処理中断、境界値の5ケース。

設計をシミュレーションする検証CLIを実装済み。AIが生成したアプリケーションそのものを実行する機能は今後の対象。

```text
design-yaml/
├── project.yaml
├── design-system.yaml
└── features/
    └── screen01/
        ├── screen01.spec.yaml
        ├── screen01.view.yaml
        └── screen01.test.yaml
```

`project.yaml` の `design_system_file`・`spec_file`・`view_file`・`test_file` は、このファイルのあるディレクトリを基準とする相対パス。画面IDは一覧・spec・viewで一致させる。

## 表示仕様（view）とDesign System

`screen01.view.yaml` はAIが画面を実装する際の表示仕様。座標・px・色コード・CSSを直接記述せず、意味と参照名で定義する。

- `layout`: フォーム、縦方向、中央配置、`medium` 幅・間隔を指定する。`sections` の配列順と各 `fields` の順番が配置・フォーカスの順番。セクションの `align` はそのセクションの配置を上書きする。
- `appearance.fields`: `field_ref` でspecの項目を参照し、`size: medium` や `variant: primary` を指定する。入力部品はspecの型から選び、ラベル・検証・アクションは重複定義しない。
- `responsive`: `desktop`・`mobile` ごとの列数を指定する。ブレークポイントの具体値はDesign Systemに置く。
- `feedback`: エラーは項目の下に文字で表示し、完了はフォームの下に表示する。文言はspecを参照し、ラベル・エラーは対応する入力と関連付ける。`role` は支援技術への通知に使う。

`design-system.yaml` は `project.yaml` の `design_system_file` から参照する。現在はプロジェクト共通で1つのDesign Systemを適用する。

| 定義 | 意味 |
| --- | --- |
| `colors` / `variants` | 色の実値と、primaryなどの役割から色への参照 |
| `typography` | フォント・文字サイズ・行高 |
| `spacing` / `widths` / `sizes` | 間隔・最大幅・部品の最小高さのトークン |
| `breakpoints` | 表示区分の最小幅。満たす区分のうち最も大きい最小幅を採用 |
| `form` / `feedback` | フォームと通知の共通スタイル。色や余白はトークン参照 |

寸法の数値はpx、行高は無単位。`form.fit_container: true` は余白を含めて親幅に収める意図を表す。具体的なCSSや描画方法はUI実装が担当する。ブラウザ入力とspecの数値型を結び付ける方法も、アプリケーション実装時に定義する。

現在のCLIはprojectからspec・testを検証し、指定されたview・Design Systemも読み込む。`preview` はテキスト配置を表示できるが、ブラウザでの描画・見た目の検証は行わない。回帰テストでは現在のprojectの参照先、viewの項目参照、Design Systemの幅・間隔・サイズ・variant・ブレークポイント参照を確認する。これは現在のサンプルの整合性確認であり、任意のviewを網羅的に検証するSchema/Lintではない。

## CLIツールの使い方

Node.js 20以上が必要。起動時のNode.jsが古い場合はPATH内の対応版を検索する。

### 個人利用のインストール

npmレジストリへの公開は不要。seda本体を `/Users/yamanoura/github/seda` に置き、依存パッケージを準備してからグローバルインストールする。

```sh
cd /Users/yamanoura/github/seda
npm ci
npm install -g /Users/yamanoura/github/seda
```

インストール後は、npmのグローバルコマンド用ディレクトリがPATHに含まれていれば、任意のディレクトリで実行できる。

```sh
seda --version
seda --help
```

### seda本体の修正を反映する

sedaのプログラムを修正したら、次のコマンドで再インストールする。

```sh
npm install -g /Users/yamanoura/github/seda
```

依存パッケージも変更した場合は、先にseda本体のディレクトリで `npm ci` を実行する。起動中の `seda interact` は終了し、再起動する。次回のコマンド実行から修正後のプログラムを使用する。

```sh
# 設計作業中のプロジェクトのディレクトリで実行
seda verify
seda interact
```

`init` で作成済みの設計YAMLは独立したコピーであり、再インストールしても上書き・自動更新されない。YAMLの記載ルールを変更した場合は、各設計プロジェクトのYAMLを新しいルールに合わせる。

開発時は、seda本体のディレクトリで `npm link` を実行して登録する方法も使える。リンク先のコード修正は次回起動時に反映される。リポジトリを移動・削除した場合は再登録が必要。アンインストールは `npm uninstall -g yaml-design-verifier`。

### 新しい設計書を作る

```sh
seda init my-design
cd my-design
seda verify
```

`init` は現在のユーザ登録サンプルを複製し、project・spec・view・test・Design Systemを作成する。作成先の親ディレクトリは存在している必要がある。既存のファイルやディレクトリは上書きせず、エラーにする。

作成後はspecに項目・処理を定義し、viewに配置と見た目の役割、testに入力と期待値を記述する。画面を追加するときはファイルと画面IDを用意し、projectの `main` に参照を追加する。対応するキー・型・演算子は下記の対応仕様の範囲内とする。

### テキストで画面イメージを確認する

```sh
seda preview
seda preview --screen screen01 --device mobile
seda preview --project ./my-design/project.yaml --width 60
seda preview --design features/screen01/screen01.spec.yaml --view features/screen01/screen01.view.yaml

# 保存はシェルのリダイレクトで行う
seda preview > screen.txt
```

specの項目ラベル・型とviewの配置から、枠・入力欄・ボタンをテキストで表示する。テストファイルは不要。入力値は空欄を示すプレースホルダーで、編集・登録操作はできない。`--json` で `previews[].text` を取得できる。

- `layout.type: form` に対応する。
- `layout.sections` を上から順に配置し、各 `fields` は項目IDを参照する。未配置・重複・未定義の項目はエラーにする。
- 列数は `responsive.desktop.columns` / `responsive.mobile.columns`、未指定なら `layout.columns`、さらに未指定なら1。1〜4列に対応する。
- セクションは空き列へ順に配置する。`column_span` は1〜4で、表示列数を上限とする。1列表示時は自動的に1になる。
- `direction: vertical` は項目を縦並び、`horizontal` は横並びにする。セクションで指定するとlayoutの指定を上書きする。
- セクションの `align: left | center | right` で割り当てた列内の配置を指定する。
- `--width` は端末上の目安の最小幅（24〜200文字、既定60）。内容が長ければ省略せず拡張する。端末が狭い場合は折り返されるため、幅を広げて確認する。

例えば、既存のユーザ登録viewのlayoutとresponsiveを次にすると、名前・年齢が横に並び、登録ボタンが下段右側に表示される。

```yaml
layout:
  type: form
  direction: vertical
  sections:
    - id: name_section
      fields: [name]
    - id: age_section
      fields: [age]
    - id: operations
      fields: [add_button]
      column_span: 2
      direction: horizontal
      align: right
responsive:
  desktop:
    columns: 2
  mobile:
    columns: 1
```

`--device` は `desktop`（既定）または `mobile`。日本語の表示幅を考慮して枠を揃える。等幅フォントの端末での利用を想定し、絵文字の幅は端末によって差が生じる場合がある。

プレビューは配置確認用であり、Design Systemの色・フォント・寸法、Appearanceのvariant・size、メッセージの動的表示、layoutの幅・余白トークン・画面全体のalignは描画しない。ブラウザ表示やアクセシビリティの検証は別途必要。

### テキストワイヤーフレームを操作する

```sh
seda interact
seda interact --screen screen01
seda interact --project ./my-design/project.yaml --device mobile
seda preview --interactive
```

通常の端末（TTY）ではキーボード操作モードで起動し、選択中の項目を `>` で示す。画面をその場で更新し、終了時に元の端末画面と入力モードへ戻す。

| キー | 内容 |
| --- | --- |
| Tab / ↓ / → | 次の項目へ（末尾から先頭へ循環） |
| Shift+Tab / ↑ / ← | 前の項目へ |
| Enter | 選択中の入力欄を編集、またはボタンを押下 |
| 編集中のEnter | 入力を確定 |
| 編集中のTab / Shift+Tab | 確定して次／前の項目へ |
| 編集中のEsc | 変更を取り消す |
| 編集中の←→ / Home / End | 文字カーソルを移動 |
| 編集中のBackspace / Delete | 文字を削除 |
| 選択中の `r` | 全入力をリセット |
| 選択中の `q` / Ctrl+C / Ctrl+D | 終了 |

移動順はviewのセクション・項目の定義順。矢印キーは画面上の距離に基づく移動ではなく、前後の項目へ移動する。編集では既存の値を引き継ぎ、全削除して確定すると空欄になる。日本語入力は端末のIMEで確定した文字を扱う。編集位置は `│` で示す。

パイプなどTTY以外の入出力では従来の番号＋Enterによる行単位の操作に切り替える。画面が端末に収まらない場合はウィンドウを広げるか `--width`・`--device mobile` で調整する。

名前・年齢を入力して登録ボタンを選ぶと、成功メッセージとprocessへの到達を表示する。不正な値なら検証エラーが表示され、そのまま入力を修正できる。入力中の `q` や `r` は通常の文字として扱う。

対話UIではnumber項目の有限の十進数表記（符号・小数・指数表記を含む）を数値に変換する。空文字は空文字、数値でない入力は文字列のまま検証へ渡す。YAMLテスト内の文字列は従来どおり変換しない。

複数画面のprojectは `--screen` で1画面を選択する。`--design` と `--view` の直接指定、`--device`、`--width` にも対応する。`--json` と `--test` は指定できない。

入力値はセッション内のみ保持し、ファイルやDBには保存しない。process本体・画面遷移は実行しない。成功とは設計シミュレーションが最後まで進んだ意味であり、実際の登録完了ではない。ワイヤーフレームの下には「画面メッセージ」「デバッグログ」「操作ガイド」を分けて表示する。入力エラー・完了文言は画面メッセージ、項目ID・検証ID・模擬処理への到達はデバッグログに表示する。マウス操作には対応していない。

### 検証コマンド

新しい設計を作成したら、作成先のディレクトリで次の順に確認する。

1. `seda verify`：specの定義・参照を検査し、testの入力と期待値を照合する。
2. `seda preview`：viewの項目参照・配置とテキストワイヤーフレームを確認する。
3. `seda interact --screen screen01`：実際に入力・ボタン操作して設計の振る舞いを確認する。

`verify` はAIが生成したアプリケーションを実行するテストではなく、設計シミュレーションの検証。未定義のキーや参照切れは定義エラー、期待値との違いはテスト失敗として報告する。


```sh
# projectに登録された全画面を検証する
seda verify

# 任意の場所にあるprojectを指定する
seda verify --project ./my-design/project.yaml

# 1画面に絞る
seda verify --screen screen01

# JSONで結果を取得する
seda verify --json

# specとtestを直接指定する（両方必須）
seda verify --design features/screen01/screen01.spec.yaml --test features/screen01/screen01.test.yaml

seda --help
seda --version
```

コマンド省略時は `verify`。project未指定時はカレントディレクトリの `project.yaml`、`design-yaml/project.yaml` の順に検索する。親ディレクトリは検索しない。project内のファイル参照はprojectの所在ディレクトリ基準で解決する。CLIに渡すパスはカレントディレクトリ基準。

`--design` と `--test` は `--project` と併用できない。projectモードは現在 `type: screen` のみ対応し、画面ID重複と参照ファイルの読み込みを確認する。`--screen` 指定時は選択画面のspec・test・viewのみを読み込み、Design Systemは共通で読み込む。viewとDesign Systemは省略可能。指定した場合はYAML構文を確認し、viewの画面IDも確認する。内容の完全なSchema検証や描画は行わない。

例えば `expect.messages` を `別の文言` にすると、次のような不一致が表示される。仕様が正しければ期待値を、期待値が正しければ仕様を見直す。

```text
FAIL [screen01] 正常入力
  messages
    expected: ["別の文言"]
    actual:   ["登録しました。"]
```

`ERROR ... アクションが存在しません` のような定義エラーの場合は、表示された箇所のID・参照先を修正して再実行する。テストの期待値を安易に実際の値へ合わせず、意図した仕様を確認する。

終了コードは成功 `0`、期待値不一致 `1`、定義・読み込み・引数エラー `2`。不一致時は期待値と実際の値を表示する。`--json` は結果を標準出力にJSONで出力し、定義・読み込みエラーも `error.message` と `exitCode` を返す。引数自体の解析に失敗した場合は標準エラーへのテキスト出力となる。

リポジトリ内では従来どおり以下も利用できる。

```sh
npm run verify
npm test
```

グローバル登録せず使う場合は、`node /path/to/yaml-design-test1/src/cli.js verify --project /path/to/project.yaml` で実行できる。

## YAMLの記載ルール

以下は現在の実装で使える形式。設計方針文書の将来案と区別して記載する。

### 共通ルール

- UTF-8の `.yaml` ファイルを使用し、インデントはスペース2個に統一する（記述規約）。タブによるインデントは使用しない。
- 同じマッピング内のキーを重複させない。YAMLの構文エラー・パーサーの警告は検証エラーになる。
- 真偽値は `true` / `false`、数値は `30`、文字列として検証したい数値は `"30"` と書く。空文字は `""`、nullは `null`。
- IDは意味が分かる `lower_snake_case` を推奨する。画面IDはproject内、項目・アクション・ValidationのIDはそれぞれ画面内、ステップIDはアクション内で一意にする。
- 参照は表示名ではなくIDを使う。specとviewの最上位キーはprojectの画面IDと一致させる。
- 機能・検証ルールはspec、配置はview、具体的なスタイルはDesign System、期待値はtestに記載する。
- project・spec・testには対応表にないキーを追加しない。背景や理由はコメント（`#`）や別のMarkdownに記載する。`rationale` などの独自キーは現行specでは未対応。

### project.yaml：検証対象の一覧

```yaml
design_system_file: design-system.yaml
main:
  - id: screen01
    type: screen
    spec_file: features/screen01/screen01.spec.yaml
    view_file: features/screen01/screen01.view.yaml
    test_file: features/screen01/screen01.test.yaml
```

| キー | 必須 | ルール |
| --- | --- | --- |
| `main` | はい | 1件以上の画面定義 |
| `main[].id` | はい | 重複しない画面ID |
| `main[].type` | はい | 現在は `screen` のみ |
| `main[].spec_file` / `test_file` | verifyでは必須 | projectの場所を基準とするファイルパス |
| `main[].view_file` | preview・interactでは必須 | verifyでは省略可能 |
| `design_system_file` | いいえ | 共通スタイル定義のパス |

### spec.yaml：項目・処理・入力チェック

画面の下には `fields`・`actions`・`validations` の配列を置く。`fields` と `actions` は1件以上必要。入力チェックがなければ `validations: []` とする。`description` は任意。

| 定義 | 必須キー | 対応値・参照先 |
| --- | --- | --- |
| 項目 `fields[]` | `id`, `type`, `label` | typeは `text`, `number`, `button` |
| ボタン | 上記＋`trigger`, `action` | triggerは `click`、actionは同画面のアクションID |
| アクション `actions[]` | `id`, `inputs`, `steps` | inputsはボタン以外の項目ID配列、stepsは1件以上 |
| 検証ステップ | `id`, `type: validation`, `rules` | rulesは1件以上の `{validation, target}` |
| 処理ステップ | `id`, `type: process`, `action` | actionは記録する処理名。処理本体の存在確認・実行はしない |
| メッセージステップ | `id`, `type: message`, `message` | messageは空でない文字列 |
| 検証定義 `validations[]` | `id`, `condition`, `message` | conditionはoperatorとexpected、messageはtemplate |

`rules[].validation` は同画面の検証ID、`rules[].target` はそのアクションのinputsに含まれる項目ID。`on_error` は任意で、指定する場合は `action: show_message` のみ対応する。テンプレートの変数は `{label}` のみ。

次は、そのまま保存できるユーザ登録仕様の例。

```yaml
screen01:
  description: ユーザ登録
  fields:
    - id: name
      type: text
      label: 名前
    - id: age
      type: number
      label: 年齢
    - id: add_button
      type: button
      label: 登録
      trigger: click
      action: add_entry
  actions:
    - id: add_entry
      inputs: [name, age]
      steps:
        - id: validate
          type: validation
          rules:
            - validation: required
              target: name
            - validation: required
              target: age
            - validation: is_number
              target: age
          on_error:
            action: show_message
        - id: register
          type: process
          action: create_user
        - id: completed
          type: message
          message: 登録しました。
  validations:
    - id: required
      condition:
        operator: empty
        expected: false
      message:
        template: "{label}を入力してください。"
    - id: is_number
      condition:
        operator: number
        expected: true
      message:
        template: "{label}は数値で入力してください。"
```

### view.yaml：配置と意味的な見た目

```yaml
screen01:
  title: ユーザ登録
  layout:
    type: form
    direction: vertical
    sections:
      - id: user_info
        title: ユーザ情報
        fields: [name, age]
      - id: operations
        fields: [add_button]
        direction: horizontal
        align: right
  appearance:
    fields:
      - field_ref: add_button
        variant: primary
        size: medium
  responsive:
    desktop:
      columns: 1
    mobile:
      columns: 1
```

previewで必要なのは画面ID、`layout.type: form`、`layout.direction`、1件以上の `layout.sections`。各セクションは一意の `id` と1件以上の `fields` を持つ。specの全項目を1回ずつ配置する。`title` は任意。列数・列結合・方向・寄せ方は前述のプレビュー対応仕様に従う。

`appearance` はAI実装用の設計情報で、previewには反映しない。verifyではviewの構文と画面IDを確認するだけなので、配置の参照整合性は `seda preview` でも確認する。

### design-system.yaml：具体的なスタイル

画面側に色コードやpxを置かず、共通ファイルに具体値を定義する。例えば上記の `primary` / `medium` に対応する定義は次のように書く。

```yaml
design_system:
  id: default
  colors:
    primary: "#1D4ED8"
    on_primary: "#FFFFFF"
  variants:
    primary:
      background: primary
      foreground: on_primary
  sizes:
    medium:
      min_height: 44
```

これはスタイル部分の最小例。全体のサンプルは [design-system.yaml](design-yaml/design-system.yaml) を参照。現在のverifyはこのファイルのYAML読み込みのみを検証し、色・サイズ・variantの汎用的な参照検証は行わない。

### test.yaml：入力と期待値

`design_tests` は1件以上の配列。各ケースは `action`・`input`・空でない `expect` が必須で、`name` は任意。`input` のキーは対象アクションのinputsに含まれる項目IDのみ。値は文字列・数値・真偽値・nullに対応し、未指定の項目は未入力として扱う。

```yaml
design_tests:
  - name: 正常入力
    action: add_entry
    input:
      name: 山田太郎
      age: 30
    expect:
      success: true
      validation_error: []
      processes: [create_user]
      messages: [登録しました。]
      executed_steps: [validate, register, completed]
  - name: 名前が空なら登録しない
    action: add_entry
    input:
      name: ""
      age: 30
    expect:
      success: false
      validation_error:
        - validation: required
          target: name
      processes: []
      messages: [名前を入力してください。]
      executed_steps: [validate]
```

エラーが出ることだけでなく、`processes: []` で登録処理に進まないことも確認する。比較する期待値の型と意味は次の対応仕様を参照。

## 現在の対応仕様

- `fields` は `text`・`number`・`button` に対応。項目型から検証ルールは自動生成しない。
- `validation` ステップでは `rules` を定義順にすべて評価する。エラーが1件でもあれば、そのステップ終了時点でアクションを中断する。
- Validationの適用は `actions[].steps[].rules` に統一する。`actions[].validations` は使用しない。
- `condition.operator` の評価結果と、正常とする真偽値 `condition.expected` を比較し、不一致ならエラーとする。`expected` は必須。
- `empty` は未指定・`null`・空文字・空白のみの文字列でtrueを返す。必須チェックは `operator: empty` と `expected: false` で定義する。
- `number` は有限の数値でtrueを返す。数値チェックは `operator: number` と `expected: true` で定義する。数値文字列・真偽値は数値へ変換しない。値が空でも数値チェックを省略しないため、年齢未指定時は `{validation: required, target: age}` と `{validation: is_number, target: age}` の両方が返る。
- `on_error.action: show_message` は `{label}` を置換した検証メッセージを記録する。`on_error` を省略しても検証エラーと中断は発生するが、検証メッセージは記録しない。
- `process` は処理名を記録するシミュレーション。`create_user` などの処理本体やDBアクセスは実行せず、処理内部の成功・失敗も検証しない。
- `message` はメッセージを記録する。各ケースは独立し、保存データを共有しない。
- ID重複、参照切れ、未対応のキー・演算子・ステップ型、空のテストや期待値はエラーにする。

### テストYAMLの期待値

```yaml
design_tests:
  - name: 正常入力で登録ステップまで進む
    action: add_entry
    input:
      name: 山田太郎
      age: 30
    expect:
      success: true
      validation_error: []
      processes: [create_user]
      messages: [登録しました。]
      executed_steps: [validate, register, completed]
```

`expect` で指定した項目だけを比較する。配列は順序を含む完全一致で比較する。

| 期待値 | 内容 |
| --- | --- |
| `success` | 検証エラーで中断せず、最後のステップまで進んだか |
| `validation_error` | `{validation: 検証ID, target: 項目ID}` のオブジェクト一覧 |
| `processes` | 到達したprocessステップの処理名一覧 |
| `messages` | 検証メッセージとmessageステップのメッセージ一覧 |
| `executed_steps` | 到達したステップID一覧。エラーで止まったステップも含む |

`validation_error` のみ指定した場合、空配列なら `success: true`、エラーがあれば `success: false` も暗黙に検証する。成功とエラーの期待値が矛盾する場合は定義エラーとなる。

### 旧形式からの変更

`condition` に正常とする評価結果を追加する。

```yaml
condition:
  operator: empty
  expected: false
```

エラー期待値とCLIのJSON結果は、従来の `"required:name"` という文字列から次の形式へ変更した。旧形式は定義エラーとして拒否する。

```yaml
expect:
  validation_error:
    - validation: required
      target: name
```

## 検証の流れ

1. 設計YAMLとテストYAMLの形式・意味を定義する。
2. 静的検証でYAML構文、必須項目、IDの重複、参照先の存在を確認する。
3. 設計YAMLをAIに渡し、プログラムを実装する。
4. テストYAMLをテストランナーで読み取り、実装プログラムへ入力して結果を照合する。
5. 失敗したテストと設計上の不足を記録し、設計の修正と実装の修正を区別する。

設計を解釈するだけの検証と、実装プログラムを実行するテストは別の検証とする。前者の成功だけではAIによる実装が正しいとは判定しない。

## 最初の検証対象

既存のユーザ登録画面を用いて、次を確認する。

- 名前が空の場合に `{validation: required, target: name}` が返る。
- 年齢が数値でない場合に `{validation: is_number, target: age}` が返る。
- 正常な入力でユーザが登録され、完了メッセージが返る。
- 入力エラーの場合には登録処理を実行しない。

`screen01.test.yaml` で完了メッセージと登録ステップへの到達・中断を検証する。実際の登録データやDBの副作用は、このシミュレーションの検証範囲外。

## 実装前に設計で明確にする事項

- バッチ仕様の構造と検証。
- `create_user` の処理内容、保存先、出力、失敗時の挙動。
- 実装を呼び出すインターフェースと、実データを扱うテストの初期化方法。
- 独立したJSON Schema、設計規約を検査するDesign Lint、Data Entity、CRUD画面の仕様。

## 達成条件

- 不正な設計や参照を、対象箇所が分かるエラーとして検出できる。
- AIが設計YAMLに基づいて実装したプログラムに対し、YAMLテストを自動実行できる。
- 正常系・異常系・登録の副作用を検証でき、失敗時は期待値と実際の値を表示できる。
- 設計と異なる実装を意図的に与えると、対応するテストが失敗する。
- 実装の生成・修正に使用したAIへの指示、設計とテストの版、実行方法と結果を記録し、同じ版の実装に対して検証を再実行できる。

この実験で確認するのは、定義した仕様とテスト範囲における実装可能性・検証可能性であり、テストで表現していない仕様まで正しいことを保証するものではない。
# seda
