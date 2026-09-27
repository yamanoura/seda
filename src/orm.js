import {DefinitionError} from './errors.js';

const check = (ok, path, message) => { if (!ok) throw new DefinitionError(`${path}: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Prisma Client風の公開記法を、既存のDB実行形式へ変換する。
export function normalizeOrmStep(step, path, schema) {
  check(schema, path, 'DB操作にはproject.yamlのdatabase_fileが必要です');
  const operations = {
    findUnique: ['where', 'select'], findMany: ['where', 'select', 'orderBy', 'take'],
    create: ['data', 'select'], update: ['where', 'data', 'select'], updateMany: ['where', 'data'],
  };
  const allowed = operations[step.operation];
  check(Object.hasOwn(operations, step.operation), path, `未対応のDB操作: ${step.operation}`);
  for (const key of Object.keys(step)) check(['id', 'type', 'model', 'operation', 'when', ...allowed].includes(key), path, `未対応のキー: ${key}`);
  const table = schema.tables.get(step.model);
  check(table, path, `モデルが存在しません: ${step.model}`);
  let columns;
  if (step.select !== undefined) {
    check(object(step.select) && Object.keys(step.select).length > 0, path, 'selectには取得項目を指定してください');
    for (const [key, value] of Object.entries(step.select)) check(table.columns.has(key) && value === true, path, `selectは定義済みのカラムにtrueを指定してください: ${key}`);
    columns = Object.keys(step.select);
  }
  if (['findUnique', 'update'].includes(step.operation)) {
    check(object(step.where) && Object.keys(step.where).some(key => {
      const column = table.columns.get(key);
      return column && (column.primary_key || column.unique) && step.where[key]?.literal !== null;
    }), path, 'whereには主キーまたはuniqueカラムを指定してください（nullは不可）');
  }
  let order;
  if (step.orderBy !== undefined) {
    const orders = Array.isArray(step.orderBy) ? step.orderBy : [step.orderBy];
    check(orders.length > 0, path, 'orderByは1件以上必要です');
    order = orders.map(item => {
      check(object(item) && Object.keys(item).length === 1, path, 'orderByの各項目にはカラムを1つ指定してください');
      const [column, direction] = Object.entries(item)[0];
      check(table.columns.has(column) && ['asc', 'desc'].includes(direction), path, 'orderByが不正です');
      return {column, direction};
    });
  }
  const operation = step.operation;
  const normalized = {id: step.id, type: operation.startsWith('find') ? 'db.select' : operation === 'create' ? 'db.insert' : 'db.update', table: step.model};
  if (step.when !== undefined) normalized.when = step.when;
  if (step.where !== undefined) normalized.where = step.where;
  if (operation.startsWith('find')) {
    normalized.mode = operation === 'findMany' ? 'many' : 'one';
    if (columns) normalized.columns = columns;
    if (order) normalized.order_by = order;
    if (step.take !== undefined) normalized.limit = step.take;
  } else normalized.values = step.data;
  for (const key of Object.keys(step)) delete step[key];
  Object.assign(step, normalized);
  return {operation, columns: columns ?? [...table.columns.keys()]};
}
