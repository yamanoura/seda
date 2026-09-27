#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefinitionError, readYaml, runTests } from './verifier.js';
import { interact } from './interact.js';
import { findProject, runProject } from './project.js';
import { previewProject, renderPreview, loadPreviewScreens } from './preview.js';

const help = `使い方:
  seda init <新規ディレクトリ>
  seda verify [--project <project.yaml>] [--screen <ID>] [--json]
  seda verify --design <spec.yaml> --test <test.yaml> [--screen <ID>] [--json]
  seda preview [--project <project.yaml>] [--screen <ID>] [--device desktop|mobile] [--width 60]
  seda preview --design <spec.yaml> --view <view.yaml> [--json]
  seda interact [--project <project.yaml>] [--path /]
  seda preview --interactive [--path /]
  seda --version

routes定義がある場合、preview・interactは / から共通appを経由して起動します。--pathで開始パスを指定できます。
コマンド省略時はverify。現在のディレクトリのproject.yamlのみを読み込みます。なければエラーになります。
initはユーザ登録の設計・表示・テスト・Design Systemのサンプルを新規ディレクトリに作成します。
--design/--test指定時は両方必須で、--projectとは併用できません。
終了コード: 0=成功、1=期待値不一致、2=定義・読み込み・引数エラー。
processは同画面のアクションを模擬実行。previewはテキストによる配置確認です。実際の色・CSS・画面動作は再現しません。`;
let json = false;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string', short: 'p' },
    design: { type: 'string' }, test: { type: 'string' }, screen: { type: 'string' },
    path: { type: 'string' }, view: { type: 'string' }, device: { type: 'string' }, width: { type: 'string' },
    interactive: { type: 'boolean' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  json = values.json;
  if (values.path !== undefined && (values.screen !== undefined || values.design !== undefined)) throw new DefinitionError('--pathは--screen・--designと併用できません');
  const command = positionals[0] ?? 'verify';
  if (values.interactive && command !== 'preview') throw new DefinitionError('--interactiveはpreview専用です');
  if (values.help) console.log(help);
  else if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
  } else if (command === 'init') {
    if (positionals.length !== 2 || Object.keys(values).some(k => k !== 'json')) throw new DefinitionError('initは新規ディレクトリを1つ指定してください');
    const target = resolve(positionals[1]);
    // mkdirを排他的に実行し、既存のディレクトリ・ファイルは上書きしない。
    await mkdir(target);
    await cp(fileURLToPath(new URL('../design-yaml/', import.meta.url)), target, { recursive: true, force: false, errorOnExist: true });
    if (json) console.log(JSON.stringify({ created: target }));
    else console.log(`作成しました: ${target}\n編集後、このディレクトリで seda verify を実行してください。`);
  } else if (command === 'interact' || (command === 'preview' && values.interactive)) {
    if (positionals.length > 1 || values.json || values.test !== undefined) throw new DefinitionError('対話モードに--json・--test・追加の位置引数は指定できません');
    const direct = values.design !== undefined || values.view !== undefined;
    if (direct && (!values.design || !values.view || values.project !== undefined)) throw new DefinitionError('--design と --view は両方指定し、--projectとは併用しないでください');
    const options = { path: values.path, screen: values.screen, device: values.device ?? 'desktop', width: values.width === undefined ? 60 : Number(values.width) };
    let spec, view;
    if (direct) {
      spec = await readYaml(values.design); view = await readYaml(values.view);
    } else {
      const screens = await loadPreviewScreens(values.project ?? await findProject(), {});
      const start = screens.find(s => s.screen === (values.screen ?? screens[0].screen));
      if (!start) throw new DefinitionError('開始画面が存在しません');
      ({ spec, view } = start); options.screen = values.screen; options.screens = screens;
    }
    await interact(spec, view, options);
  } else if (command === 'preview') {
    if (positionals.length > 1 || values.test !== undefined) throw new DefinitionError('previewには--testや追加の位置引数を指定できません');
    const direct = values.design !== undefined || values.view !== undefined;
    if (direct && (!values.design || !values.view || values.project !== undefined)) throw new DefinitionError('--design と --view は両方指定し、--projectとは併用しないでください');
    const options = { path: values.path, screen: values.screen, device: values.device ?? 'desktop', width: values.width === undefined ? 60 : Number(values.width) };
    const previews = direct
      ? [{ text: renderPreview(await readYaml(values.design), await readYaml(values.view), options) }]
      : await previewProject(values.project ?? await findProject(), options);
    if (json) console.log(JSON.stringify({ mode: 'text-preview', previews }, null, 2));
    else console.log(previews.map(p => p.text).join('\n\n'));
  } else {
    if (values.path !== undefined) throw new DefinitionError('--pathはpreview・interact専用です');
    if (values.view !== undefined || values.device !== undefined || values.width !== undefined) throw new DefinitionError('--view / --device / --width はpreview専用です');
    if (command !== 'verify' || positionals.length > 1) throw new DefinitionError('不明なコマンドです。--help を参照してください');
    const direct = values.design !== undefined || values.test !== undefined;
    if (direct && (!values.design || !values.test || values.project !== undefined)) throw new DefinitionError('--design と --test は両方指定し、--projectとは併用しないでください');
    const results = direct
      ? runTests(await readYaml(values.design), await readYaml(values.test), values.screen)
      : await runProject(values.project ?? await findProject(), values.screen);
    const passed = results.filter(r => r.passed).length;
    if (json) console.log(JSON.stringify({ mode: 'design-simulation', total: results.length, passed, failed: results.length - passed, results }, null, 2));
    else {
      console.log('設計シミュレーション（アクションを模擬実行・データ保存なし）');
      for (const result of results) {
        console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.screen ? `[${result.screen}] ` : ''}${result.name}`);
        for (const diff of result.differences) console.log(`  ${diff.key}\n    expected: ${JSON.stringify(diff.expected)}\n    actual:   ${JSON.stringify(diff.actual)}`);
      }
      console.log(`結果: ${passed}/${results.length} 成功、${results.length - passed} 失敗`);
    }
    process.exitCode = passed === results.length ? 0 : 1;
  }
} catch (error) {
  if (json) console.log(JSON.stringify({ error: { message: error.message }, exitCode: 2 }));
  else console.error(`ERROR ${error.message}`);
  process.exitCode = 2;
}
