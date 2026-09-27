import {isDeepStrictEqual} from 'node:util';
import {loadApplication, composeScreen, enterRoute} from './application.js';
import {renderPreview} from './preview.js';
import { access } from 'node:fs/promises';
import { DefinitionError, readYaml, runTests, initializeFields } from './verifier.js';

export async function runProject(filename, screenId) {
  const screens = await loadApplication(filename, {requireViews:false, requireTests:true});
  if (screenId && !screens.some(s => s.screen === screenId)) throw new DefinitionError(`画面が存在しません: ${screenId}`);
  const results = [];
  for (const screen of screens) {
    if (screens.app) {
      // 共通レイアウトと全画面の組み合わせを静的に検証する。
      renderPreview(screen.spec, screen.view, {screen:screen.screen});
      const combined = composeScreen(screen, screens.app);
      renderPreview(combined.spec, combined.view, {screen:screen.screen});
    }
  }
  if (screens.app) for (const path of screens.routes.keys()) enterRoute(screens,path);
  for (const screen of screens.filter(s => !screenId || s.screen === screenId)) {
    try {
      results.push(...runTests(screen.spec, await readYaml(screen.testFile), screen.screen, screens.catalog).map(r => ({screen:screen.screen, ...r})));
    } catch (error) {
      throw new DefinitionError(`${screen.testFile}: ${error.message}`);
    }
  }
  if (screens.routeTestFile && !screenId) results.push(...await runRouteTests(screens));
  return results;
}

export async function findProject() {
  try {
    await access('project.yaml');
    return 'project.yaml';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  throw new DefinitionError('現在のディレクトリにproject.yamlがありません。--project <ファイル> を指定するか、project.yamlのあるディレクトリで実行してください');
}

async function runRouteTests(screens) {
  const document=await readYaml(screens.routeTestFile);
  const fail=message=>{throw new DefinitionError(`${screens.routeTestFile}: ${message}`);};
  if (!document || Object.keys(document).some(k=>k!=='route_tests') || !Array.isArray(document.route_tests) || !document.route_tests.length) fail('route_testsに1件以上必要です');
  return document.route_tests.map((test,index)=>{
    if (!test || typeof test!=='object' || Array.isArray(test) || Object.keys(test).some(k=>!['name','path','screen_inputs','expect'].includes(k))) fail('未対応のルートテスト形式です');
    if (test.name!==undefined && typeof test.name!=='string') fail('nameには文字列が必要です');
    const expected=test.expect;
    if (!expected || typeof expected!=='object' || Array.isArray(expected) || !Object.keys(expected).length) fail('expectに期待値が必要です');
    for (const [key,value] of Object.entries(expected)) {
      if (['path','screen'].includes(key)) { if(typeof value!=='string') fail(`${key}には文字列が必要です`); }
      else if (['messages','debug_logs'].includes(key)) {if(!Array.isArray(value)||value.some(v=>typeof v!=='string')) fail(`${key}には文字列の配列が必要です`);}
      else fail(`未対応の期待値: ${key}`);
    }
    const entered=enterRoute(screens,test.path,test.screen_inputs ?? {});
    initializeFields(entered.screen.design,entered.received);
    const actual={path:entered.path,screen:entered.screen.screen,messages:entered.hooks.flatMap(h=>h.messages),debug_logs:entered.hooks.flatMap(h=>h.debug_logs)};
    const differences=Object.entries(expected).filter(([key,value])=>!isDeepStrictEqual(value,actual[key])).map(([key,value])=>({key,expected:value,actual:actual[key]}));
    return {screen:'routes',name:test.name ?? `route ${index+1}`,passed:!differences.length,differences,actual};
  });
}
