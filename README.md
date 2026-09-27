# seda — 構造化設計アシスタント

**SEDA = Structured Engineering Design Assistant**

sedaは、設計を「読める文書」から「検証して動かせるデータ」へ変えるCLIツールです。

YAMLで画面・処理・データベースを定義し、整合性の検証、設計テスト、テキストワイヤーフレームの表示・操作、SQLiteによるデータの参照・登録・更新を行えます。

名前の由来は「設計データ」。その響きに、ツールの役割を表す英語の意味を持たせた名称です。小文字の4文字で表記し、CLIでも入力しやすい名前としています。

CLIコマンド名は `seda` です。旧コマンド `yaml-design` も互換用の別名として利用できます。npmパッケージ名は引き続き `yaml-design-verifier` です。

## 目的

YAML形式の設計書を元にAIがプログラムを実装できること、そして別のYAMLテストファイルによって設計の整合性と実装の動作を検証できることを確認する。

設計YAMLを仕様の正本とする。仕様に不足や曖昧さがあれば、AIが実装時に暗黙の補完をするのではなく、設計に明記してから実装する。

設計方針の詳細は [YAMLによる構造化設計書 PoC](docs/design-principles.md) を参照。Structure・Behaviorをspec、Layout・Appearanceをview、具体的なスタイルをDesign Systemで管理する。

## 現在できること

| 機能 | 内容 |
| --- | --- |
| `verify` | 定義・参照・型を検査し、画面とルートのYAMLテストを実行 |
| `preview` | 共通レイアウト、メニュー、URL欄を含むテキストワイヤーフレームを表示 |
| `interact` | キーボードで入力・ボタン操作し、画面遷移と引数の受け渡しを確認 |
| アクション | 入力検証、条件分岐、処理呼び出し、返り値、メッセージ・デバッグ出力 |
| SQLite | テーブル・seed定義、検索・登録・更新、トランザクション、対話操作でのファイル保存 |

設計YAMLを実行する検証CLIを実装済み。AIが生成したアプリケーション自体の実行・テストや、ブラウザでの描画は未対応です。

## リポジトリとサンプル

| 場所 | 用途 |
| --- | --- |
| [examples/](examples/) | 入力・確認の2画面、共通ホームメニュー、ルートテストのサンプル |
| [examples/sqlite/](examples/sqlite/) | 2画面の登録フローにSQLiteの参照・登録・更新とアクションの返り値を追加したサンプル |
| [src/](src/) / [bin/](bin/) | CLI、設計検証・実行、テキストUI、SQLite処理と起動用ラッパー |
| [test/](test/) | CLI・検証・画面操作・DBなどの自動テスト。`fixtures/registration/`はテスト専用データ |
| [docs/design-principles.md](docs/design-principles.md) | 設計方針と将来構想 |

2画面サンプルの構成は次のとおり。

```text
examples/
├── project.yaml
├── app.yaml                # 全画面共通の処理・レイアウト
├── routes.test.yaml
├── design-system.yaml
└── features/
    ├── screen01/           # 入力画面
    │   ├── screen01.spec.yaml
    │   ├── screen01.view.yaml
    │   └── screen01.test.yaml
    └── screen02/           # 確認画面
        ├── screen02.spec.yaml
        ├── screen02.view.yaml
        └── screen02.test.yaml
```

`project.yaml` の `design_system_file`・`app_file`・`route_test_file`・`database_file`・`spec_file`・`view_file`・`test_file` は、このファイルのあるディレクトリを基準とする相対パス。画面IDは一覧・spec・viewで一致させる。

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

npmレジストリへの公開は不要。sedaを配置したディレクトリで依存パッケージを準備し、グローバルインストールする。`/path/to/seda` は実際の配置先に置き換える。

```sh
cd /path/to/seda
npm ci
npm install -g .
```

インストール後は、npmのグローバルコマンド用ディレクトリがPATHに含まれていれば、任意のディレクトリで実行できる。

```sh
seda --version
seda --help
```

### seda本体の修正を反映する

sedaのプログラムを修正したら、次のコマンドで再インストールする。

```sh
npm install -g /path/to/seda
```

依存パッケージも変更した場合は、先にseda本体のディレクトリで `npm ci` を実行する。起動中の `seda interact` は終了し、再起動する。次回のコマンド実行から修正後のプログラムを使用する。

```sh
# 設計作業中のプロジェクトのディレクトリで実行
seda verify
seda interact
```

作成済みの設計YAMLは独立したファイルであり、再インストールしても上書き・自動更新されない。YAMLの記載ルールを変更した場合は、各設計プロジェクトのYAMLを新しいルールに合わせる。

開発時は、seda本体のディレクトリで `npm link` を実行して登録する方法も使える。リンク先のコード修正は次回起動時に反映される。リポジトリを移動・削除した場合は再登録が必要。アンインストールは `npm uninstall -g yaml-design-verifier`。

### 新しい設計書を作る

`init`コマンドは廃止した。既存の[2画面サンプル](examples/project.yaml)を参考に、project・app・spec・view・testを用意する。サンプルをコピーして始める場合は、必要なファイルだけを新規ディレクトリへコピーする。

```sh
# sedaリポジトリ直下で実行。my-designは未作成のディレクトリを指定する
mkdir my-design
cp examples/project.yaml examples/app.yaml examples/routes.test.yaml examples/design-system.yaml my-design/
cp -R examples/features my-design/
cd my-design
seda verify
```

作成後はspecに項目・処理を定義し、viewに配置と見た目の役割、testに入力と期待値を記述する。画面を追加するときはファイルと画面IDを用意し、projectの `main` に参照、`routes` にURLパスを追加する。対応するキー・型・演算子は下記の対応仕様の範囲内とする。

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

### メニューバー

viewの `layout.menu_bar.fields` にボタンIDを並べると、タイトルの下に横並びのメニューバーを表示する。ラベル・アクション・引数はspecの既存のbutton定義を使う。同じ項目をmenu_barとsectionsの両方には配置できない。本文のsectionsは1件以上必要。

ボタンはspec側にも定義する。以下の例では `help_button` と `add_button` が必要。

```yaml
screen01:
  title: ユーザ登録
  layout:
    type: form
    direction: vertical
    menu_bar:
      fields: [help_button, add_button]
    sections:
      - id: user_info
        title: ユーザ情報
        fields: [name, age]
```

Tab・Shift+Tab・矢印キーで選び、Enterでアクションを実行する。番号入力モードではメニューから順に番号が付く。階層メニューやドロップダウンには未対応。

共通のホームメニューを試すには `seda interact --project examples/project.yaml` を実行する。

ルート付きプロジェクトのpreview・interactでは、ワイヤーフレーム上部にブラウザ風の `URL [ / ]` 欄を表示する。遷移・リダイレクト・リセット後のパスが反映される。URL欄は表示専用で、開始パスは `--path` で指定する。

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
| 選択中の `r` | 開始画面に戻り全入力をリセット |
| 選択中の `q` / Ctrl+C / Ctrl+D | 終了 |

移動順はviewのセクション・項目の定義順。矢印キーは画面上の距離に基づく移動ではなく、前後の項目へ移動する。編集では既存の値を引き継ぎ、全削除して確定すると空欄になる。日本語入力は端末のIMEで確定した文字を扱う。編集位置は `│` で示す。

パイプなどTTY以外の入出力では従来の番号＋Enterによる行単位の操作に切り替える。画面が端末に収まらない場合はウィンドウを広げるか `--width`・`--device mobile` で調整する。

名前・年齢を入力して登録ボタンを選ぶと、成功メッセージとYAMLのdebugステップで指定したログを表示する。不正な値なら検証エラーが表示され、そのまま入力を修正できる。入力中の `q` や `r` は通常の文字として扱う。

対話UIではnumber項目の有限の十進数表記（符号・小数・指数表記を含む）を数値に変換する。空文字は空文字、数値でない入力は文字列のまま検証へ渡す。YAMLテスト内の文字列は従来どおり変換しない。

routesのあるprojectでは `/` を開始パスとし、`--path` で開始パスを変更できる。`--screen` はその画面に対応する最初のルートを選ぶ互換指定で、`--path` とは併用できない。遷移先も同じprojectから読み込む。必須の受信引数がある確認画面は直接開始せず、入力画面から遷移する。`--design` と `--view` の直接指定、`--device`、`--width` にも対応する。`--json` と `--test` は指定できない。

入力項目の値はセッション内で保持する。database_fileを定義した場合は、dbステップでSQLiteを参照・更新できる。processは同画面のactionsを呼び出し、YAMLに定義されたステップを模擬実行する。transitionステップでは画面を切り替えて値を引き継ぐ。成功はアクションがエラーなく終了したことを表す。DBへの登録はoperation: create（旧形式ではdb.insert）を定義した場合に行われる。ワイヤーフレームの下には「画面メッセージ」「デバッグログ」「操作ガイド」を分けて表示する。入力エラー・完了文言は画面メッセージ、項目ID・検証ID・画面遷移・debugステップの文言はデバッグログに表示する。マウス操作には対応していない。

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

コマンド省略時は `verify`。project未指定時はカレントディレクトリの `project.yaml` のみを読み込む。なければ「現在のディレクトリにproject.yamlがありません」と表示し、終了コード2で終了する。サブディレクトリや親ディレクトリは検索しない。verify・preview・interactで共通の規則。project内のファイル参照はprojectの所在ディレクトリ基準で解決する。CLIに渡すパスはカレントディレクトリ基準。

`--design` と `--test` は `--project` と併用できない。projectモードは現在 `type: screen` のみ対応し、画面ID重複と参照ファイルの読み込みを確認する。遷移先の整合性確認のため全画面のspecを読み込む。routesがある場合は共通appと全画面のviewも読み込み、共通レイアウトとの組み合わせを検証する。`--screen` 指定時は選択画面の設計テストだけを実行するが、共通処理・ルート・全画面の静的な整合性検証は省略しない。`--screen` 指定時は `route_test_file` のテストケースを実行しない。Design Systemは省略可能。旧mainだけの形式ではverify時のviewも省略可能。

例えば `expect.messages` を `別の文言` にすると、次のような不一致が表示される。仕様が正しければ期待値を、期待値が正しければ仕様を見直す。

```text
FAIL [screen01] 正常入力
  messages
    expected: ["別の文言"]
    actual:   ["登録しました。"]
```

`ERROR ... アクションが存在しません` のような定義エラーの場合は、表示された箇所のID・参照先を修正して再実行する。テストの期待値を安易に実際の値へ合わせず、意図した仕様を確認する。

終了コードは成功 `0`、期待値不一致 `1`、定義・読み込み・引数エラー `2`。不一致時は期待値と実際の値を表示する。`--json` は結果を標準出力にJSONで出力し、定義・読み込みエラーも `error.message` と `exitCode` を返す。引数自体の解析に失敗した場合は標準エラーへのテキスト出力となる。

リポジトリ直下でサンプルを試す場合は、`--project` を明示する。グローバルインストール前でも次のコマンドを使える。

```sh
npm run verify -- --project examples/project.yaml
npm run verify -- --project examples/sqlite/project.yaml
node bin/yaml-design.cjs preview --project examples/project.yaml
node bin/yaml-design.cjs interact --project examples/sqlite/project.yaml
npm test
```

グローバル登録せず使う場合は、`node /path/to/seda/src/cli.js verify --project /path/to/project.yaml` で実行できる。

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

### project.yaml：URLと画面・共通appの対応

```yaml
design_system_file: design-system.yaml
main:
  - id: screen01
    type: screen
    spec_file: features/screen01/screen01.spec.yaml
    view_file: features/screen01/screen01.view.yaml
    test_file: features/screen01/screen01.test.yaml
  - id: screen02
    type: screen
    spec_file: features/screen02/screen02.spec.yaml
    view_file: features/screen02/screen02.view.yaml
    test_file: features/screen02/screen02.test.yaml
app_file: app.yaml
routes:
  - path: /
    screen: screen01
  - path: /confirm
    screen: screen02
route_test_file: routes.test.yaml
```

| 定義 | 内容 |
| --- | --- |
| `app_file` | 全画面で実行する共通YAML。routesを使う場合は必須 |
| `routes[].path` | `/` から始まる固定パス。重複不可。`/` の定義が必須 |
| `routes[].screen` | mainに登録した画面ID。すべての画面に1つ以上のルートが必要 |
| `main` | 画面ID・spec/view/testファイルの一覧。並び順は開始画面に影響しない |
| `main[].type` | `screen` |
| `main[].spec_file` / `view_file` | routesを使う場合は両方必須 |
| `main[].test_file` | verifyでは必須 |
| `database_file` | 任意。SQLiteのテーブル・初期データを定義するYAML |
| `route_test_file` | 任意。ルート解決と共通処理の期待値を定義するテスト |
| `design_system_file` | 任意。共通スタイル定義 |

`routes`・`app_file`のない既存projectは互換動作し、main先頭の画面から起動する。固定パスの完全一致のみ対応し、クエリ・動的パラメータ・末尾のスラッシュ（`/`以外）は未対応。

### app.yaml：共通処理と共通レイアウト

```yaml
app:
  description: 全画面共通の処理とレイアウト
  inputs:
    - id: path
      type: text
      required: true
    - id: screen
      type: text
      required: true
  before_each:
    action: prepare
    inputs:
      path:
        input: path
      screen:
        input: screen
  fields:
    - id: home
      type: button
      label: ホーム
      trigger: click
      action: go_home
      inputs: {}
  actions:
    - id: prepare
      inputs:
        - id: path
          type: text
        - id: screen
          type: text
      steps:
        - id: prepare_log
          type: debug
          message: 共通の表示前処理を実行しました。
    - id: go_home
      inputs: []
      steps:
        - id: home
          type: transition
          target: /
  view:
    title: ユーザ管理サービス
    layout:
      type: form
      direction: vertical
      sections:
        - id: content
          type: outlet
      menu_bar:
        fields:
          - home
```

起動・遷移の順序は「パス解決 → before_each実行 → outletへ画面を挿入」。`seda interact` と `seda preview` は `/` から開始する。`seda preview --path /confirm` は確認パスのレイアウトを確認できる。interactで必須の受信引数を持つ画面を直接開くことはできないため、入力画面から値を渡して遷移する。

`before_each.action` は同じapp内のアクションID、`before_each.inputs` はその呼び出し引数。appの受信引数として定義した `path` と `screen` には、解決済みのパスと画面IDをsedaが渡す。いずれも型はtext。使用しなければappのinputsから省略できる。共通アクションのinputsは `{id, type}` の配列形式にする。

app内のfields・actions・validationsは画面と同じルールで記述する。共通アクションからprocessで呼べるのは同じapp内のアクション。画面への移動はパスへのtransitionを使う。app内に必要な項目がない場合は `fields: []` でよい。

`app.view.layout.sections` には `type: outlet` を必ず1つ置く。outletの前後には通常の共通セクションも置ける。共通メニューと画面メニューはその順で上部へ並べる。グリッド列数は共通側の指定を優先し、省略時は画面側を使う。項目・アクションなどのIDはappと各画面で分離するため、同じIDを使用できる。対話操作内部では共通IDに `app::` を付けるので、画面側のIDでこの接頭辞は使用しない。

共通処理は起動・画面遷移・リセットで実行し、キー移動や再描画だけでは再実行しない。共通処理の検証に失敗した場合は対象画面の表示を中止する。共通処理がtransitionを返した場合は、そのパスを再解決して共通処理から実行し直す。循環するリダイレクトはエラー。遷移のたびに画面・共通項目の入力状態を作り直す。認証サーバーなどの外部サービスとの通信やHTTPサーバー起動は行わない。DB操作はローカルのSQLiteで実行する。

未定義参照を検出するため、整合性検証では全画面の定義を事前に読み込む。実際の画面の生成・表示は共通処理が正常に終わってから行う。単体ファイル指定（`--design`）はproject・appを通さない単体検証用。

条件付きのステップは、アクション引数や先行ステップの結果と固定値を比較する `when` で指定できる。`equals` または `not_equals` のいずれかを使う。条件が一致した場合だけ実行し、不一致なら実行履歴にも含めない。参照先や型の不整合は条件に関係なく検出する。

```yaml
# path引数が /old の場合だけリダイレクトする
- id: redirect
  type: transition
  target: /
  when:
    input: path
    equals: /old
```

### routes.test.yaml：ルートと共通処理のテスト

```yaml
route_tests:
  - name: ルートから入力画面を表示
    path: /
    expect:
      path: /
      screen: screen01
      debug_logs:
        - 共通の表示前処理を実行しました。
  - name: 確認パスでも共通処理を実行
    path: /confirm
    screen_inputs:
      name: 山田
      age: 30
    expect:
      path: /confirm
      screen: screen02
      debug_logs:
        - 共通の表示前処理を実行しました。
```

`seda verify` は画面のdesign_testsとroute_testsを実行する。route_testsの `screen_inputs` は対象画面へ渡す値で、省略時は空。`expect` は最終的な `path`・`screen` と、共通処理から出た `messages`・`debug_logs` を比較する。リダイレクトがあれば途中の共通処理の出力も順番に含む。画面アクションのテストは従来どおりdesign_testsで記述する。

### spec.yaml：項目・処理・入力チェック

画面の下には `fields`・`actions`・`validations` の配列を置く。`fields` と `actions` は1件以上必要。入力チェックがなければ `validations: []` とするか省略できる。`description` は任意。

| 定義 | 必須キー | 対応値・参照先 |
| --- | --- | --- |
| 項目 `fields[]` | `id`, `label` と型の定義元 | `source.input` がある場合はtypeを継承。それ以外のtypeは `text`, `number`, `button` |
| ボタン | 上記＋`trigger`, `action`, `inputs` | triggerは `click`、actionは同画面のアクションID |
| アクション `actions[]` | `id`, `inputs`, `steps` | inputsは `{id, type}` の配列（型はtext・number・boolean）、stepsは1件以上 |
| 検証ステップ | `id`, `type: validation`, `rules` | rulesは1件以上の `{validation, target}` |
| 処理ステップ | `id`, `type: process`, `action` | actionは同画面のactionsに定義したアクションID。未定義ならエラー |
| デバッグステップ | `id`, `type: debug`, `message` | デバッグログだけに表示する空でない文字列 |
| メッセージステップ | `id`, `type: message`, `message` | messageは空でない文字列 |
| 遷移ステップ | `id`, `type: transition`, `target` | routesがある場合はURLパス。`inputs`で受信引数を渡す |
| DBステップ | `id`, `type: db`, `model`, `operation` | 検索・登録・更新。操作ごとの引数は後述のSQLite仕様を参照 |
| 返却ステップ | `id`, `type: return`, `value` | アクションの`returns`で宣言した型の値を返す |
| 検証定義 `validations[]` | `id`, `condition`, `message` | conditionはoperatorとexpected、messageはtemplate |

`rules[].validation` は同画面の検証ID、`rules[].target` はそのアクションのinputsに含まれる引数名。`on_error` は任意で、指定する場合は `action: show_message` のみ対応する。テンプレートの変数は `{label}` のみ。

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
      inputs:
        name:
          field: name
        age:
          field: age
        mode:
          literal: create
  actions:
    - id: add_entry
      inputs:
        - id: name
          type: text
        - id: age
          type: number
        - id: mode
          type: text
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
          inputs:
            name:
              input: name
            age:
              input: age
        - id: completed
          type: message
          message: 登録しました。
    - id: create_user
      inputs:
        - id: name
          type: text
        - id: age
          type: number
      steps:
        - id: register
          type: debug
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


`type: process` の `action` は同じ画面の `actions` に定義する。呼び出し先の `inputs` は受け取る引数の `{id, type}` 配列、呼び出し側の `inputs` は渡す値の対応表とする。引数がなければ定義側を `inputs: []`、呼び出し側を `inputs: {}`（または省略）とする。呼び出し先はボタンに直接結び付いていなくてもよく、定義順にも依存しない。

未定義参照・引数の不足や余剰・型の不一致・IDの重複・循環呼び出しは、実行経路に到達するかに関係なく設計読込時にエラーとなる。`seda verify`・`seda preview`・`seda interact` は終了コード2で終了する。以前の画面直下の `processes` 定義は廃止したため、`actions` に移して `steps` を記述する。

呼び出し先の検証でエラーになった場合や画面遷移した場合は、親アクションの後続ステップも停止する。`type: message` は画面メッセージ、`type: debug` はデバッグログへ出力する。`debug` は保存や登録を実行する命令ではなく、シミュレーション中の確認用ログである。

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

previewで必要なのは画面ID、`layout.type: form`、`layout.direction`、1件以上の `layout.sections`。各セクションは一意の `id` と1件以上の `fields` を持つ。specの全項目をsectionsまたはmenu_barに1回ずつ配置する。`title` は任意。列数・列結合・方向・寄せ方は前述のプレビュー対応仕様に従う。

`appearance` はAI実装用の設計情報で、previewには反映しない。routesのあるprojectではverifyでも各画面と共通レイアウトを合成した配置を検証する。routesのない旧形式ではviewの構文・画面IDの確認にとどまるため、配置の参照整合性は `seda preview` で確認する。

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

これはスタイル部分の最小例。全体のサンプルは [design-system.yaml](examples/design-system.yaml) を参照。現在のverifyはこのファイルのYAML読み込みのみを検証し、色・サイズ・variantの汎用的な参照検証は行わない。

### test.yaml：入力と期待値

`design_tests` は1件以上の配列。各ケースは `action`・`input`・空でない `expect` が必須で、`name` は任意。`input` のキーは画面の編集可能な項目ID。アクション引数を直接上書きせず、入力元の項目値を指定する。受信値は別の `screen_inputs` に記載する。値は文字列・数値・真偽値・nullに対応し、未指定の項目は未入力として扱う。

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
      executed_steps: [validate, register, create_user.register, completed]
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

## 呼び出し側の値指定・アクションの引数契約・画面遷移

ボタン側の `inputs` は渡す値とその取得元、アクション側の `inputs` は受け取る引数の名前・型を定義する。これは「値の割り当て」と「インターフェース契約」であり、役割の異なる記述。同一アクションを複数ボタンから呼び出せる。

```yaml
fields:
  # name・age項目の定義は省略
  - id: add_button
    type: button
    label: 登録
    trigger: click
    action: add_entry
    inputs:
      name: {field: name}
      age: {field: age}
      mode: {literal: create}
  - id: draft_button
    type: button
    label: 下書き
    trigger: click
    action: add_entry
    inputs:
      name: {field: name}
      age: {field: age}
      mode: {literal: draft}
actions:
  - id: add_entry
    inputs:
      - id: name
        type: text
      - id: age
        type: number
      - id: mode
        type: text
    steps:
      - id: save
        type: process
        action: save_user
        inputs:
          name: {input: name}
          age: {input: age}
          mode: {input: mode}
  - id: save_user
    description: 指定されたモードでユーザを保存する。
    inputs:
      - {id: name, type: text}
      - {id: age, type: number}
      - {id: mode, type: text}
    steps:
      - id: log
        type: debug
        message: ユーザ保存処理に到達しました。
```

| 記載場所 | 記載内容 | `input` の参照範囲 |
| --- | --- | --- |
| ボタンのinputs | `field`・`input`・`literal` のいずれか | 現在の画面の受信引数 |
| アクションのinputs | `{id, type}` の配列 | 値の取得元は書かない |
| transition / processのinputs | `input`・`literal`・先行ステップの `result`（必要に応じて `column`） | 現在のアクションの引数 |
| 項目のsource | `input`のみ | 現在の画面の受信引数 |

呼び出し側は全引数を指定し、未知の引数は渡せない。入力元の型と引数の型は設計検証時に照合する。引数がなければアクションは `inputs: []`、ボタンは `inputs: {}` とする。

参照ごとに取得元を1つだけ指定する。literalは文字列・有限数値・真偽値。nullableなDBカラムとDB検索条件ではliteral: nullも使える。配列・オブジェクトの固定値は未対応。実際の項目入力に不正な値が入るケースは、明示したValidationで検証する。静的な引数の型契約だけでは必須・数値チェックを自動追加しない。

以前のアクション側の参照マッピングと項目ID配列は互換用として読み込める。ただしその場合、ボタン側にinputsを追加しない。新旧形式の混在はエラーになる。

### 同じアクションを複数のボタンからテストする

ケースに `action` と `button` の両方を指定する。`input` は編集可能な画面項目の値であり、ボタンに定義された固定値を上書きするものではない。

```yaml
design_tests:
  - name: 下書きボタンはdraftを渡す
    action: add_entry
    button: draft_button
    input: {name: 山田太郎, age: 30}
    expect:
      process_calls:
        - action: save_user
          inputs: {name: 山田太郎, age: 30, mode: draft}
```

呼び出し元が1つならbuttonを省略できる。複数ある場合は暗黙に選ばず定義エラーにする。buttonとactionの不一致もエラー。Validationメッセージの `{label}` は選択したボタンの参照元フィールドのlabelを使う。

### 受信値から項目の型を継承する

```yaml
screen02:
  inputs:
    - id: name
      type: text
      required: true
    - id: age
      type: number
      required: true
  fields:
    - id: name
      label: 名前
      source:
        input: name
      readonly: true
    - id: age
      label: 年齢
      source:
        input: age
      readonly: true
    # 確定ボタンはexamplesの完全な定義を参照
```

画面の `inputs` は受信契約（id・type・任意のrequired）。typeはtext・number・booleanに対応するが、表示項目は現在text・numberのみ。required省略時は任意で、trueなら未指定・nullを拒否する。空文字を拒否したい場合はValidationも定義する。受信値の型が違う場合や、未定義の受信引数は定義・入力エラーにする。

`source.input` がある項目はtypeを省略できる。typeを併記した場合は継承元との一致が必要。readonlyは任意の真偽値で、trueの項目は対話操作・テスト入力による変更を拒否する。

transitionはアクションの最後に置く。入力チェックで止まった場合、遷移しない。routesのあるprojectではtransitionのtargetに画面IDではなくパスを指定する。projectに登録された遷移先の存在、引数名、型、必須引数を検査する。`--design` / `--test` の直接指定では他画面を読み込まないため、画面をまたぐ検査は必ず `--project` で実行する。

遷移ステップ（`type: transition`）の `inputs` は省略可能で、省略時は空の対応表として扱う。遷移先に必須の受信引数がある場合は、省略すると引数不足のエラーになる。`inputs: null` や配列は使用できない。

### 画面遷移・処理呼び出しのテスト期待値

| キー | 内容 |
| --- | --- |
| `screen_inputs`（ケース直下） | 画面に渡す受信値。省略時は空マッピング |
| `expect.transition` | `{target: /confirm, inputs: {name: 山田, age: 30}}`。遷移しない場合はnull |
| `expect.field_values` | 受信値とinputから確定した項目値の全体 |
| `expect.process_calls` | `[{action: create_user, inputs: {name: 山田, age: 30}}]` のような処理名・引数の一覧 |

テスト結果の `processes` は呼び出したアクション名の配列として維持する（画面直下の定義とは別）。processは引数を渡して呼び出し先のステップも模擬実行する。DB登録は呼び出し先にoperation: create（旧形式ではdb.insert）がある場合に行う。Validationのtargetはアクション引数名。`{label}` はfield参照なら元項目のlabelを使い、それ以外なら引数名を使う。

```yaml
design_tests:
  - name: 確認画面で受信値を登録処理に渡す
    action: confirm_entry
    screen_inputs:
      name: 山田太郎
      age: 30
    input: {}
    expect:
      field_values: {name: 山田太郎, age: 30}
      process_calls:
        - action: create_user
          inputs: {name: 山田太郎, age: 30}
      messages: [登録しました。]
      transition:
        target: /
        inputs: {}
```

完全な2画面のサンプルは [examples/project.yaml](examples/project.yaml)。次のコマンドで試せる。

```sh
seda verify --project examples/project.yaml
seda preview --project examples/project.yaml
seda interact --project examples/project.yaml
```

`examples/` は手動でコピーして利用するサンプル。コピー後の設計は独立しており、sedaの更新で自動変更されない。

## 現在の対応仕様

- `fields` は `text`・`number`・`button` に対応。項目型から検証ルールは自動生成しない。
- `validation` ステップでは `rules` を定義順にすべて評価する。エラーが1件でもあれば、そのステップ終了時点でアクションを中断する。
- Validationの適用は `actions[].steps[].rules` に統一する。`actions[].validations` は使用しない。
- `condition.operator` の評価結果と、正常とする真偽値 `condition.expected` を比較し、不一致ならエラーとする。`expected` は必須。
- `empty` は未指定・`null`・空文字・空白のみの文字列でtrueを返す。必須チェックは `operator: empty` と `expected: false` で定義する。
- `number` は有限の数値でtrueを返す。数値チェックは `operator: number` と `expected: true` で定義する。数値文字列・真偽値は数値へ変換しない。値が空でも数値チェックを省略しないため、年齢未指定時は `{validation: required, target: age}` と `{validation: is_number, target: age}` の両方が返る。
- `on_error.action: show_message` は `{label}` を置換した検証メッセージを記録する。`on_error` を省略しても検証エラーと中断は発生するが、検証メッセージは記録しない。
- `process` は同画面のアクションを呼び出すシミュレーション。YAMLで定義した検証・メッセージ・デバッグ・遷移を実行し、外部プログラムは実行しない。dbステップはSQLiteに対して実行する。
- `message` はメッセージを記録する。各ケースは独立し、保存データを共有しない。
- ID重複、参照切れ、未対応のキー・演算子・ステップ型、空のテストや期待値はエラーにする。遷移先とその引数の型・必須項目はproject単位で検査する。

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
      executed_steps: [validate, register, create_user.register, completed]
```

`expect` で指定した項目だけを比較する。配列は順序を含む完全一致で比較する。

| 期待値 | 内容 |
| --- | --- |
| `success` | 検証・実行エラーで中断せず、正常終了したか（returnでの終了を含む） |
| `validation_error` | `{validation: 検証ID, target: アクション引数名}` のオブジェクト一覧 |
| `processes` | 到達したprocessステップの処理名一覧 |
| `messages` | 検証メッセージとmessageステップのメッセージ一覧 |
| `executed_steps` | 実行順のステップID一覧。呼び出し先は `アクションID.ステップID`。エラーで止まったステップも含む |
| `debug_logs` | debugステップの文言の配列。`expect.debug_logs` で検証できる |

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

## SQLiteによるDB参照・登録・更新

SQLite実行には同梱依存の `better-sqlite3` を使用する。通常の `npm install` で導入される。更新したsedaを使うには `npm install -g /path/to/seda` を実行する。

### DBの寿命

| 実行方法 | DBの扱い |
| --- | --- |
| `seda verify` | テストケースごとに新しいメモリDBを作成し、終了時に破棄する |
| `seda interact` | 起動時にメモリDBを作成し、画面遷移後も共有する。終了時に破棄する |
| `seda interact --db-file ./data.sqlite` | 指定ファイルへ保存し、終了・再起動後も保持する |
| `seda preview` | 表示前の共通処理には一時的なメモリDBを使い、表示生成後に破棄する |

`--db-file` はprojectを使うinteract（またはpreview --interactive）専用で、verifyや通常のpreviewではエラーになる。保存先はコマンド実行ディレクトリ基準。リセットの `r` は画面入力をリセットして共通処理を再実行するが、DBは消去しない。DBを初期状態から試す場合は、メモリモードで起動し直す。

永続DBは初回作成時だけテーブルとseedを投入し、既存DBへseedを再投入しない。定義と既存DBのスキーマが違う場合はエラーとし、自動でテーブル変更・データ削除を行わない。別の保存先を指定して新しい定義を試せる。sedaの管理情報がない既存DBへの接続は未対応。

### 実行可能なサンプル

```sh
# 既存プランから初期ポイントを取得してユーザ登録・登録件数更新を検証
seda verify --project examples/sqlite/project.yaml

# 起動中だけDBを保持する
seda interact --project examples/sqlite/project.yaml

# 終了後も保存する
seda interact --project examples/sqlite/project.yaml --db-file ./examples/sqlite/data.sqlite
```

上記のコマンドはsedaリポジトリ直下で実行する。永続DBは `examples/sqlite/data.sqlite` に保存する。直接確認する場合は次を実行する。

```sh
sqlite3 ./examples/sqlite/data.sqlite
```

SQLite内では `.tables` でテーブル一覧、`SELECT * FROM users;` で登録データ、`.quit` で終了できる。

名前・年齢を入力して確認・確定すると、usersへ登録し、plansのregistrationsを更新する。共通処理が登録済みユーザを取得してデバッグ欄に表示する。同じ名前の再登録は一意制約違反となる。サンプルは [examples/sqlite/project.yaml](examples/sqlite/project.yaml) を参照。

### database.yaml：テーブルと初期データ

project.yamlへ `database_file: database.yaml` を追加する。ファイルはproject.yamlのディレクトリ基準で読み込む。DB操作を含む画面は、単体の--design指定ではなく--projectで検証・操作する。

```yaml
database:
  engine: sqlite
  tables:
    - id: users
      columns:
        - {id: id, type: integer, primary_key: true, generated: true}
        - {id: name, type: text, unique: true}
        - {id: age, type: integer}
        - {id: active, type: boolean, default: true}
        - {id: note, type: text, nullable: true}
  seed:
    users:
      - {name: 初期ユーザ, age: 20}
```

型はtext・integer・number・boolean。integerはJavaScriptで安全に扱える整数、numberは有限数値。nullable省略時は非null。各テーブルには主キーが1つ必要で、generatedはinteger主キー専用。unique・default・外部キー `references: {table: plans, column: id}` に対応する。外部キーの参照先は同じ型の主キーまたはuniqueカラムにする。外部キー制約は接続時に有効化する。

テーブル・カラム名は英字またはアンダースコアで始まる英数字・アンダースコア。sqlite_・_seda_で始まる名前は予約済み。複合主キー・複合一意制約・自動マイグレーションは未対応。SQLiteのSTRICTテーブルを生成する。

### アクションのDBステップ

DB操作は[Prisma ClientのCRUD](https://docs.prisma.io/docs/orm/v6/prisma-client/queries/crud)に近い `model / operation / where / data / select` で記述する。Prisma自体は導入せず、sedaが以下の操作をSQLite上で実行する。Prismaの全機能と互換ではない。

`model` はdatabase.yamlの `tables[].id` を参照する。モデルの項目や型はdatabase.yamlで一度だけ定義する。各操作の値は、入力元を明示する `{input: ...}`・`{literal: ...}`・`{result: ...}` で指定する。

```yaml
# name・ageを受け取るアクション内のstepsの例
- id: plan
  type: db
  model: plans
  operation: findUnique
  where:
    id: {literal: 1}
- id: saved
  type: db
  model: users
  operation: create
  data:
    name: {input: name}
    age: {input: age}
    plan_id: {result: plan, column: id}
    credit: {result: plan, column: initial_credit}
- id: count_registration
  type: db
  model: plans
  operation: update
  where:
    id: {result: plan, column: id}
  data:
    registrations:
      add:
        - {result: plan, column: registrations}
        - {literal: 1}
```

| operation | 引数 | 結果 |
| --- | --- | --- |
| `findUnique` | where必須、select任意 | 1レコード。見つからなければnull |
| `findMany` | where・select・orderBy・takeは任意 | レコードの配列。0件は空配列 |
| `create` | data必須、select任意 | 作成したレコード。自動採番・既定値を含む |
| `update` | where・data必須、select任意 | 更新後の1レコード。対象0件は `SEDA_RECORD_NOT_FOUND` エラー |
| `updateMany` | 空でないwhere・data必須 | `{count: 更新件数}`。0件は正常終了 |

`findUnique` と `update` のwhereには、主キーまたはuniqueカラムを少なくとも1つ、null以外で指定する。whereはカラムの等価比較をANDで結合する。`findMany` はwhereを省略できる。`updateMany` は誤った全件更新を避けるため空のwhereを受け付けない。

`select: {id: true, name: true}` で返すカラムを選ぶ。省略時は全カラム。falseや関連モデルの選択には未対応。`orderBy: [{age: desc}, {id: asc}]` または `orderBy: {id: asc}` で並び順を指定し、省略時は主キー昇順。`take` は1〜10000、省略時1000件。orderByとtakeはfindMany専用。

```yaml
- id: users
  type: db
  model: users
  operation: findMany
  select: {id: true, name: true, age: true}
  orderBy: {id: desc}
  take: 20
- id: show_users
  type: debug
  message: "登録済みユーザ:"
  data: {result: users}
```

`{result: saved}` は結果全体、`{result: saved, column: id}` は返されたレコードの指定カラム。参照は同じアクション内の先行DBステップ、または返り値のあるprocessステップに限る。数値などの結果はprocessやtransitionのinputsにも渡せる。配列の個別行参照には未対応。

数値計算はadd・subtract・multiply・divideへ2つの参照を指定する。SQL文字列やJavaScript式の直接記載は扱わない。値はSQLへバインドし、未定義参照や型の不一致は読み込み時にエラーにする。integerへの小数、スキップされたステップの結果参照、0除算などは実行時エラー。

取得結果による分岐には `when: {result: plan, equals: null}` や `when: {result: plan, column: id, not_equals: null}` を指定できる。JOIN・DELETE・upsert・集約・繰り返し・Prismaのリレーション操作には未対応。

#### 旧DB記法との互換性

従来の `db.select / db.insert / db.update` も使用できる。新旧のキーを1ステップ内で混在させない。

| 旧記法 | 対応する新記法 | 結果の違い |
| --- | --- | --- |
| db.select、table、mode: one | type: db、model、operation: findUnique | 旧形式はunique以外の条件も可能。複数行ならエラー |
| db.select、mode: many、columns、order_by、limit | findMany、select、orderBy、take | いずれも配列 |
| db.insert、values | create、data | 旧形式はchanges・last_insert_id、新形式はレコード |
| db.update、values | updateMany、data | 旧形式はchanges、新形式はcount |

旧形式のlast_insert_idはSQLiteのrowid。新形式では `{result: saved, column: id}` でモデルの主キーを直接取得する。

### アクションの返り値

`returns` で返り値の型を定義し、`type: return` の `value` で実際の値を返す。DBレコードは `returns: {model: users}` と書けばdatabase.yamlから型を継承でき、項目定義を繰り返す必要がない。

```yaml
# actionsの例。confirm_entryを呼ぶボタンからname・ageを渡す。
- id: create_user
  inputs:
    - {id: name, type: text}
    - {id: age, type: number}
  returns: {model: users}
  steps:
    - id: saved
      type: db
      model: users
      operation: create
      data:
        name: {input: name}
        age: {input: age}
        plan_id: {literal: 1}
        credit: {literal: 100}
    - id: return_user
      type: return
      value: {result: saved}

- id: confirm_entry
  inputs:
    - {id: name, type: text}
    - {id: age, type: number}
  steps:
    - id: register
      type: process
      action: create_user
      inputs:
        name: {input: name}
        age: {input: age}
    - id: log
      type: debug
      message: "登録したID:"
      data: {result: register, column: id}
```

返り値の型は次の形式を使う。

```yaml
returns: {type: number}                        # text・number・boolean
returns: {model: users, nullable: true}          # 1レコードまたはnull
returns: {model: users, many: true}              # レコードの配列
returns: {model: users, select: {id: true}}      # idだけを返す
returns: {type: array, items: {type: number}}   # 数値配列の型
returns:
  type: object
  properties:
    id: {type: number}
    registered: {type: boolean}
```

上の例は型の選択肢であり、1アクションにはreturnsを1つだけ指定する。モデル・オブジェクトの返却項目は宣言と完全一致させる。各型には `nullable: true` を付けられる。省略時はnullを許可しない。DB取得でnullになる可能性は実行時にも確認し、許可していないnullや実際の値の型が違えば `SEDA_RETURN_TYPE` エラーとなる。数値文字列を数値へ変換することはない。

単一値は `value: {input: name}` や `value: {literal: 0}`。独自のオブジェクトは以下のように各項目の参照元を指定する。

```yaml
- id: return_summary
  type: return
  value:
    object:
      id: {result: saved, column: id}
      registered: {literal: true}
```

returnはそのアクションの実行を終了し、呼び出し側は次のステップへ進む。`when` 付きreturnで早期終了できるが、returnsがあるアクションの最後には無条件のreturnが必要。返り値を返すアクションとその呼び出し先ではtransitionを使用できない。遷移は値を受け取った呼び出し側で行う。入力チェックで失敗した場合は値を返さず、呼び出し側も中断する。

returnsを省略したアクションは返り値なしとして従来どおり実行できるが、そのprocess結果は参照できない。アクション引数と画面受信引数は引き続きtext・number・boolean。レコード全体を引数には渡さず、必要なcolumnを指定する。

YAMLテストでは以下を比較できる。

| 期待値 | 内容 |
| --- | --- |
| `expect.return_value` | テスト対象アクション自身の返り値。返り値なし・失敗時はnull |
| `expect.action_results` | processステップIDと返り値の対応表。ネストした呼び出しは `アクションID.ステップID` |
| `expect.action_error` | 返却型エラー等のコード配列。正常時は空配列 |

```yaml
# examples/sqliteのconfirm_entryを検証する例
expect:
  success: true
  action_results:
    register: {id: 1, name: 山田, age: 30, plan_id: 1, credit: 100}
```

期待値のオブジェクトも完全一致で比較する。同じアクション内の同じ呼び出しを複数回実行した場合、action_resultsには最後の成功結果を保持する。返り値の型エラー時は後続処理・遷移を停止し、実行中のトランザクションをロールバックする。action_resultsは途中の結果であり、保存済みデータはexpect.databaseで確認する。

### トランザクション

対話操作のボタン・メニュー実行を1つのトランザクションとして扱う。呼び出し先アクションと遷移先の共通処理も同じDBを共有し、その途中で検証・DB制約・画面の読み込みが失敗した場合は変更をロールバックする。検証テストではアクションとその呼び出し先をまとめてロールバックする。

DBエラー時はsuccess: falseになり、db_errorへエラーコードを記録する。画面メッセージに原因を表示し、後続処理や遷移を停止する。db_resultsは実行途中の取得・更新結果の記録なので、最終的に保存された内容はexpect.databaseで確認する。

### テストの初期DBと期待値

```yaml
design_tests:
  - name: 初期プランに基づいて登録する
    action: confirm_entry
    screen_inputs: {name: 山田, age: 30}
    input: {}
    database:
      plans:
        - {id: 1, name: 特別, initial_credit: 500, registrations: 10}
      users: []
    expect:
      success: true
      database:
        users:
          - {name: 山田, credit: 500}
        plans:
          - {id: 1, registrations: 11}
```

ケース直下のdatabaseは、そのケース用の初期データ。指定したテーブルはseedを置き換え、省略したテーブルにはseedを使う。毎回新しいDBを作るので、ケース間でデータは引き継がない。

expect.databaseは指定テーブルの全行を主キー昇順で比較する。比較するカラムは省略できるが、同じテーブルの各行には同じカラムを指定する。`users: []` はusersが0件であることを検証する。省略したテーブルは比較しない。

`expect.db_results` は取得・更新結果を比較でき、トップレベルではステップID、呼び出し先では `アクションID.ステップID` をキーにする。同じ処理を複数回呼ぶ場合は最後の結果を保持する。`expect.db_error: [SQLITE_CONSTRAINT_UNIQUE]` のようにDBエラーコードも比較できる。

route_testsでもケース直下のdatabaseとexpect.databaseに対応する。共通処理の前に初期化し、共通処理・リダイレクト終了後のDB状態を検証する。画面のdesign_testsとルートのroute_testsは別のケースとして独立したDBで実行する。verifyの全ルート事前確認ではseedから作った一時DBをルートごとに使う。

## 今後の対象

現在の `verify` は設計YAMLを解釈して実行する。SQLiteへの副作用は検証できるが、AIが生成した実装プログラムの正しさを判定する機能はまだない。

- 生成した実装を呼び出すインターフェースと、YAMLテストを実装に対して実行するテストランナー。
- 実装テスト用データの初期化と、設計と異なる実装がテストで失敗することの確認。
- AIへの指示、設計・テスト・実装の版、実行方法と結果の記録による再現可能な検証。
- バッチ仕様、独立したJSON Schema、設計規約を検査するDesign Lint、ブラウザ表示の検証。

設計に不足が見つかったら先にYAMLへ明記し、設計の修正と実装の修正を区別する。テストで表現していない仕様まで正しいことを保証するものではない。
