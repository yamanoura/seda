import { dirname, resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { DefinitionError, readYaml, runTests } from './verifier.js';

export async function runProject(filename, screenId) {
  const project = await readYaml(filename);
  const fail = message => { throw new DefinitionError(`${filename}: ${message}`); };
  if (!project || typeof project !== 'object' || Array.isArray(project)) fail('マッピングが必要です');
  for (const key of Object.keys(project)) {
    if (!['main', 'design_system_file'].includes(key)) fail(`未対応のキー: ${key}`);
  }
  if (!Array.isArray(project.main) || !project.main.length) fail('mainに1件以上の画面が必要です');
  const file = value => {
    if (typeof value !== 'string' || !value.trim()) fail('参照ファイル名には空でない文字列が必要です');
    return resolve(dirname(filename), value);
  };
  if (project.design_system_file !== undefined) await readYaml(file(project.design_system_file));
  const ids = new Set();
  for (const entry of project.main) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('mainの各要素はマッピングが必要です');
    for (const key of Object.keys(entry)) {
      if (!['id', 'type', 'spec_file', 'test_file', 'view_file'].includes(key)) fail(`未対応のキー: ${key}`);
    }
    if (typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)) fail(`画面IDが不正または重複: ${entry.id}`);
    ids.add(entry.id);
    if (entry.type !== 'screen') fail(`未対応のtype: ${entry.type}`);
    file(entry.spec_file);
    file(entry.test_file);
    if (entry.view_file !== undefined) file(entry.view_file);
  }
  if (screenId && !ids.has(screenId)) fail(`画面が存在しません: ${screenId}`);
  const results = [];
  for (const entry of project.main.filter(e => !screenId || e.id === screenId)) {
    const specPath = file(entry.spec_file);
    const testPath = file(entry.test_file);
    const spec = await readYaml(specPath);
    const tests = await readYaml(testPath);
    if (entry.view_file !== undefined) {
      const view = await readYaml(file(entry.view_file));
      if (!view || !Object.hasOwn(view, entry.id)) fail(`viewの画面IDが一致しません: ${entry.id}`);
    }
    try {
      results.push(...runTests(spec, tests, entry.id).map(r => ({ screen: entry.id, ...r })));
    } catch (error) {
      throw new DefinitionError(`${specPath} / ${testPath}: ${error.message}`);
    }
  }
  return results;
}

export async function findProject() {
  for (const candidate of ['project.yaml', 'design-yaml/project.yaml']) {
    try { await access(candidate); return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new DefinitionError('project.yamlが見つかりません。--project <ファイル> を指定するか seda init <新規ディレクトリ> を実行してください');
}
