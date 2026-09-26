import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

export class DefinitionError extends Error {}

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

export function compileDesign(document, screenId) {
  object(document, 'design');
  const ids = Object.keys(document);
  if (screenId === undefined) {
    check(ids.length === 1, 'design', '画面が複数ある場合は --screen を指定してください');
    screenId = ids[0];
  }
  check(Object.hasOwn(document, screenId), 'design', `画面が存在しません: ${screenId}`);
  const screen = document[screenId];
  keys(screen, ['description', 'fields', 'actions', 'validations'], screenId);
  if (screen.description !== undefined) string(screen.description, `${screenId}.description`);
  const fields = indexed(screen.fields, `${screenId}.fields`, ['id', 'type', 'label', 'trigger', 'action'], true);
  const validations = indexed(screen.validations, `${screenId}.validations`, ['id', 'condition', 'message']);
  const actions = indexed(screen.actions, `${screenId}.actions`, ['id', 'inputs', 'steps'], true);
  for (const field of fields.values()) {
    const p = `${screenId}.fields.${field.id}`;
    check(['text', 'number', 'button'].includes(field.type), p, `未対応の項目型: ${field.type}`);
    string(field.label, `${p}.label`);
    if (field.type === 'button') {
      check(field.trigger === 'click', `${p}.trigger`, 'click のみ対応しています');
      check(actions.has(field.action), `${p}.action`, `アクションが存在しません: ${field.action}`);
    } else {
      check(field.trigger === undefined && field.action === undefined, p, 'trigger/action はbutton専用です');
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
    array(action.inputs, `${p}.inputs`);
    check(new Set(action.inputs).size === action.inputs.length, p, 'inputsが重複しています');
    for (const id of action.inputs) {
      check(fields.has(id) && fields.get(id).type !== 'button', p, `入力項目が存在しません: ${id}`);
    }
    const steps = indexed(action.steps, `${p}.steps`, ['id', 'type', 'rules', 'on_error', 'action', 'message'], true);
    for (const step of steps.values()) {
      const s = `${p}.steps.${step.id}`;
      check(['validation', 'process', 'message'].includes(step.type), s, `未対応のステップ型: ${step.type}`);
      if (step.type === 'validation') {
        keys(step, ['id', 'type', 'rules', 'on_error'], s);
        array(step.rules, `${s}.rules`, true);
        const seen = new Set();
        step.rules.forEach((rule, i) => {
          const r = `${s}.rules[${i}]`;
          keys(rule, ['validation', 'target'], r);
          check(validations.has(rule.validation), r, `検証定義が存在しません: ${rule.validation}`);
          check(action.inputs.includes(rule.target), r, `対象がinputsにありません: ${rule.target}`);
          const id = JSON.stringify([rule.validation, rule.target]);
          check(!seen.has(id), r, 'ルールが重複しています');
          seen.add(id);
        });
        if (step.on_error !== undefined) {
          keys(step.on_error, ['action'], `${s}.on_error`);
          check(step.on_error.action === 'show_message', s, 'on_errorはshow_messageのみ対応しています');
        }
      } else if (step.type === 'process') {
        keys(step, ['id', 'type', 'action'], s);
        string(step.action, `${s}.action`);
      } else {
        keys(step, ['id', 'type', 'message'], s);
        string(step.message, `${s}.message`);
      }
    }
  }
  return { screenId, fields, validations, actions };
}

const resultKeys = ['success', 'validation_error', 'messages', 'processes', 'executed_steps'];

export function validateTests(document, design) {
  keys(document, ['design_tests'], 'tests');
  array(document.design_tests, 'design_tests', true);
  document.design_tests.forEach((test, i) => {
    const p = `design_tests[${i}]`;
    keys(test, ['name', 'action', 'input', 'expect'], p);
    if (test.name !== undefined) string(test.name, `${p}.name`);
    check(design.actions.has(test.action), `${p}.action`, `アクションが存在しません: ${test.action}`);
    const action = design.actions.get(test.action);
    object(test.input, `${p}.input`);
    for (const [key, value] of Object.entries(test.input)) {
      check(action.inputs.includes(key), `${p}.input.${key}`, 'アクションの入力項目ではありません');
      check(value === null || ['string', 'number', 'boolean'].includes(typeof value), `${p}.input.${key}`, 'スカラー値が必要です');
    }
    keys(test.expect, resultKeys, `${p}.expect`);
    check(Object.keys(test.expect).length > 0, `${p}.expect`, '期待値が空です');
    for (const [key, value] of Object.entries(test.expect)) {
      if (key === 'success') check(typeof value === 'boolean', `${p}.expect.success`, '真偽値が必要です');
      else {
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
      const available = new Set(action.steps.flatMap(s => (s.rules ?? []).map(r => JSON.stringify([r.validation, r.target]))));
      for (const ref of test.expect.validation_error) check(available.has(JSON.stringify([ref.validation, ref.target])), `${p}.expect.validation_error`, `ルール参照が存在しません: ${JSON.stringify(ref)}`);
      if (test.expect.success !== undefined) check(test.expect.success === (test.expect.validation_error.length === 0), p, 'successとvalidation_errorが矛盾しています');
    }
  });
  return document.design_tests;
}

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function simulate(design, actionId, input) {
  const action = design.actions.get(actionId);
  check(action !== undefined, 'action', `アクションが存在しません: ${actionId}`);
  const result = { success: true, validation_error: [], messages: [], processes: [], executed_steps: [] };
  for (const step of action.steps) {
    result.executed_steps.push(step.id);
    if (step.type === 'validation') {
      for (const rule of step.rules) {
        const definition = design.validations.get(rule.validation);
        const value = input[rule.target];
        const matched = definition.condition.operator === 'empty'
          ? isEmpty(value)
          : typeof value === 'number' && Number.isFinite(value);
        if (matched !== definition.condition.expected) {
          result.validation_error.push({ validation: rule.validation, target: rule.target });
          if (step.on_error?.action === 'show_message') {
            result.messages.push(definition.message.template.replaceAll('{label}', design.fields.get(rule.target).label));
          }
        }
      }
      if (result.validation_error.length > 0) {
        result.success = false;
        break;
      }
    } else if (step.type === 'process') {
      result.processes.push(step.action);
    } else {
      result.messages.push(step.message);
    }
  }
  return result;
}

export function runTests(designDocument, testsDocument, screenId) {
  const design = compileDesign(designDocument, screenId);
  const tests = validateTests(testsDocument, design);
  return tests.map((test, index) => {
    const actual = simulate(design, test.action, test.input);
    const expected = { ...test.expect };
    if (expected.validation_error !== undefined && expected.success === undefined) {
      expected.success = expected.validation_error.length === 0;
    }
    const differences = Object.entries(expected)
      .filter(([key, value]) => !isDeepStrictEqual(value, actual[key]))
      .map(([key, value]) => ({ key, expected: value, actual: actual[key] }));
    return { name: test.name ?? `case ${index + 1}: ${test.action}`, passed: differences.length === 0, differences, actual };
  });
}
