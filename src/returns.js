import {DefinitionError} from './errors.js';
import {valueType} from './database.js';

const check = (ok, path, message) => { if (!ok) throw new DefinitionError(`${path}: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function recordType(table, columns = [...table.columns.keys()], nullable = false) {
  return {type: 'object', kind: 'one', nullable, columns: new Map(columns.map(id => [id, {
    type: valueType(table.columns.get(id)), nullable: !!table.columns.get(id).nullable,
  }]))};
}
export function compileReturn(def, schema, path) {
  check(object(def), path, '返り値の型はマッピングで定義してください');
  const allowed = def.model !== undefined ? ['model', 'many', 'nullable', 'select']
    : def.type === 'object' ? ['type', 'properties', 'nullable']
    : def.type === 'array' ? ['type', 'items', 'nullable'] : ['type', 'nullable'];
  for (const key of Object.keys(def)) check(allowed.includes(key), path, `未対応のキー: ${key}`);
  check(def.nullable === undefined || typeof def.nullable === 'boolean', path, 'nullableは真偽値です');
  let result;
  if (def.model !== undefined) {
    const table = schema?.tables.get(def.model);
    check(table, path, `返り値のモデルが存在しません: ${def.model}`);
    check(def.many === undefined || typeof def.many === 'boolean', path, 'manyは真偽値です');
    if (def.select !== undefined) check(object(def.select) && Object.keys(def.select).length > 0 && Object.entries(def.select).every(([id, v]) => table.columns.has(id) && v === true), path, 'selectには定義済みのカラムとtrueを指定してください');
    result = recordType(table, def.select === undefined ? undefined : Object.keys(def.select));
    if (def.many) result = {type: 'array', kind: 'many', items: result};
  } else if (def.type === 'object') {
    check(object(def.properties) && Object.keys(def.properties).length > 0, path, 'propertiesに返却項目の型を指定してください');
    result = {type: 'object', kind: 'one', columns: new Map(Object.entries(def.properties).map(([id, d]) => [id, compileReturn(d, schema, `${path}.${id}`)]))};
  } else if (def.type === 'array') {
    result = {type: 'array', kind: 'many', items: compileReturn(def.items, schema, `${path}.items`)};
  } else {
    check(['text', 'number', 'boolean'].includes(def.type), path, `未対応の返り値型: ${def.type}`);
    result = {type: def.type};
  }
  return {...result, nullable: !!def.nullable};
}
// nullになり得る取得結果の扱いは、whenでの分岐を許容するため実行時にも検証する。
export function assignable(source, target) {
  if (source.type === 'null') return !!target.nullable;
  if (source.type !== target.type) return false;
  if (target.type === 'object') return !!source.columns && source.columns.size === target.columns.size && [...target.columns].every(([id, t]) => source.columns.has(id) && assignable(source.columns.get(id), t));
  if (target.type === 'array') return !!source.items && assignable(source.items, target.items);
  return true;
}
export function validReturn(value, type) {
  if (value === null) return type.nullable;
  if (type.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type.type === 'text') return typeof value === 'string';
  if (type.type === 'boolean') return typeof value === 'boolean';
  if (type.type === 'array') return Array.isArray(value) && value.every(v => validReturn(v, type.items));
  return object(value) && Object.keys(value).length === type.columns.size && [...type.columns].every(([id, t]) => Object.hasOwn(value, id) && validReturn(value[id], t));
}
