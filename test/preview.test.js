import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import stringWidth from 'string-width';
import { readYaml } from '../src/verifier.js';
import { renderPreview } from '../src/preview.js';
const spec = await readYaml('test/fixtures/registration/features/screen01/screen01.spec.yaml');
const view = await readYaml('test/fixtures/registration/features/screen01/screen01.view.yaml');

test('日本語・長いラベルでも枠が揃い、項目を省略しない', () => {
  const d = structuredClone(spec);
  d.screen01.fields[0].label = 'とても長い名前の入力欄😀';
  const output = renderPreview(d, view, { width: 24 });
  assert.match(output, /とても長い名前の入力欄😀 \[________\]/);
  assert.equal(new Set(output.split('\n').map(line => stringWidth(line))).size, 1);
  assert.match(output, /\[登録\] \|/);
});

test('2列、列結合、横並びボタン、mobileの1列表示', () => {
  const d = structuredClone(spec), v = structuredClone(view);
  d.screen01.fields.push({ id: 'address', type: 'text', label: '住所' }, { id: 'phone', type: 'text', label: '電話' },
    { id: 'cancel', type: 'button', label: '取消', trigger: 'click', action: 'add_entry', inputs: structuredClone(d.screen01.fields[2].inputs) });
  v.screen01.layout.sections = [
    { id: 'left', fields: ['name', 'address'] },
    { id: 'right', fields: ['age', 'phone'] },
    { id: 'buttons', fields: ['cancel', 'add_button'], column_span: 2, direction: 'horizontal', align: 'right' },
  ];
  v.screen01.responsive.desktop.columns = 2;
  const desktop = renderPreview(d, v);
  assert.match(desktop, /名前 \[________\].*年齢 \[________\]/);
  assert.match(desktop, /住所 \[________\].*電話 \[________\]/);
  assert.match(desktop, /\[取消\]  \[登録\] \|/);
  assert.equal(new Set(desktop.split('\n').map(line => stringWidth(line))).size, 1);
  const mobile = renderPreview(d, v, { device: 'mobile' });
  assert.doesNotMatch(mobile, /名前.*年齢/);
  assert.match(mobile, /\[取消\]  \[登録\]/);
});

test('参照切れ、未配置、重複、範囲外、制御文字は拒否する', () => {
  for (const mutate of [
    v => { v.screen01.layout.sections[0].fields[0] = 'missing'; },
    v => { v.screen01.layout.sections[0].fields.pop(); },
    v => { v.screen01.layout.sections[0].fields.push('name'); },
    v => { v.screen01.responsive.desktop.columns = 0; },
    v => { v.screen01.layout.sections[0].column_span = -1; },
    v => { v.screen01.title = '\x1b[31m'; },
  ]) {
    const v = structuredClone(view); mutate(v);
    assert.throws(() => renderPreview(spec, v));
  }
  assert.throws(() => renderPreview(spec, view, { width: NaN }));
  assert.throws(() => renderPreview(spec, view, { device: 'unknown' }));
});

test('CLIを外部ディレクトリから実行し、JSONと引数エラーを確認する', () => {
  const cli = (...args) => spawnSync(process.execPath, [resolve('src/cli.js'), ...args], { cwd: tmpdir(), encoding: 'utf8' });
  const project = resolve('test/fixtures/registration/project.yaml');
  const result = cli('preview', '-p', project, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).previews[0].text, /ユーザ登録/);
  assert.equal(cli('preview', '-p', project, '--screen', 'missing').status, 2);
  assert.equal(cli('preview', '--design', 'missing').status, 2);
  assert.equal(cli('preview', '-p', project, '--width', 'abc').status, 2);
  assert.equal(cli('verify', '--width', '60').status, 2);
});
