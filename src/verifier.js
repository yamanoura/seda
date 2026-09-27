import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

import {DefinitionError, DatabaseError, ActionError} from './errors.js';
import {createDatabase, validateRows, valueType} from './database.js';
import {normalizeOrmStep} from './orm.js';
import {compileReturn, recordType, assignable, validReturn} from './returns.js';
export {DefinitionError} from './errors.js';

function check(condition, path, message) {
  if (!condition) throw new DefinitionError(`${path}: ${message}`);
}
function object(value, path) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'マッピングが必要です');
}
function keys(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) check(allowed.includes(key), `${path}.${key}`, '未対応のキーです');
}
function string(value, path) {
  check(typeof value === 'string' && value.length > 0, path, '空でない文字列が必要です');
}
function array(value, path, nonempty = false) {
  check(Array.isArray(value), path, '配列が必要です');
  if (nonempty) check(value.length > 0, path, '1件以上必要です');
}
function indexed(value, path, allowed, nonempty = false) {
  array(value, path, nonempty);
  const map = new Map();
  value.forEach((item, i) => {
    keys(item, allowed, `${path}[${i}]`);
    string(item.id, `${path}[${i}].id`);
    check(!map.has(item.id), path, `IDが重複しています: ${item.id}`);
    map.set(item.id, item);
  });
  return map;
}

export async function readYaml(filename) {
  try {
    const doc = parseDocument(await readFile(filename, 'utf8'), { uniqueKeys: true });
    check(doc.errors.length === 0 && doc.warnings.length === 0, filename,
      [...doc.errors, ...doc.warnings].map(e => e.message).join('\n'));
    return doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    throw new DefinitionError(`${filename}: ${error.message}`);
  }
}

export function compileDesign(document, screenId, databaseSchema) {
  document = structuredClone(document);
  object(document, 'design');
  const ids = Object.keys(document);
  if (screenId === undefined) {
    check(ids.length === 1, 'design', '画面が複数ある場合は --screen を指定してください');
    screenId = ids[0];
  }
  check(Object.hasOwn(document, screenId), 'design', `画面が存在しません: ${screenId}`);
  const screen = document[screenId];
  keys(screen, ['description', 'fields', 'actions', 'validations', 'inputs'], screenId);
  if (screen.description !== undefined) string(screen.description, `${screenId}.description`);
  const fields = indexed(screen.fields, `${screenId}.fields`, ['id', 'type', 'label', 'trigger', 'action', 'source', 'readonly', 'inputs'], true);
  const validations = indexed(screen.validations ?? [], `${screenId}.validations`, ['id', 'condition', 'message']);
  const actions = indexed(screen.actions, `${screenId}.actions`, ['id', 'description', 'inputs', 'steps', 'returns'], true);
  const parameters = indexed(screen.inputs ?? [], `${screenId}.inputs`, ['id', 'type', 'required']);
  for (const param of parameters.values()) {
    check(['text', 'number', 'boolean'].includes(param.type), screenId, '未対応の受信型');
    check(param.required === undefined || typeof param.required === 'boolean', screenId, 'requiredは真偽値が必要です');
  }
  for (const field of fields.values()) {
    if (field.source !== undefined) {
      keys(field.source, ['input'], `${screenId}.${field.id}.source`);
      check(parameters.has(field.source.input), screenId, `受信引数が存在しません: ${field.source.input}`);
      const type = parameters.get(field.source.input).type;
      check(field.type === undefined || field.type === type, screenId, `継承する型と不一致: ${field.id}`);
      field.type = type;
    }
    check(field.readonly === undefined || typeof field.readonly === 'boolean', screenId, 'readonlyは真偽値が必要です');
    const p = `${screenId}.fields.${field.id}`;
    check(['text', 'number', 'button'].includes(field.type), p, `未対応の項目型: ${field.type}`);
    string(field.label, `${p}.label`);
    if (field.type === 'button') {
      check(field.trigger === 'click', `${p}.trigger`, 'click のみ対応しています');
      check(actions.has(field.action), `${p}.action`, `アクションが存在しません: ${field.action}`);
    } else {
      check(field.trigger === undefined && field.action === undefined && field.inputs === undefined, p, 'trigger/action はbutton専用です');
    }
  }
  for (const rule of validations.values()) {
    const p = `${screenId}.validations.${rule.id}`;
    keys(rule.condition, ['operator', 'expected'], `${p}.condition`);
    check(['empty', 'number'].includes(rule.condition.operator), p, `未対応の演算子: ${rule.condition.operator}`);
    check(typeof rule.condition.expected === 'boolean', `${p}.condition.expected`, '正常とする条件の評価結果を真偽値で指定してください');
    keys(rule.message, ['template'], `${p}.message`);
    string(rule.message.template, `${p}.message.template`);
    check(!/\{(?!label\})[^}]*\}/u.test(rule.message.template), p, 'テンプレート変数は {label} のみ対応しています');
  }
  for (const action of actions.values()) {
    const p = `${screenId}.actions.${action.id}`;
    if (action.description !== undefined) string(action.description, `${p}.description`);
    action.typed = Array.isArray(action.inputs) && action.inputs.every(item => item && typeof item === 'object');
    if (action.typed) {
      action.bindings = indexed(action.inputs, `${p}.inputs`, ['id', 'type']);
      for (const definition of action.bindings.values()) {
        check(['text', 'number', 'boolean'].includes(definition.type), p, `未対応の引数型: ${definition.type}`);
      }
    } else {
      // 旧形式は互換用。呼び出し側のinputsとの混在は拒否する。
      if (Array.isArray(action.inputs)) {
        check(action.inputs.every(id => typeof id === 'string') && new Set(action.inputs).size === action.inputs.length, p, '旧inputsは重複のない項目ID配列が必要です');
        action.inputs = Object.fromEntries(action.inputs.map(id => [id, { field: id }]));
      }
      object(action.inputs, `${p}.inputs`);
      action.bindings = new Map(Object.entries(action.inputs).map(([id, ref]) => [id, reference(ref, fields, parameters, `${p}.inputs.${id}`)]));
    }
    if (action.returns !== undefined) action.returnType = compileReturn(action.returns, databaseSchema, `${p}.returns`);
  }
  for (const action of actions.values()) {
    const p = `${screenId}.actions.${action.id}`;
    action.stepScopes = new Map();
    const outputs = new Map();
    const steps = indexed(action.steps, `${p}.steps`, ['id', 'type', 'rules', 'on_error', 'action', 'message', 'target', 'inputs', 'when', 'table', 'where', 'values', 'columns', 'mode', 'order_by', 'limit', 'data', 'model', 'operation', 'select', 'orderBy', 'take', 'value'], true);
    for (const step of steps.values()) {
      const s = `${p}.steps.${step.id}`;
      const orm = step.type === 'db' ? normalizeOrmStep(step, s, databaseSchema) : undefined;
      action.stepScopes.set(step.id, new Map(outputs));
      if (step.when !== undefined) {
        keys(step.when, ['input','result','column','equals','not_equals'], `${s}.when`);
        check(Object.hasOwn(step.when,'equals') !== Object.hasOwn(step.when,'not_equals'), s, 'equals / not_equals のいずれかが必要です');
        const {equals,not_equals,...ref} = step.when;
        const source = reference(ref,new Map(),action.bindings,s,outputs);
        const expected=Object.hasOwn(step.when,'equals')?equals:not_equals;
        check(expected === null || scalarType(expected) === source.type, s, 'whenの比較値の型が一致しません');
      }
      check(['validation', 'process', 'message', 'debug', 'transition', 'return', 'db.select', 'db.insert', 'db.update'].includes(step.type), s, `未対応のステップ型: ${step.type}`);
      if (step.type.startsWith('db.')) {
        check(databaseSchema, s, 'DB操作にはproject.yamlのdatabase_fileが必要です');
        const table=databaseSchema.tables.get(step.table);
        check(table,s,`テーブルが存在しません: ${step.table}`);
        const mapping=(value,name,nonempty=false)=>{
          object(value,`${s}.${name}`);
          check(!nonempty || Object.keys(value).length,s,`${name}に1件以上必要です`);
          for(const [id,ref] of Object.entries(value)) {
            const column=table.columns.get(id);
            check(column,s,`カラムが存在しません: ${id}`);
            const source=reference(ref,new Map(),action.bindings,s,outputs);
            check(source.type===valueType(column) || source.type==='null' && (name==='where' || column.nullable),s,`DBカラムの型が不一致: ${id}`);
          }
        };
        if(step.type==='db.select') {
          keys(step,['id','type','table','where','columns','mode','order_by','limit','when'],s);
          if(step.where!==undefined) mapping(step.where,'where');
          check(step.mode===undefined || ['one','many'].includes(step.mode),s,'modeはone / manyです');
          if(step.limit!==undefined) check(step.mode==='many' && Number.isInteger(step.limit) && step.limit>0 && step.limit<=10000,s,'limitはmany専用の1〜10000の整数です');
          const columns=step.columns ?? [...table.columns.keys()];
          array(columns,s,true);
          check(new Set(columns).size===columns.length && columns.every(c=>table.columns.has(c)),s,'取得カラムが未定義または重複しています');
          if(step.order_by!==undefined) {
            array(step.order_by,s,true);
            for(const order of step.order_by) {
              keys(order,['column','direction'],s);
              check(table.columns.has(order.column) && (order.direction===undefined || ['asc','desc'].includes(order.direction)),s,'order_byが不正です');
            }
          }
          const row = recordType(table, columns, step.mode !== 'many');
          outputs.set(step.id, step.mode === 'many' ? {type:'array',kind:'many',items:{...row,nullable:false}} : row);
        } else {
          keys(step,['id','type','table','values','where','when'],s);
          mapping(step.values,'values',step.type==='db.update');
          if(step.type==='db.update') mapping(step.where,'where',true);
          else {
            check(step.where===undefined,s,'insertにwhereは指定できません');
            for(const c of table.columns.values()) check(c.nullable || c.generated || Object.hasOwn(c,'default') || Object.hasOwn(step.values,c.id),s,`必須カラムが不足: ${c.id}`);
          }
          outputs.set(step.id,{type:'object',kind:'metadata',columns:new Map((step.type==='db.insert'?['changes','last_insert_id']:['changes']).map(id=>[id,{type:'number'}]))});
        }
        if (orm) {
          step.ormOperation = orm.operation;
          step.returnColumns = orm.columns;
          if (orm.operation === 'updateMany') outputs.set(step.id, {type:'object',kind:'metadata',columns:new Map([['count',{type:'number'}]])});
          else if (['create','update'].includes(orm.operation)) outputs.set(step.id, recordType(table, orm.columns));
        }
      } else if (step.type === 'return') {
        keys(step, ['id','type','value','when'], s);
        check(action.returnType, s, 'returnにはアクションのreturns定義が必要です');
        check(assignable(reference(step.value,new Map(),action.bindings,s,outputs), action.returnType), s, '返り値の型がreturnsと一致しません');
        check(step.when !== undefined || step === action.steps.at(-1), s, '無条件のreturnは最後のステップにしてください');
      } else if (step.type === 'validation') {
        keys(step, ['id', 'type', 'rules', 'on_error', 'when'], s);
        array(step.rules, `${s}.rules`, true);
        const seen = new Set();
        step.rules.forEach((rule, i) => {
          const r = `${s}.rules[${i}]`;
          keys(rule, ['validation', 'target'], r);
          check(validations.has(rule.validation), r, `検証定義が存在しません: ${rule.validation}`);
          check(action.bindings.has(rule.target), r, `対象がinputsにありません: ${rule.target}`);
          const id = JSON.stringify([rule.validation, rule.target]);
          check(!seen.has(id), r, 'ルールが重複しています');
          seen.add(id);
        });
        if (step.on_error !== undefined) {
          keys(step.on_error, ['action'], `${s}.on_error`);
          check(step.on_error.action === 'show_message', s, 'on_errorはshow_messageのみ対応しています');
        }
      } else if (step.type === 'process') {
        keys(step, ['id', 'type', 'action', 'inputs', 'when'], s);
        if (step.inputs !== undefined) validateArguments(step.inputs, action.bindings, s, outputs);
        string(step.action, `${s}.action`);
        const target = actions.get(step.action);
        check(target, s, `アクション ${step.action} が定義されていません`);
        if (target.returnType) outputs.set(step.id, target.returnType);
      } else if (step.type === 'transition') {
        keys(step, ['id', 'type', 'target', 'inputs', 'when'], s);
        string(step.target, `${s}.target`);
        if (step.inputs === undefined) step.inputs = {};
        validateArguments(step.inputs, action.bindings, s, outputs);
        check(step === action.steps.at(-1), s, 'transitionは最後のステップにしてください');
      } else {
        keys(step, step.type === 'debug' ? ['id','type','message','when','data'] : ['id','type','message','when'], s);
        if (step.data !== undefined) reference(step.data,new Map(),action.bindings,s,outputs);
        string(step.message, `${s}.message`);
      }
    }
  }
  // 返り値を宣言した関数は、正常終了時に必ずreturnへ到達する。
  const hasTransition = (action, seen = new Set()) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return action.steps.some(step => step.type === 'transition' || step.type === 'process' && hasTransition(actions.get(step.action), seen));
  };
  for (const action of actions.values()) if (action.returnType) {
    check(action.steps.at(-1)?.type === 'return' && action.steps.at(-1).when === undefined, action.id, 'returnsを定義したアクションの最後には無条件のreturnが必要です');
    check(!hasTransition(action), action.id, '返り値を返すアクションは、呼び出し先を含めtransitionを実行できません');
  }
  // 全アクションの引数を構築してから照合するため、定義順に依存しない。
  for (const action of actions.values()) for (const step of action.steps) {
    if (step.type !== 'process') continue;
    const path = `${screenId}.actions.${action.id}.steps.${step.id}`;
    const target = actions.get(step.action);
    check(target, path, `アクション ${step.action} が定義されていません`);
    check(target.typed, path, '呼び出し先のinputsは {id, type} の配列で定義してください');
    const inputs = step.inputs ?? {};
    for (const [id, ref] of Object.entries(inputs)) {
      const parameter = target.bindings.get(id);
      check(parameter, path, `アクション ${step.action} に引数 ${id} が定義されていません`);
      check(reference(ref, new Map(), action.bindings, path, action.stepScopes.get(step.id)).type === parameter.type, path, `処理引数の型が不一致: ${id}`);
    }
    for (const id of target.bindings.keys()) check(Object.hasOwn(inputs, id), path, `処理引数の指定が不足: ${id}`);
  }
  const visited = new Set(), visiting = new Set();
  function visit(id, chain = []) {
    check(!visiting.has(id), screenId, `循環呼び出し: ${[...chain, id].join(' → ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const step of actions.get(id).steps) if (step.type === 'process') visit(step.action, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of actions.keys()) visit(id);
  for (const field of fields.values()) {
    if (field.type !== 'button') continue;
    const action = actions.get(field.action);
    const path = `${screenId}.fields.${field.id}.inputs`;
    if (!action.typed) {
      check(field.inputs === undefined, path, '旧アクションinputsと呼び出し側inputsを混在できません');
      field.bindings = action.bindings;
      continue;
    }
    object(field.inputs, path);
    field.bindings = new Map();
    for (const [id, ref] of Object.entries(field.inputs)) {
      const definition = action.bindings.get(id);
      check(definition, path, `未定義の引数: ${id}`);
      const binding = reference(ref, fields, parameters, `${path}.${id}`);
      check(binding.type === definition.type, path, `引数の型が不一致: ${id}`);
      field.bindings.set(id, binding);
    }
    for (const id of action.bindings.keys()) check(field.bindings.has(id), path, `引数の指定が不足: ${id}`);
  }
  return { screenId, fields, validations, actions, parameters, databaseSchema };
}

const resultKeys = ['success', 'validation_error', 'messages', 'processes', 'executed_steps', 'transition', 'process_calls', 'field_values', 'debug_logs', 'database', 'db_results', 'db_error', 'return_value', 'action_results', 'action_error'];

export function validateTests(document, design) {
  keys(document, ['design_tests'], 'tests');
  array(document.design_tests, 'design_tests', true);
  document.design_tests.forEach((test, i) => {
    const p = `design_tests[${i}]`;
    keys(test, ['name', 'action', 'button', 'input', 'screen_inputs', 'database', 'expect'], p);
    if (test.name !== undefined) string(test.name, `${p}.name`);
    check(design.actions.has(test.action), `${p}.action`, `アクションが存在しません: ${test.action}`);
    const action = design.actions.get(test.action);
    selectBindings(design, action, test.button);
    object(test.input, `${p}.input`);
    for (const [key, value] of Object.entries(test.input)) {
      check(design.fields.has(key) && design.fields.get(key).type !== 'button' && !design.fields.get(key).readonly, `${p}.input.${key}`, 'アクションの入力項目ではありません');
      check(value === null || ['string', 'number', 'boolean'].includes(typeof value), `${p}.input.${key}`, 'スカラー値が必要です');
    }
    if (test.database !== undefined) validateRows(design.databaseSchema,test.database,{complete:true});
    keys(test.expect, resultKeys, `${p}.expect`);
    check(Object.keys(test.expect).length > 0, `${p}.expect`, '期待値が空です');
    for (const [key, value] of Object.entries(test.expect)) {
      if (key === 'success') check(typeof value === 'boolean', `${p}.expect.success`, '真偽値が必要です');
      else if (key === 'database') validateRows(design.databaseSchema,value);
      else if (key === 'return_value') {} // 実際の返り値は宣言型で実行時にも検証する。
      else if (key === 'db_results' || key === 'action_results') object(value,p);
      else if (key === 'transition') {
        if (value !== null) {
          keys(value, ['target', 'inputs'], `${p}.expect.transition`);
          string(value.target, p); object(value.inputs, p);
        }
      } else if (key === 'field_values') object(value, p);
      else if (key === 'process_calls') {
        array(value, p);
        for (const call of value) { keys(call, ['action', 'inputs'], p); string(call.action, p); object(call.inputs, p); }
      } else {
        array(value, `${p}.expect.${key}`);
        value.forEach((v, j) => {
          const path = `${p}.expect.${key}[${j}]`;
          if (key === 'validation_error') {
            keys(v, ['validation', 'target'], path);
            string(v.validation, `${path}.validation`);
            string(v.target, `${path}.target`);
          } else string(v, path);
        });
      }
    }
    if (test.expect.validation_error !== undefined) {
      const available = new Set();
      const seen = new Set();
      function collect(current) {
        if (seen.has(current.id)) return;
        seen.add(current.id);
        for (const step of current.steps) {
          for (const rule of step.rules ?? []) available.add(JSON.stringify([rule.validation, rule.target]));
          if (step.type === 'process') collect(design.actions.get(step.action));
        }
      }
      collect(action);
      for (const ref of test.expect.validation_error) check(available.has(JSON.stringify([ref.validation, ref.target])), `${p}.expect.validation_error`, `ルール参照が存在しません: ${JSON.stringify(ref)}`);
      if (test.expect.success !== undefined) check(test.expect.success === (test.expect.validation_error.length === 0), p, 'successとvalidation_errorが矛盾しています');
    }
  });
  return document.design_tests;
}

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function simulate(design, actionId, input, screenInputs = {}, buttonId, database) {
  const action = design.actions.get(actionId);
  check(action !== undefined, 'action', `アクションが存在しません: ${actionId}`);
  const bindings = selectBindings(design, action, buttonId);
  const values = initializeFields(design, screenInputs, input);
  const args = Object.fromEntries([...bindings].map(([id, binding]) => [id, resolveReference(binding.ref, values, screenInputs)]));
  const result = { transition: null, process_calls: [], field_values: values, success: true, validation_error: [], messages: [], debug_logs: [], processes: [], executed_steps: [], db_results: {}, db_error: [], return_value: null, action_results: {}, action_error: [] };
  function execute(current, args, bindings, nested = false) {
    const outputs = new Map();
    for (const step of current.steps) {
      if (step.when) {
        const {equals,not_equals,...ref}=step.when;
        const value=resolveReference(ref,{},args,outputs);
        if (Object.hasOwn(step.when,'equals') ? value!==equals : value===not_equals) continue;
      }
      result.executed_steps.push(nested ? `${current.id}.${step.id}` : step.id);
      if (step.type.startsWith('db.')) {
        check(database,step.id,'DB接続がありません。--projectを指定してください');
        const output=database.execute(step,ref=>resolveReference(ref,{},args,outputs));
        outputs.set(step.id,output);
        result.db_results[nested?`${current.id}.${step.id}`:step.id]=output;
      } else if (step.type === 'validation') {
        for (const rule of step.rules) {
          const definition = design.validations.get(rule.validation);
          const value = args[rule.target];
          const matched = definition.condition.operator === 'empty'
            ? isEmpty(value)
            : typeof value === 'number' && Number.isFinite(value);
          if (matched !== definition.condition.expected) {
            result.validation_error.push({ validation: rule.validation, target: rule.target });
            if (step.on_error?.action === 'show_message') {
              result.messages.push(definition.message.template.replaceAll('{label}', bindings.get(rule.target).label ?? rule.target));
            }
          }
        }
        if (result.validation_error.length > 0) {
          result.success = false;
          break;
        }
      } else if (step.type === 'process') {
        result.processes.push(step.action);
        const inputs = resolveArguments(step.inputs ?? {}, args, outputs);
        result.process_calls.push({ action: step.action, inputs });
        const childBindings = new Map(Object.entries(step.inputs ?? {}).map(([id, ref]) =>
          [id, Object.hasOwn(ref, 'input') ? bindings.get(ref.input) : {}]));
        const target = design.actions.get(step.action);
        const returned = execute(target, inputs, childBindings, true);
        if (result.success && !result.transition && target.returnType) {
          outputs.set(step.id, returned);
          result.action_results[nested ? `${current.id}.${step.id}` : step.id] = returned;
        }
        if (!result.success || result.transition) break;
      } else if (step.type === 'transition') {
        result.transition = { target: step.target, inputs: resolveArguments(step.inputs, args, outputs) };
        break;
      } else if (step.type === 'return') {
        const returned = resolveReference(step.value, {}, args, outputs);
        if (!validReturn(returned, current.returnType)) throw new ActionError('SEDA_RETURN_TYPE', `${current.id}: 返り値がreturnsの型と一致しません`);
        return returned;
      } else if (step.type === 'debug') {
        result.debug_logs.push(step.data === undefined ? step.message : `${step.message} ${JSON.stringify(resolveReference(step.data,{},args,outputs))}`);
      } else {
        result.messages.push(step.message);
      }
    }
  }
  try {
    const run=()=>{const returned=execute(action,args,bindings);if(result.success && action.returnType) result.return_value=returned;return result;};
    return database ? database.atomic(run) : run();
  } catch(error) {
    if (!(error instanceof DatabaseError) && !(error instanceof ActionError)) throw error;
    result.success=false;result.transition=null;result.return_value=null;
    (error instanceof ActionError ? result.action_error : result.db_error).push(error.code);
    result.messages=[`${error instanceof ActionError ? 'アクションエラー' : 'DBエラー'}: ${error.message}`];
    return result;
  }
}

export function runTests(designDocument, testsDocument, screenId, catalog, databaseSchema = catalog?.databaseSchema) {
  const design = compileDesign(designDocument, screenId, databaseSchema);
  const tests = validateTests(testsDocument, design);
  return tests.map((test, index) => {
    const database=createDatabase(databaseSchema,{seed:test.database ?? {}});
    try {
      const actual = simulate(design, test.action, test.input, test.screen_inputs, test.button, database);
      if(test.expect.database !== undefined) actual.database=database.snapshot(test.expect.database);
      if (actual.transition && catalog) initializeFields(catalog.get(catalog.routes ? catalog.routes.get(actual.transition.target) : actual.transition.target), actual.transition.inputs);
      const expected = { ...test.expect };
      if (expected.validation_error !== undefined && expected.success === undefined) {
        expected.success = expected.validation_error.length === 0;
      }
      const differences = Object.entries(expected)
        .filter(([key, value]) => !isDeepStrictEqual(value, actual[key]))
        .map(([key, value]) => ({ key, expected: value, actual: actual[key] }));
      return { name: test.name ?? `case ${index + 1}: ${test.action}`, passed: differences.length === 0, differences, actual };
    } finally { database?.close(); }
  });
}

function scalarType(value) {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  throw new DefinitionError('literalは文字列・有限数値・真偽値のみ対応しています');
}
function reference(ref, fields, inputs, path, outputs = new Map()) {
  object(ref,path);
  if (Object.hasOwn(ref,'result')) {
    keys(ref,['result','column'],path);
    const result=outputs.get(ref.result);
    check(result,path,`先行する処理結果が存在しません: ${ref.result}`);
    if(ref.column===undefined) return {...result,ref};
    check(result.type==='object' && result.columns?.has(ref.column),path,`結果カラムが存在しません: ${ref.column}`);
    return {...result.columns.get(ref.column),ref};
  }
  if (Object.hasOwn(ref, 'object')) {
    keys(ref, ['object'], path); object(ref.object, path);
    return {type:'object',kind:'one',columns:new Map(Object.entries(ref.object).map(([id, source]) => [id, reference(source, fields, inputs, path, outputs)])),ref};
  }
  for(const op of ['add','subtract','multiply','divide']) if(Object.hasOwn(ref,op)) {
    keys(ref,[op],path);array(ref[op],path);
    check(ref[op].length===2 && ref[op].every(item=>reference(item,fields,inputs,path,outputs).type==='number'),path,'計算には数値の参照を2つ指定してください');
    return {type:'number',ref};
  }
  keys(ref, ['field', 'input', 'literal'], path);
  check(Object.keys(ref).length === 1, path, '参照元を1つ指定してください');
  if (Object.hasOwn(ref, 'literal')) return { ref, type: ref.literal===null?'null':scalarType(ref.literal) };
  const source = Object.hasOwn(ref, 'field') ? fields.get(ref.field) : inputs.get(ref.input);
  check(source && source.type !== 'button', path, '参照元が存在しません');
  return { ref, type: source.type, label: source.label };
}
function validateArguments(mapping, bindings, path, outputs) {
  object(mapping, path);
  for (const [name, ref] of Object.entries(mapping)) {
    reference(ref, new Map(), bindings, `${path}.inputs.${name}`, outputs);
  }
}
function resolveReference(ref, fields, inputs, outputs = new Map()) {
  if (Object.hasOwn(ref, 'object')) return Object.fromEntries(Object.entries(ref.object).map(([id, source]) => [id, resolveReference(source, fields, inputs, outputs)]));
  if(Object.hasOwn(ref,'result')) {
    if(!outputs.has(ref.result)) throw new DatabaseError('SEDA_RESULT_MISSING',`実行済みの処理結果がありません: ${ref.result}`);
    const result=outputs.get(ref.result);
    return ref.column===undefined ? result : result===null ? null : result[ref.column];
  }
  for(const op of ['add','subtract','multiply','divide']) if(Object.hasOwn(ref,op)) {
    const [a,b]=ref[op].map(item=>resolveReference(item,fields,inputs,outputs));
    const value=op==='add'?a+b:op==='subtract'?a-b:op==='multiply'?a*b:a/b;
    if(typeof a!=='number' || typeof b!=='number' || !Number.isFinite(value)) throw new DatabaseError('SEDA_CALCULATION','計算には有限の数値が必要です（0除算は不可）');
    return value;
  }
  if (Object.hasOwn(ref, 'literal')) return ref.literal;
  return Object.hasOwn(ref, 'field') ? fields[ref.field] : inputs[ref.input];
}
function resolveArguments(mapping, args, outputs) {
  return Object.fromEntries(Object.entries(mapping).map(([id, ref]) => [id, resolveReference(ref, {}, args, outputs)]));
}
export function initializeFields(design, received = {}, edits = {}) {
  object(received, 'screen_inputs'); object(edits, 'input');
  for (const id of Object.keys(received)) check(design.parameters.has(id), 'screen_inputs', `未定義の受信引数: ${id}`);
  for (const parameter of design.parameters.values()) {
    const value = received[parameter.id];
    check(!parameter.required || value !== undefined && value !== null, 'screen_inputs', `必須の受信引数: ${parameter.id}`);
    if (value !== undefined) check(scalarType(value) === parameter.type, 'screen_inputs', `型が不一致: ${parameter.id}`);
  }
  const values = Object.fromEntries([...design.fields.values()].filter(f => f.source && Object.hasOwn(received, f.source.input)).map(f => [f.id, received[f.source.input]]));
  for (const [id, value] of Object.entries(edits)) {
    const field = design.fields.get(id);
    check(field && field.type !== 'button' && !field.readonly, 'input', `編集できない項目: ${id}`);
    values[id] = value;
  }
  return values;
}
export function validateTransitions(catalog) {
  for (const design of catalog.values()) for (const action of design.actions.values()) for (const step of action.steps) {
    if (step.type !== 'transition') continue;
    const target = catalog.get(catalog.routes ? catalog.routes.get(step.target) : step.target);
    check(target, design.screenId, `遷移先が存在しません: ${step.target}`);
    for (const [id, ref] of Object.entries(step.inputs)) {
      const param = target.parameters.get(id);
      check(param, step.id, `遷移先に引数が存在しません: ${id}`);
      check(reference(ref, new Map(), action.bindings, step.id, action.stepScopes.get(step.id)).type === param.type, step.id, `遷移引数の型が不一致: ${id}`);
    }
    for (const param of target.parameters.values()) check(!param.required || Object.hasOwn(step.inputs, param.id), step.id, `必須の遷移引数: ${param.id}`);
  }
}

function selectBindings(design, action, buttonId) {
  if (buttonId !== undefined) {
    const button = design.fields.get(buttonId);
    check(button?.type === 'button' && button.action === action.id, 'button', `アクションと一致するボタンがありません: ${buttonId}`);
    return button.bindings;
  }
  if (!action.typed) return action.bindings;
  const callers = [...design.fields.values()].filter(field => field.type === 'button' && field.action === action.id);
  check(callers.length === 1, action.id, '呼び出し元を一意に決定できません。テストのbuttonを指定してください');
  return callers[0].bindings;
}
