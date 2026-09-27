import {createDatabase} from './database.js';
import {composeScreen, enterRoute, composedInputs} from './application.js';
import { createInterface } from 'node:readline';
import { compileDesign, DefinitionError, simulate, initializeFields, validateTransitions } from './verifier.js';
import { renderPreview } from './preview.js';
import { keyboardInteract } from './keyboard.js';
import { formatFeedback } from './feedback.js';

// 対話UIだけの入力変換。YAMLテストで指定された型は変更しない。
export function inputValue(field, raw) {
  if (/[\x00-\x1f\x7f-\x9f]/u.test(raw)) throw new DefinitionError('制御文字は入力できません');
  const trimmed = raw.trim();
  if (field.type === 'number' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) return value;
  }
  return raw;
}

export function createSession(spec, view, options = {}) {
  const design = compileDesign(spec, options.screen, options.databaseSchema ?? options.database?.schema);
  const settings = { ...options, screen: design.screenId, numbered: true, databaseSchema:design.databaseSchema };
  renderPreview(spec, view, settings);
  const layout = view[design.screenId].layout;
  const ids = [...(layout.menu_bar?.fields ?? []), ...layout.sections.flatMap(section => section.fields)];
  let values = initializeFields(design, options.received);
  return {
    fields: ids.map(id => design.fields.get(id)),
    render: (focused, draft) => renderPreview(spec, view, { ...settings, values: draft === undefined ? values : { ...values, [focused]: draft }, focused }),
    get: id => Object.hasOwn(values, id) ? String(values[id]) : '',
    set(id, raw) {
      const field = design.fields.get(id);
      if (!field || field.type === 'button' || field.readonly) throw new DefinitionError('入力項目を指定してください');
      values[id] = inputValue(field, raw);
    },
    press(id) {
      const field = design.fields.get(id);
      if (field?.type !== 'button') throw new DefinitionError('ボタンを指定してください');
      return simulate(design, field.action, Object.fromEntries(Object.entries(values).filter(([id]) => !design.fields.get(id).readonly)), options.received, id, options.database);
    },
    reset() { values = initializeFields(design, options.received); },
  };
}

export async function interact(spec, view, options = {}, input = process.stdin, output = process.stdout) {
  const session = options.screens ? createFlowSession(options.screens, options) : createSession(spec, view, options);
  try { return await interactSession(session,input,output); } finally { session.close?.(); }
}

async function interactSession(session,input,output) {
  if (input.isTTY && output.isTTY) return keyboardInteract(session, input, output);
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const write = text => output.write(text);
  const ask = async prompt => {
    write(prompt);
    const { value, done } = await lines.next();
    return done ? null : value;
  };
  const instructions = '番号 + Enter: 項目編集 / ボタン押下 | r: 入力をリセット | q: 終了';
  rl.on('SIGINT', () => rl.close());
  try {
    write(`対話ワイヤーフレーム（${session.databaseInfo ?? 'アクションを模擬実行・データ保存なし'}）\n`);
    let feedback = session.entryFeedback ? formatFeedback(session.entryFeedback) : '';
    while (true) {
      write(`\n${session.render()}\n${feedback}--- 操作ガイド ---\n${instructions}\n`);
      const selected = await ask('操作 > ');
      if (selected === null || selected.trim() === 'q') break;
      if (selected.trim() === 'r') { session.reset(); feedback = '入力をリセットしました。\n' + (session.entryFeedback ? formatFeedback(session.entryFeedback) : ''); continue; }
      if (!/^[1-9]\d*$/u.test(selected.trim())) { feedback = '項目番号、r、qを入力してください。\n'; continue; }
      const field = session.fields[Number(selected.trim()) - 1];
      if (!field) { feedback = '存在する項目番号を選んでください。\n'; continue; }
      if (field.readonly) { feedback = '読み取り専用です。\n'; continue; }
      if (field.type !== 'button') {
        const value = await ask(`${field.label}（空Enterで空欄） > `);
        if (value === null) break;
        try { session.set(field.id, value); feedback = ''; }
        catch (error) { feedback = `${error.message}\n`; }
      } else {
        const result = session.press(field.id);
        feedback = formatFeedback(result);
      }
    }
    write('\n終了しました。\n');
  } finally { rl.close(); }
}

export function createFlowSession(screens, options = {}) {
  const database=options.database ?? createDatabase(screens.databaseSchema,{file:options.dbFile ?? ':memory:'});
  const owned=database && !options.database;
  try {
    const create=()=>createFlowSessionInternal(screens,{...options,database,databaseSchema:screens.databaseSchema});
    const session=database?database.atomic(create):create();
    const press=session.press.bind(session), reset=session.reset.bind(session);
    session.press=id=>database?database.atomic(()=>press(id)):press(id);
    session.reset=()=>database?database.atomic(reset):reset();
    session.close=()=>{if(owned)database.close();};
    session.databaseInfo=database ? (database.file===':memory:'?'SQLite: 起動中のみ保持':`SQLite: ${database.file}`) : undefined;
    return session;
  } catch(error) {if(owned)database.close();throw error;}
}

function createFlowSessionInternal(screens, options = {}) {
  if (screens.app) return createWebSession(screens,options);
  if (options.path) throw new DefinitionError('--pathにはproject.yamlのroutesが必要です');
  const catalog = new Map(screens.map(s => [s.screen, compileDesign(s.spec, s.screen, screens.databaseSchema)]));
  catalog.routes=screens.routes;
  validateTransitions(catalog);
  const start = options.screen ?? screens[0].screen;
  let current, active;
  const open = (id, received = {}) => {
    const screen = screens.find(s => s.screen === id);
    if (!screen) throw new DefinitionError(`画面が存在しません: ${id}`);
    const next = createSession(screen.spec, screen.view, { ...options, screen: id, received });
    active = next; current = id;
  };
  open(start);
  return {
    get screenId() { return current; },
    get fields() { return active.fields; },
    render: (...args) => active.render(...args),
    get: id => active.get(id), set: (id, raw) => active.set(id, raw),
    press(id) { const result = active.press(id); if (result.transition) open(result.transition.target, result.transition.inputs); return result; },
    reset() { open(start); },
  };
}

function hookFeedback(hooks) {
  return {success:true,messages:hooks.flatMap(h=>h.messages),debug_logs:hooks.flatMap(h=>h.debug_logs),validation_error:[],processes:[]};
}

export function createWebSession(screens, options = {}) {
  const start=options.path ?? (options.screen ? [...screens.routes].find(([,id])=>id===options.screen)?.[0] : '/');
  if (!start) throw new DefinitionError(`開始画面が存在しません: ${options.screen}`);
  for (const screen of screens) {
    renderPreview(screen.spec,screen.view,{screen:screen.screen,databaseSchema:screens.databaseSchema});
    const combined=composeScreen(screen,screens.app);
    renderPreview(combined.spec,combined.view,{screen:screen.screen,databaseSchema:screens.databaseSchema});
  }
  let active, current, path, entryFeedback;
  const open=(nextPath, received={})=>{
    const entered=enterRoute(screens,nextPath,received,options.database);
    const {spec,view}=composeScreen(entered.screen,screens.app);
    const next=createSession(spec,view,{...options,path:entered.path,screen:entered.screen.screen,received:composedInputs(screens.app,entered.path,entered.screen.screen,entered.received)});
    active=next;current=entered.screen.screen;path=entered.path;entryFeedback=hookFeedback(entered.hooks);
    return entered;
  };
  open(start);
  return {
    get screenId(){return current;}, get path(){return path;},
    get fields(){return active.fields;}, get entryFeedback(){return entryFeedback;},
    render:(...args)=>active.render(...args),
    get:id=>active.get(id),set:(id,raw)=>active.set(id,raw),
    press(id){
      const result=active.press(id);
      if(result.transition){
        const entered=open(result.transition.target,result.transition.inputs);
        result.messages.push(...entryFeedback.messages);result.debug_logs.push(...entryFeedback.debug_logs);
        result.common_results=entered.hooks;
        result.transition={target:path,inputs:entered.received};
      }
      return result;
    },
    reset(){open('/');},
  };
}
