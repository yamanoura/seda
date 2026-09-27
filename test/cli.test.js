import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
const executable = resolve('bin/yaml-design.cjs');

test('別ディレクトリで初期化、検証、複数画面、絞り込みとエラーを確認する', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yaml-design-cli-'));
  const cli = (...args) => spawnSync(process.execPath, [executable, ...args], { cwd, encoding: 'utf8' });
  try {
    assert.equal(cli('--help').status, 0);
    assert.match(cli('--version').stdout, /^\d+\.\d+\.\d+/);
    assert.equal(cli().status, 2);
    assert.equal(cli('init', 'sample').status, 0);
    const projectPath = join(cwd, 'sample/project.yaml');
    const before = await readFile(projectPath, 'utf8');
    // サブディレクトリに有効なひな形があっても暗黙に選ばない。
    await cp(join(cwd, 'sample'), join(cwd, 'design-yaml'), { recursive: true });
    for (const command of ['verify', 'preview', 'interact']) {
      const missing = cli(command);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /現在のディレクトリにproject.yamlがありません/);
    }
    const explicit = cli('verify', '--project', 'design-yaml/project.yaml');
    assert.equal(explicit.status, 0, explicit.stderr);
    for (const args of [['preview'], ['interact']]) {
      const local = spawnSync(process.execPath, [executable, ...args], {
        cwd: join(cwd, 'sample'), encoding: 'utf8', input: 'q\n', timeout: 5000,
      });
      assert.equal(local.status, 0, local.stderr);
    }

    assert.equal(cli('init', 'sample').status, 2);
    assert.equal(await readFile(projectPath, 'utf8'), before);
    const check = cli('verify', '--project', projectPath, '--json');
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).passed, 5);
    const auto = spawnSync(process.execPath, [executable, 'verify'], { cwd: join(cwd, 'sample'), encoding: 'utf8' });
    assert.equal(auto.status, 0, auto.stderr);
    const project = parse(before);
    const specPath = join(cwd, 'sample/features/screen01/screen01.spec.yaml');
    const viewPath = join(cwd, 'sample/features/screen01/screen01.view.yaml');
    const spec = parse(await readFile(specPath, 'utf8'));
    const view = parse(await readFile(viewPath, 'utf8'));
    spec.screen02 = structuredClone(spec.screen01);
    view.screen02 = structuredClone(view.screen01);
    await writeFile(specPath, stringify(spec));
    await writeFile(viewPath, stringify(view));
    project.main.push({ ...project.main[0], id: 'screen02' });
    project.routes.push({path:'/second',screen:'screen02'});
    await writeFile(projectPath, stringify(project));
    assert.equal(JSON.parse(cli('-p', projectPath, '--json').stdout).total, 10);
    assert.equal(JSON.parse(cli('-p', projectPath, '--screen', 'screen02', '--json').stdout).total, 5);
    const unknown = cli('-p', projectPath, '--screen', 'missing', '--json');
    assert.equal(unknown.status, 2);
    assert.match(JSON.parse(unknown.stdout).error.message, /画面が存在/);
    project.main[1].id = 'screen01';
    await writeFile(projectPath, stringify(project));
    assert.equal(cli('-p', projectPath).status, 2);
    project.main.pop();
    project.main[0].test_file = 'missing.yaml';
    await writeFile(projectPath, stringify(project));
    assert.equal(cli('-p', projectPath).status, 2);
    assert.equal(cli('unknown').status, 2);
    assert.equal(cli('--design', specPath).status, 2);
    assert.equal(cli('--project', projectPath, '--design', specPath, '--test', specPath).status, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
