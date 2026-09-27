import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify, parse } from 'yaml';
import { readYaml, compileDesign } from '../src/verifier.js';
const source = await readYaml('test/fixtures/registration/features/screen01/screen01.spec.yaml');

test('未定義の処理は入力チェックで停止する経路でもコンパイル時に拒否する', () => {
  const spec = structuredClone(source);
  spec.screen01.actions.pop();
  assert.throws(() => compileDesign(spec), /create_user が定義されていません/);
});

test('処理の引数契約と定義を検証する', () => {
  for (const mutate of [
    s => {s.actions[0].steps[1].action = 'missing';},
    s => {delete s.actions[0].steps[1].inputs.age;},
    s => {s.actions[0].steps[1].inputs.extra = {literal: true};},
    s => {s.actions[0].steps[1].inputs.age = {literal: '30'};},
    s => {s.actions[0].steps[1].inputs.name = {input: 'missing'};},
    s => {s.actions.push(structuredClone(s.actions[1]));},
    s => {s.actions[1].inputs.push({id: 'name', type: 'text'});},
    s => {s.actions[1].inputs[0].type = 'unknown';},
    s => {delete s.actions[1].steps;},
  ]) {
    const spec = structuredClone(source);
    mutate(spec.screen01);
    assert.throws(() => compileDesign(spec));
  }
  const spec = structuredClone(source);
  spec.screen01.actions[1].inputs = [];
  delete spec.screen01.actions[0].steps[1].inputs;
  assert.doesNotThrow(() => compileDesign(spec));
});

test('CLIの検証・表示・操作はいずれも未定義処理をエラーにする', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'seda-process-'));
  try {
    await cp('examples', cwd, {recursive: true});
    const file = join(cwd, 'features/screen02/screen02.spec.yaml');
    const spec = parse(await readFile(file, 'utf8'));
    spec.screen02.actions.pop();
    await writeFile(file, stringify(spec));
    for (const args of [['verify'], ['verify','--screen','screen01'], ['preview','--screen','screen02'], ['interact']]) {
      const result = spawnSync(process.execPath, [resolve('src/cli.js'), ...args], {cwd, encoding:'utf8',input:'q\n',timeout:5000});
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stderr, /create_user が定義されていません/);
    }
  } finally {
    await rm(cwd, {recursive:true, force:true});
  }
});
