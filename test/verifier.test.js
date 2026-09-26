import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readYaml, runTests, compileDesign, simulate } from '../src/verifier.js';

const source = await readYaml('design-yaml/features/screen01/screen01.spec.yaml');
const designTests = await readYaml('design-yaml/features/screen01/screen01.test.yaml');
const design = compileDesign(source);

test('projectの参照ファイルとviewの項目参照が現在の構成に一致する', async () => {
  const project = await readYaml('design-yaml/project.yaml');
  const { design_system: ds } = await readYaml(join('design-yaml', project.design_system_file));
  for (const variant of Object.values(ds.variants)) {
    assert.ok(Object.hasOwn(ds.colors, variant.background));
    assert.ok(Object.hasOwn(ds.colors, variant.foreground));
  }
  assert.ok(project.main.length > 0);
  for (const feature of project.main) {
    const spec = await readYaml(join('design-yaml', feature.spec_file));
    const view = await readYaml(join('design-yaml', feature.view_file));
    const cases = await readYaml(join('design-yaml', feature.test_file));
    const compiled = compileDesign(spec, feature.id);
    assert.ok(view[feature.id], 'viewの画面IDが一致すること');
    const screen = view[feature.id];
    assert.ok(Object.hasOwn(ds.widths, screen.layout.width));
    assert.ok(Object.hasOwn(ds.spacing, screen.layout.spacing));
    for (const field of screen.appearance.fields) {
      assert.ok(compiled.fields.has(field.field_ref));
      assert.ok(Object.hasOwn(ds.sizes, field.size));
      if (field.variant) assert.ok(Object.hasOwn(ds.variants, field.variant));
    }
    for (const breakpoint of Object.keys(screen.responsive)) {
      assert.ok(Object.hasOwn(ds.breakpoints, breakpoint));
    }
    const refs = view[feature.id].layout.sections.flatMap(s => s.fields);
    assert.equal(new Set(refs).size, refs.length, '項目参照が重複しないこと');
    assert.deepEqual([...refs].sort(), [...compiled.fields.keys()].sort());
    assert.ok(runTests(spec, cases, feature.id).every(r => r.passed));
  }
});

test('現在の設計YAMLの5ケースを実行できる', () => {
  const results = runTests(source, designTests);
  assert.equal(results.length, 5);
  assert.ok(results.every(r => r.passed));
});

test('空白とnullを必須エラーにし、falseや無限値は数値にしない', () => {
  for (const name of ['  ', null, undefined]) {
    const actual = simulate(design, 'add_entry', { name, age: 20 });
    assert.deepEqual(actual.validation_error, [{ validation: 'required', target: 'name' }]);
    assert.deepEqual(actual.processes, []);
    assert.deepEqual(actual.messages, ['名前を入力してください。']);
  }
  for (const age of [false, Infinity, NaN, '20']) {
    assert.deepEqual(simulate(design, 'add_entry', { name: '山田', age }).validation_error, [{ validation: 'is_number', target: 'age' }]);
  }
});

test('設計の検証条件を変更すると既存テストが失敗する', () => {
  const mutated = structuredClone(source);
  mutated.screen01.validations[1].condition.expected = false;
  const numberCase = designTests.design_tests.find(t => t.input.age === '30');
  assert.ok(numberCase, '数値文字列のテストケースが必要');
  const [result] = runTests(mutated, { design_tests: [numberCase] });
  assert.equal(result.passed, false);
  assert.deepEqual(result.differences[0], { key: 'validation_error', expected: [{ validation: 'is_number', target: 'age' }], actual: [] });
});

test('登録を入力検証より先に移動すると副作用テストが失敗する', async () => {
  const mutated = structuredClone(source);
  const steps = mutated.screen01.actions[0].steps;
  [steps[0], steps[1]] = [steps[1], steps[0]];
  const cases = await readYaml('design-yaml/features/screen01/screen01.test.yaml');
  const result = runTests(mutated, cases)[1];
  assert.equal(result.passed, false);
  assert.ok(result.differences.some(d => d.key === 'processes'));
});

test('参照切れ、ID重複、未対応仕様を拒否する', () => {
  const mutations = [
    d => { d.screen01.actions[0].steps[0].rules[0].target = 'unknown'; },
    d => { d.screen01.actions[0].steps[0].rules[0].validation = 'unknown'; },
    d => { d.screen01.fields.push(d.screen01.fields[0]); },
    d => { d.screen01.validations[0].condition.operator = 'unknown'; },
    d => { d.screen01.actions[0].steps[1].type = 'unknown'; },
    d => { d.screen01.fields[2].action = 'unknown'; },
    d => { d.screen01.actions[0].steps[0].on_error.action = 'continue'; },
    d => { d.screen01.actions[0].steps[1].unexpected = true; },
  ];
  for (const mutate of mutations) {
    const d = structuredClone(source);
    mutate(d);
    assert.throws(() => compileDesign(d));
  }
});

test('空テスト、未知の期待値、矛盾した期待値を拒否する', () => {
  const invalid = [
    { design_tests: [] },
    { design_tests: [{ action: 'add_entry', input: {}, expect: {} }] },
    { design_tests: [{ action: 'add_entry', input: {}, expect: { sucess: true } }] },
    { design_tests: [{ action: 'add_entry', input: {}, expect: { success: true, validation_error: [{ validation: 'required', target: 'name' }] } }] },
    { design_tests: [{ action: 'add_entry', input: {}, expect: { validation_error: [{ validation: 'missing', target: 'name' }] } }] },
    { design_tests: [{ action: 'unknown', input: {}, expect: { success: true } }] },
  ];
  for (const tests of invalid) assert.throws(() => runTests(source, tests));
});

test('旧形式と条件の正常値が未定義の設計を拒否する', () => {
  const missing = structuredClone(source);
  delete missing.screen01.validations[0].condition.expected;
  assert.throws(() => compileDesign(missing), /condition.expected/);
  missing.screen01.validations[0].condition.expected = 'false';
  assert.throws(() => compileDesign(missing), /condition.expected/);
  const legacy = structuredClone(designTests);
  legacy.design_tests[1].expect.validation_error = ['required:name'];
  assert.throws(() => runTests(source, legacy), /マッピング/);
  const misplaced = structuredClone(source);
  misplaced.screen01.actions[0].validations = [];
  assert.throws(() => compileDesign(misplaced), /未対応のキー/);
});

test('CLIの終了コード0/1/2とJSON出力', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yaml-verifier-'));
  const cli = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8' });
  try {
    const good = cli('--json');
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).passed, 5);
    const mismatch = join(dir, 'mismatch.yaml');
    await writeFile(mismatch, 'design_tests:\n  - action: add_entry\n    input: {name: 山田, age: 20}\n    expect: {success: false}\n');
    const bad = cli('--design', 'design-yaml/features/screen01/screen01.spec.yaml', '--test', mismatch);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /expected: false/);
    assert.match(bad.stdout, /actual:   true/);
    const invalid = join(dir, 'invalid.yaml');
    await writeFile(invalid, 'design_tests: []\ndesign_tests: []\n');
    assert.equal(cli('--design', 'design-yaml/features/screen01/screen01.spec.yaml', '--test', invalid).status, 2);
    await writeFile(invalid, 'design_tests: [\n');
    assert.equal(cli('--design', 'design-yaml/features/screen01/screen01.spec.yaml', '--test', invalid).status, 2);
    assert.equal(cli('--test', join(dir, 'missing.yaml')).status, 2);
    assert.equal(cli('--unknown').status, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
