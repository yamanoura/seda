import {compileDatabase} from './database.js';
import {dirname, resolve} from 'node:path';
import {DefinitionError, readYaml, compileDesign, simulate, validateTransitions} from './verifier.js';

const fail = (path, message) => { throw new DefinitionError(`${path}: ${message}`); };
const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'マッピングが必要です');
};
const keys = (value, allowed, path) => {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `未対応のキー: ${key}`);
};
const text = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) fail(path, '空でない文字列が必要です');
};
export function checkPath(value, path = 'path') {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\s?#\\:*\x00-\x1f\x7f]/u.test(value)
    || value.includes('//') || value.split('/').some(s => s === '.' || s === '..') || (value !== '/' && value.endsWith('/'))) {
    fail(path, '先頭が / の固定パスを指定してください（末尾 /・クエリ・動的パスは未対応）');
  }
}
const HOOK = '__seda_before_each__';
const prefix = id => `app::${id}`;

export async function loadApplication(filename, {requireViews = true, requireTests = false} = {}) {
  const project = await readYaml(filename);
  keys(project, ['main', 'design_system_file', 'routes', 'app_file', 'route_test_file', 'database_file'], filename);
  const web = project.routes !== undefined || project.app_file !== undefined;
  const file = value => { text(value, filename); return resolve(dirname(filename), value); };
  if (project.design_system_file !== undefined) await readYaml(file(project.design_system_file));
  const databaseSchema=project.database_file === undefined ? undefined : compileDatabase(await readYaml(file(project.database_file)));
  if (!Array.isArray(project.main) || !project.main.length) fail(filename, 'mainに1件以上の画面が必要です');
  const ids = new Set();
  for (const entry of project.main) {
    keys(entry, ['id','type','spec_file','view_file','test_file'], filename);
    text(entry.id, filename);
    if (ids.has(entry.id)) fail(filename, `画面IDが不正または重複: ${entry.id}`);
    ids.add(entry.id);
    if (entry.type !== 'screen') fail(filename, `未対応のtype: ${entry.type}`);
    file(entry.spec_file);
    if (requireViews || web || entry.view_file !== undefined) file(entry.view_file);
    if (requireTests) file(entry.test_file);
  }
  let routes, app;
  if (web) {
    if (!Array.isArray(project.routes) || !project.routes.length) fail(filename, 'routesに1件以上必要です');
    routes = new Map();
    for (const route of project.routes) {
      keys(route, ['path','screen'], 'routes'); checkPath(route.path);
      if (routes.has(route.path)) fail(filename, `パスが重複しています: ${route.path}`);
      if (!ids.has(route.screen)) fail(filename, `画面が存在しません: ${route.screen}`);
      routes.set(route.path, route.screen);
    }
    if (!routes.has('/')) fail(filename, 'ルートパス / の定義が必要です');
    for (const id of ids) if (![...routes.values()].includes(id)) fail(filename, `ルートがない画面: ${id}`);
    app = compileApplication(await readYaml(file(project.app_file)),databaseSchema);
  }
  const screens = [];
  for (const entry of project.main) {
    const spec = await readYaml(file(entry.spec_file));
    const view = entry.view_file === undefined ? undefined : await readYaml(file(entry.view_file));
    if (view && !Object.hasOwn(view, entry.id)) fail(entry.view_file, `viewの画面IDが一致しません: ${entry.id}`);
    const design = compileDesign(spec, entry.id, databaseSchema);
    if (web) for (const values of [design.fields, design.actions, design.validations, design.parameters]) {
      for (const id of values.keys()) if (id.startsWith('app::')) fail(entry.id, 'app:: は共通定義用の予約接頭辞です');
    }
    screens.push({screen:entry.id, spec, view, design, testFile:entry.test_file === undefined ? undefined : file(entry.test_file)});
  }
  const catalog = new Map(screens.map(s => [s.screen, s.design]));
  catalog.routes = routes; catalog.databaseSchema=databaseSchema;
  validateTransitions(catalog);
  if (app) {
    const all = new Map(catalog); all.routes = routes; all.set(Symbol('app'), app.design);
    validateTransitions(all);
  }
  if (project.route_test_file !== undefined && !web) fail(filename, 'route_test_fileにはroutesとapp_fileが必要です');
  screens.routeTestFile = project.route_test_file === undefined ? undefined : file(project.route_test_file);
  screens.databaseSchema=databaseSchema; screens.routes = routes; screens.app = app; screens.catalog = catalog;
  return screens;
}

function compileApplication(document,databaseSchema) {
  keys(document, ['app'], 'app_file');
  const app = document.app;
  keys(app, ['description','inputs','fields','actions','validations','before_each','view'], 'app');
  keys(app.before_each, ['action','inputs'], 'app.before_each');
  text(app.before_each.action, 'app.before_each.action');
  const {before_each, view, ...spec} = structuredClone(app);
  spec.fields ??= [];
  if (spec.fields.some(f => f.id === HOOK)) fail('app.fields', `${HOOK} は予約済みです`);
  for (const param of spec.inputs ?? []) {
    if (!['path','screen'].includes(param.id) || param.type !== 'text') fail('app.inputs', '受信引数はpath・screen（text）のみ対応しています');
  }
  // 通常の呼び出し引数検証を、画面に出さない起動用ボタンにも適用する。
  const compiled = structuredClone(spec);
  compiled.fields.push({id:HOOK,type:'button',label:'共通処理',trigger:'click',action:before_each.action,inputs:before_each.inputs ?? {}});
  const design = compileDesign({app:compiled}, 'app',databaseSchema);
  if (![...design.actions.values()].every(a => a.typed)) fail('app.actions', 'inputsは {id, type} の配列で定義してください');
  keys(view, ['title','layout','appearance','responsive'], 'app.view');
  keys(view.layout, ['type','direction','columns','menu_bar','sections'], 'app.view.layout');
  if (!Array.isArray(view.layout.sections)) fail('app.view.layout.sections', '配列が必要です');
  const outlets = view.layout.sections.filter(s => s?.type === 'outlet');
  if (outlets.length !== 1) fail('app.view.layout.sections', 'type: outlet を1つ指定してください');
  keys(outlets[0], ['id','type'], 'app.outlet'); text(outlets[0].id, 'app.outlet.id');
  const sectionIds = view.layout.sections.map(s => s?.id);
  if (sectionIds.some(id => typeof id !== 'string' || !id) || new Set(sectionIds).size !== sectionIds.length) fail('app.view.layout.sections', 'セクションIDが未指定または重複しています');
  return {spec, view, before_each, design};
}

export function resolveRoute(screens, path) {
  checkPath(path);
  const id = screens.routes?.get(path);
  if (!id) fail('routes', `パスが定義されていません: ${path}`);
  return screens.find(s => s.screen === id);
}

export function commonInputs(app, path, screen) {
  return Object.fromEntries((app.spec.inputs ?? []).map(p => [p.id, p.id === 'path' ? path : screen]));
}

// レンダリングのたびではなく、ルートへ入るたびに一度実行する。
export function enterRoute(screens,path,received={},database) {
  const run=()=>enterRouteInternal(screens,path,received,database);
  return database ? database.atomic(run) : run();
}
function enterRouteInternal(screens, path, received = {}, database) {
  const visited = new Set(), hooks = [];
  while (true) {
    if (visited.has(path)) fail('app.before_each', `リダイレクトが循環しています: ${[...visited, path].join(' → ')}`);
    visited.add(path);
    const screen = resolveRoute(screens, path);
    const result = simulate(screens.app.design, screens.app.before_each.action, {}, commonInputs(screens.app, path, screen.screen), HOOK, database);
    hooks.push({path, screen:screen.screen, ...result});
    if (!result.success) fail('app.before_each', `共通処理の検証エラーで画面表示を中止しました: ${result.messages.join(' / ') || JSON.stringify(result.validation_error)}`);
    if (!result.transition) return {screen, path, received, hooks};
    path = result.transition.target; received = result.transition.inputs;
  }
}

export function composeScreen(screen, app) {
  if (!app) return {spec:screen.spec, view:screen.view};
  const page = structuredClone(screen.spec[screen.screen]);
  const common = structuredClone(app.spec);
  const binding = ref => {
    if (Object.hasOwn(ref, 'field')) ref.field = prefix(ref.field);
    if (Object.hasOwn(ref, 'input')) ref.input = prefix(ref.input);
  };
  for (const field of common.fields) {
    field.id = prefix(field.id);
    if (field.action) field.action = prefix(field.action);
    if (field.source) binding(field.source);
    for (const ref of Object.values(field.inputs ?? {})) binding(ref);
  }
  for (const action of common.actions) {
    action.id = prefix(action.id);
    for (const step of action.steps) {
      if (step.type === 'process') step.action = prefix(step.action);
      for (const rule of step.rules ?? []) rule.validation = prefix(rule.validation);
    }
  }
  for (const validation of common.validations ?? []) validation.id = prefix(validation.id);
  for (const input of common.inputs ?? []) input.id = prefix(input.id);
  for (const key of ['fields','actions','validations','inputs']) page[key] = [...(common[key] ?? []), ...(page[key] ?? [])];
  const pageView = structuredClone(screen.view[screen.screen]);
  const view = structuredClone(app.view);
  if (view.responsive === undefined && pageView.responsive !== undefined) view.responsive = pageView.responsive;
  if (view.layout.columns === undefined && pageView.layout.columns !== undefined) view.layout.columns = pageView.layout.columns;
  view.title = [view.title, pageView.title ?? screen.screen].filter(Boolean).join(' / ');
  view.layout.sections = view.layout.sections.flatMap(section => {
    if (section.type === 'outlet') return pageView.layout.sections.map(s => ({...s, id:`screen::${s.id}`, direction:s.direction ?? pageView.layout.direction}));
    return [{...section, id:prefix(section.id), fields:section.fields?.map(prefix)}];
  });
  // 不正なmenu_barを合成で隠さない。
  for (const bar of [view.layout.menu_bar, pageView.layout.menu_bar]) if (bar !== undefined) {
    keys(bar,['fields'],'menu_bar');
    if (!Array.isArray(bar.fields) || !bar.fields.length) fail('menu_bar.fields','1件以上必要です');
  }
  const menu = [...(view.layout.menu_bar?.fields ?? []).map(prefix), ...(pageView.layout.menu_bar?.fields ?? [])];
  if (menu.length) view.layout.menu_bar = {fields:menu};
  return {spec:{[screen.screen]:page},view:{[screen.screen]:view}};
}

export function composedInputs(app, path, screen, received) {
  return {...received, ...Object.fromEntries(Object.entries(commonInputs(app,path,screen)).map(([id,value])=>[prefix(id),value]))};
}
