# YAMLによる構造化設計書 PoC

## 1. 背景

一般的なシステム開発では、設計書の多くをExcel、Word、Markdownなどの自然言語を中心とした文書として作成する。

しかし、自然言語による設計書には以下の問題がある。

- 設計書の品質が作成者の文章能力に依存する
- 同じ設計内容でも作成者によって記述粒度が異なる
- 主語、条件、例外、前提などが欠落しやすい
- 「適切に」「必要に応じて」などの曖昧表現が入り込む
- 必要な設計項目が不足していても機械的に検出できない
- 設計要素間の矛盾や参照漏れを機械的に検出しにくい
- 設計書レビューの品質もレビュー担当者の能力に依存する

プログラムには、コンパイル、型チェック、Lint、単体テストなどの品質確認手段が存在する。

一方、設計書にはそれに相当する仕組みが少なく、基本的には人間によるレビューに依存している。

本PoCでは、この問題を解決するために、設計情報を自然言語ではなくYAMLによる構造化データとして記述する方法を検証する。

---

# 2. コンセプト

コンセプトは、

> **「文章を書く設計」から「設計情報を定義する設計」へ変える。**

ことである。

設計者が自由文章によって設計書を書くのではなく、あらかじめ定義されたSchemaに従って設計情報を入力する。

例えば、

```text
年齢は必須項目であり、数値で入力する。
```

という文章ではなく、

```yaml
- id: age
  type: number
  label: "年齢"
```

と定義する。

Validationについても、

```text
年齢が入力されていない場合は
「年齢を入力してください。」と表示する。
```

ではなく、

```yaml
validation: required
target: age
```

のように構造化する。

設計者の文章能力ではなく、Schemaによって必要な設計情報を強制することを目指す。

---

# 3. 基本思想

## 3.1 Whatを記述し、Howを書きすぎない

YAML設計書では、

> システムがどうあるべきか

を記述する。

プログラム内部でどのように実現するかまでは原則として記述しない。

例えば以下は避ける。

```yaml
messages = require(name)
messages = messages || require(age)

if messages != "":
    alert(messages)
```

これは設計というよりアルゴリズム・プログラムに近いためである。

代わりに、

```yaml
rules:
  - validation: required
    target: name

  - validation: required
    target: age

on_error:
  action: show_message
```

と記述する。

つまり、

- What：YAML設計
- How：実装コード

という責任分界を基本とする。

---

# 4. 設計記述レベル

設計情報を以下の3レベルに分類する。

## L1：Structure

システムを構成する要素を定義する。

例：

```yaml
- id: age
  type: number
  label: "年齢"
```

## L2：Behavior

システムがどのように振る舞うべきかを定義する。

例：

```yaml
- validation: required
  target: age
```

または、

```yaml
trigger: click
action: add_entry
```

## L3：Algorithm

具体的な処理方法を記述する。

例：

```text
messages = require(age)

if messages != "":
    alert(messages)
```

原則としてYAML設計書ではL1とL2までを扱う。

L3については、本当に設計として必要な場合のみ記述方法を検討する。

YAML内に独自プログラミング言語を作ることは避ける。

---

# 5. YAML設計の基本ルール

以下を基本原則とする。

1. すべての設計要素には可能な限り一意のIDを付与する
2. 設計要素間はIDで参照する
3. Yes/Noで表現できるものはBooleanで表現する
4. 数値で表現できるものは数値として表現する
5. 選択肢化できるものはEnumとして表現する
6. 条件と結果を分離する
7. 正常系と異常系を明示する
8. 曖昧な自然言語表現を極力使用しない
9. Whatは構造化し、Whyは自然言語を許容する
10. 同じ設計情報を複数箇所へ重複記載しない
11. 実装方法ではなく要求される振る舞いを記述する
12. 機械的に検証可能な情報は自由記述にしない

---

# 6. IDによる設計要素の関連付け

設計要素同士を文章で関連付けるのではなく、IDによって関連付ける。

例えば、

```yaml
fields:
  - id: add_button
    type: button
    trigger: click
    action: add_entry
```

とする。

Action側では、

```yaml
actions:
  - id: add_entry
```

と定義する。

これによって、

```text
add_button
    ↓
add_entry
```

という関係を機械的に追跡できる。

存在しないActionを参照している場合には、Lintによって検出できるようにする。

---

# 7. 画面設計

画面については、以下を分離して考える。

```text
Screen
 ├─ Structure
 ├─ Behavior
 ├─ Layout
 └─ Appearance
```

## Structure

画面に何が存在するか。

例：

```yaml
fields:
  - id: name
    type: text
    label: "名前"

  - id: age
    type: number
    label: "年齢"

  - id: add_button
    type: button
    label: "登録"
```

## Behavior

操作によって何が発生するか。

例：

```yaml
- id: add_button
  type: button
  trigger: click
  action: add_entry
```

---

# 8. Layout

Layoutでは、

> どこに何を配置するか

という意味的な構造を定義する。

例えば、

```yaml
layout:
  type: form
  direction: vertical

  sections:
    - id: user_info
      title: "ユーザ情報"

      fields:
        - name
        - age

    - id: operations
      fields:
        - add_button
      align: right
```

とする。

具体的な座標指定は原則として行わない。

以下のような記述は避ける。

```yaml
x: 320
y: 150
width: 180
height: 32
```

また、

```yaml
margin-left: 12
padding-top: 8
```

など、CSS相当の情報を画面設計へ直接持ち込むことも原則として避ける。

Layoutでは、

```yaml
align: right
width: medium
direction: vertical
```

などの意味レベルで指定する。

---

# 9. Appearance

Appearanceでは、

> どのような意味を持つ見た目なのか

を定義する。

例えば、

```yaml
appearance:
  variant: primary
  size: medium
```

とする。

以下のような具体的なスタイル指定は画面設計には記述しない。

```yaml
background: "#3366FF"
font-size: 14
color: "#FFFFFF"
```

画面設計では、

```yaml
variant: primary
```

までを指定する。

具体的な色、フォント、余白などはDesign System側で管理する。

---

# 10. Design Systemとの分離

画面設計と具体的なデザイン定義を分離する。

例えば、

```yaml
design_system:

  variants:

    primary:
      background: primary
      foreground: on_primary

    danger:
      background: danger
      foreground: on_danger

  spacing:

    small: 8
    medium: 16
    large: 24
```

のように定義する。

画面側では、

```yaml
appearance:
  variant: primary
```

とだけ指定する。

つまり、

```text
画面設計
    ↓
Primary Button

Design System
    ↓
Primary Buttonのデザイン定義

UI実装
    ↓
CSS等による実際の描画
```

という責任分界とする。

---

# 11. Responsive Design

レスポンシブについても具体的なCSSではなく、設計意図を記述する。

例：

```yaml
responsive:

  desktop:
    columns: 2

  mobile:
    columns: 1
```

必要に応じて、

```yaml
responsive:

  mobile:

    hide:
      - sub_information

    order:
      - user_info
      - operations
      - sub_information
```

のように表示優先順位などを定義する。

---

# 12. Validation

Validationは個々の画面項目へ文章として記載するのではなく、再利用可能な設計要素として定義する。

例：

```yaml
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

ActionからValidationを参照する。

```yaml
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
```

これによって、

```text
add_entry
 ├─ required(name)
 ├─ required(age)
 └─ is_number(age)
```

という関係を機械的に追跡できる。

---

# 13. Action

Actionはユーザー操作などによって発生するシステムの振る舞いを定義する。

例：

```yaml
actions:

  - id: add_entry

    inputs:
      - name
      - age

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
        message: "登録しました。"
```

ただし、Action内にプログラミング言語相当の処理ロジックを作り込みすぎないこと。

---

# 14. 自然言語を完全には排除しない

すべての情報をYAML構造へ変換することは目的としない。

以下のような情報については自然言語を許容する。

- 設計背景
- 採用理由
- 業務上の理由
- 技術選定理由
- 制約事項
- 設計判断

例えば、

```yaml
decision:

  rationale: >
    顧客番号については利用者による入力ミスを防止するため、
    手入力ではなくシステムによる自動採番とする。
```

とする。

基本原則は、

> Whatは構造化する。  
> Whyは自然言語を許容する。

とする。

---

# 15. YAML設計書をSource of Truthとする

将来的には、ExcelやWordの設計書そのものを原本としない。

YAMLによる構造化設計情報をSource of Truthとする。

```text
                 ┌→ 人間向け設計書
                 │
                 ├→ 画面仕様書
                 │
YAML設計情報 ────┼→ テスト仕様
                 │
                 ├→ 画面モック
                 │
                 └→ AI用Context
```

必要な成果物はYAMLから生成する考え方とする。

---

# 16. 設計書Lint

YAML化の大きな目的の一つは、設計書を機械的に検査できるようにすることである。

例えば以下を検査する。

```text
ERROR:
add_button が参照している
add_entry Actionが存在しません。
```

```text
ERROR:
add_entry が参照している
ageフィールドが存在しません。
```

```text
WARNING:
number型のageに
最小値・最大値が定義されていません。
```

```text
ERROR:
Action add_entryに
異常終了時の動作が定義されていません。
```

Lintによって、

- 必須項目
- 参照整合性
- 型整合性
- 未定義参照
- 設計規約
- 曖昧表現
- 正常系/異常系の不足

などを検査できることを目指す。

---

# 17. Schema Validation

YAML自体についてもSchemaを定義する。

例えば、

```yaml
field:
  required:
    - id
    - type
```

のようなルールを定義し、

```yaml
- label: "名前"
```

だけのFieldが存在した場合、

```text
ERROR:
field.id is required.
field.type is required.
```

と検出できるようにする。

将来的にはJSON Schema等の利用を検討する。

---

# 18. Design Test

さらに、設計された振る舞い自体をテストできる可能性を検証する。

例えば、

```yaml
design_tests:

  - action: add_entry

    input:
      name: ""
      age: 20

    expect:
      validation_error:
        - validation: required
          target: name

  - action: add_entry

    input:
      name: "山田太郎"
      age: "ABC"

    expect:
      validation_error:
        - validation: is_number
          target: age

  - action: add_entry

    input:
      name: "山田太郎"
      age: 30

    expect:
      success: true
```

これによって、

```text
Schema Validation
        ↓
Design Lint
        ↓
Design Test
        ↓
人間による設計レビュー
```

という品質保証方式を目指す。

---

# 19. PoCで検証すること

本PoCでは、最初から完全な設計フォーマットを作ることを目的としない。

小規模なWebアプリケーションを対象として、実際にYAMLだけで設計を行い、以下を検証する。

## 検証項目

### 1. 構造化可能範囲

設計情報のどこまでをYAMLとして構造化できるか。

### 2. 自然言語が必要な領域

どのような設計情報について自然言語が必要になるか。

### 3. 設計情報の不足

YAMLだけを渡された開発者が実装できるか。

実装できない場合、

> 何の設計情報が不足していたか

を分析し、Schemaへ追加する。

### 4. 設計情報の重複

同じ情報を複数箇所で定義する必要が発生していないか。

### 5. 自動検証可能範囲

どのような設計ミスをLintによって検出できるか。

### 6. 自動生成可能範囲

YAMLから、

- 設計書
- テストケース
- 画面モック
- 実装コード

などをどこまで生成できるか。

### 7. プログラム化との境界

YAMLが独自プログラミング言語になっていないか。

L1 Structure / L2 Behavior / L3 Algorithm の境界を検証する。

---

# 20. 最初のPoC対象

最初の対象として、以下程度の小規模Webアプリケーションを想定する。

```text
ユーザ一覧
   ↓
ユーザ登録
   ↓
ユーザ更新
   ↓
ユーザ削除
```

最低限、以下を含める。

- 画面
- Field
- Button
- Action
- Validation
- Process
- Message
- Layout
- Appearance
- Data Entity

---

# 21. 最終的に目指す姿

最終的には、

```text
設計者
  ↓
YAML設計
  ↓
Schema Validation
  ↓
Design Lint
  ↓
Design Test
  ↓
┌─────────────────┐
│ 設計情報          │
└─────────────────┘
  ↓
 ├─ 設計書生成
 ├─ 画面モック生成
 ├─ テストケース生成
 ├─ AIレビュー
 └─ 実装支援
```

という仕組みを目指す。

目的は「YAMLでプログラムを書くこと」ではない。

目的は、

> **設計情報を構造化することで、設計品質を個人の文章能力から切り離し、設計そのものを機械的に検証可能にすること。**

である。

設計書を単なる文書ではなく、

> **検証可能な設計データ**

として扱えるかを本PoCによって検証する。

# 22. PoCの採用規約と現在の範囲

- この文書は設計方針であり、各章の例をすべて実装済みとするものではない。現在動作する範囲はREADMEに記載する。
- ファイルはproject（構成）、spec（Structure・Behavior）、view（Layout・Appearance）、design-system（具体的スタイル）、test（期待する振る舞い）に分ける。
- Validationの適用箇所は `actions[].steps[].rules` に統一する。`actions[].validations` は使用しない。
- `condition.operator` は値に対する真偽値を返し、`condition.expected` は正常とする評価結果を必須で指定する。両者が異なればエラー。`empty/false` は空でないこと、`number/true` は有限数値であることを要求する。
- `type: number` だけでは必須・数値チェックを自動追加しない。チェックはrulesで明示する。
- テストの `validation_error` は `{validation: required, target: name}` の配列とし、実際の結果も同形式で返す。文字列結合による旧形式は使用しない。
- Design Testでは明示した期待値を独立した判定基準として保つ。設計から生成した期待値だけでは設計の誤りを検出できないため、人間によるレビューも行う。
- 独立したJSON Schema、汎用Design Lint、Process/Data Entityの詳細定義、CRUDアプリケーション生成は後続の拡張対象とする。
