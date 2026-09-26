import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readYaml, runTests } from '../src/verifier.js';
import { createSession } from '../src/interact.js';
const spec = await readYaml('design-yaml/features/screen01/screen01.spec.yaml');
const view = await readYaml('design-yaml/features/screen01/screen01.view.yaml');

test('入力、エラー、中断、修正、ボタン実行、リセットとセッション分離', () => {
  const session = createSession(spec, view);
  assert.equal(session.press('add_button').success, false);
  session.set('name', '山田太郎');
  session.set('age', 'ABC');
  const invalid = session.press('add_button');
  assert.deepEqual(invalid.processes, []);
  assert.deepEqual(invalid.validation_error, [{ validation: 'is_number', target: 'age' }]);
  session.set('age', '0');
  const valid = session.press('add_button');
  assert.equal(valid.success, true);
  assert.deepEqual(valid.processes, ['create_user']);
  assert.match(session.render(), /年齢 \[0\]/);
  assert.equal(createSession(spec, view).press('add_button').success, false);
  session.set('age', '');
  assert.equal(session.press('add_button').success, false);
  session.reset();
  assert.match(session.render(), /名前 \[________\]/);
  assert.throws(() => session.set('name', '\x1b[31m'));
  assert.throws(() => session.set('add_button', 'x'));
  assert.throws(() => session.press('name'));
});

test('対話入力だけ数値変換し、YAMLテストの文字列は変換しない', () => {
  const session = createSession(spec, view);
  session.set('name', '山田'); session.set('age', '30');
  assert.equal(session.press('add_button').success, true);
  const [result] = runTests(spec, { design_tests: [{ action: 'add_entry', input: { name: '山田', age: '30' }, expect: { validation_error: [{ validation: 'is_number', target: 'age' }] } }] });
  assert.equal(result.passed, true);
});

test('CLIで連続操作、EOF、preview別名、無効オプション', () => {
  const cli = (args, input) => spawnSync(process.execPath, ['bin/yaml-design.cjs', ...args], { encoding: 'utf8', input, timeout: 5000 });
  const result = cli(['interact'], '99\n3\n1\n山田太郎\n2\nABC\n3\n2\n30\n3\nr\nq\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /存在する項目番号/);
  assert.match(result.stdout, /入力エラー/);
  assert.match(result.stdout, /年齢は数値で入力してください/);
  assert.match(result.stdout, /登録しました/);
  assert.match(result.stdout, /リセットしました/);
  assert.match(result.stdout, /終了しました/);
  assert.equal(cli(['preview', '--interactive'], 'q\n').status, 0);
  assert.equal(cli(['interact'], '1\n').status, 0);
  assert.equal(cli(['interact', '--json'], '').status, 2);
  assert.equal(cli(['verify', '--interactive'], '').status, 2);
});
