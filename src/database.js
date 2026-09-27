import SQLite from 'better-sqlite3';
import {DefinitionError, DatabaseError} from './errors.js';

const fail = (path, message) => { throw new DefinitionError(`${path}: ${message}`); };
export const dbObject = (v, path) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'マッピングが必要です');
};
function keys(value, allowed, path) {
  dbObject(value,path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `未対応のキー: ${key}`);
}
function identifier(id, path) {
  if (typeof id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || /^(sqlite_|_seda_)/i.test(id)) fail(path, `不正な識別子: ${id}`);
}
const quote = id => `"${id}"`;
export const valueType = column => ['integer','number'].includes(column.type) ? 'number' : column.type;
export function checkValue(value,column,path) {
  if (value === null && column.nullable && !column.primary_key) return;
  const valid = column.type === 'integer' ? Number.isSafeInteger(value)
    : column.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : column.type === 'boolean' ? typeof value === 'boolean'
    : typeof value === 'string';
  if (!valid) fail(path, `${column.type}${column.nullable?' またはnull':''}が必要です`);
}
const encode = value => typeof value === 'boolean' ? Number(value) : value;
const sqlLiteral = value => value === null ? 'NULL' : typeof value === 'string' ? `'${value.replaceAll("'","''")}'` : String(encode(value));

export function compileDatabase(document) {
  keys(document,['database'],'database_file');
  const def=document.database;
  keys(def,['engine','tables','seed'],'database');
  if (def.engine !== undefined && def.engine !== 'sqlite') fail('database.engine','sqliteのみ対応しています');
  if (!Array.isArray(def.tables) || !def.tables.length) fail('database.tables','1件以上必要です');
  const tables=new Map();
  for(const table of def.tables) {
    keys(table,['id','columns'],'database.tables');identifier(table.id,'table');
    if([...tables.keys()].some(id=>id.toLowerCase()===table.id.toLowerCase())) fail('table',`重複: ${table.id}`);
    if(!Array.isArray(table.columns)||!table.columns.length) fail(table.id,'columnsに1件以上必要です');
    const columns=new Map();
    for(const column of table.columns) {
      keys(column,['id','type','primary_key','generated','nullable','unique','default','references'],table.id);identifier(column.id,table.id);
      if([...columns.keys()].some(id=>id.toLowerCase()===column.id.toLowerCase())) fail(table.id,`カラム重複: ${column.id}`);
      if(!['text','integer','number','boolean'].includes(column.type)) fail(table.id,`未対応の型: ${column.type}`);
      for(const flag of ['primary_key','generated','nullable','unique']) if(column[flag]!==undefined && typeof column[flag]!=='boolean') fail(table.id,`${flag}には真偽値が必要です`);
      if(column.primary_key && column.nullable) fail(table.id,'主キーはnullableにできません');
      if(column.generated && (!column.primary_key || column.type!=='integer')) fail(table.id,'generatedはinteger主キー専用です');
      if(Object.hasOwn(column,'default')) {
        if(column.generated) fail(table.id,'generatedとdefaultは併用できません');
        checkValue(column.default,column,`${table.id}.${column.id}.default`);
      }
      columns.set(column.id,{...column});
    }
    if([...columns.values()].filter(c=>c.primary_key).length!==1) fail(table.id,'主キーを1つ定義してください');
    tables.set(table.id,{id:table.id,columns});
  }
  for(const table of tables.values()) {
    const definitions=[];
    for(const c of table.columns.values()) {
      if(c.references!==undefined) {
        keys(c.references,['table','column'],`${table.id}.${c.id}.references`);
        const ref=tables.get(c.references.table)?.columns.get(c.references.column);
        if(!ref || (!ref.primary_key && !ref.unique) || ref.type!==c.type) fail(table.id,`外部キーの参照先・型が不正: ${c.id}`);
      }
      let sql=`${quote(c.id)} ${{text:'TEXT',integer:'INTEGER',number:'REAL',boolean:'INTEGER'}[c.type]}`;
      if(c.primary_key) sql+=' PRIMARY KEY';
      if(c.generated) sql+=' AUTOINCREMENT';
      if(!c.nullable) sql+=' NOT NULL';
      if(c.unique) sql+=' UNIQUE';
      if(Object.hasOwn(c,'default')) sql+=` DEFAULT ${sqlLiteral(c.default)}`;
      if(c.type==='boolean') sql+=` CHECK (${quote(c.id)} IN (0, 1))`;
      if(c.references) sql+=` REFERENCES ${quote(c.references.table)} (${quote(c.references.column)})`;
      definitions.push(sql);
    }
    table.sql=`CREATE TABLE ${quote(table.id)} (${definitions.join(', ')}) STRICT`;
  }
  const schema={tables,seed:structuredClone(def.seed ?? {})};
  validateRows(schema,schema.seed,{complete:true});
  return schema;
}

export function validateRows(schema,data,{complete=false}={}) {
  if(!schema) fail('database','project.yamlにdatabase_fileが必要です');
  dbObject(data,'database');
  for(const [id,rows] of Object.entries(data)) {
    const table=schema.tables.get(id);
    if(!table) fail('database',`テーブルが存在しません: ${id}`);
    if(!Array.isArray(rows)) fail(id,'行の配列が必要です');
    if(!complete && rows.length) {
      const expected=Object.keys(rows[0] ?? {}).sort().join(',');
      if(!expected || rows.some(row=>!row || Object.keys(row).sort().join(',')!==expected)) fail(id,'期待値の各行には同じ比較カラムを1つ以上指定してください');
    }
    for(const row of rows) {
      dbObject(row,id);
      for(const [key,value] of Object.entries(row)) {
        const c=table.columns.get(key);if(!c) fail(id,`カラムが存在しません: ${key}`);
        checkValue(value,c,`${id}.${key}`);
      }
      if(complete) for(const c of table.columns.values()) if(!c.nullable && !c.generated && !Object.hasOwn(c,'default') && !Object.hasOwn(row,c.id)) fail(id,`必須カラムが不足: ${c.id}`);
    }
  }
}
class Rejected extends Error { constructor(result){super();this.result=result;} }
export function createDatabase(schema,{file=':memory:',seed={}}={}) {
  if(!schema) {
    if(file!==':memory:' || Object.keys(seed).length) fail('database','project.yamlにdatabase_fileが必要です');
    return undefined;
  }
  const initial={...schema.seed,...seed};
  validateRows(schema,initial,{complete:true});
  let db;
  try {
    db=new SQLite(file);
    db.pragma('foreign_keys = ON');
    const fingerprint=JSON.stringify([...schema.tables.values()].map(t=>t.sql));
    db.transaction(()=>{
      const existing=db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();
      if(existing.length) {
        if(!existing.some(t=>t.name==='_seda_schema')) fail('database','sedaが作成したDBではありません');
        const saved=db.prepare('SELECT definition FROM _seda_schema WHERE id=1').get();
        if(saved?.definition!==fingerprint || existing.length!==schema.tables.size+1 || [...schema.tables.values()].some(t=>existing.find(e=>e.name===t.id)?.sql!==t.sql)) fail('database','既存DBとテーブル定義が一致しません。別のDBファイルを指定してください');
        return;
      }
      db.exec('CREATE TABLE _seda_schema (id INTEGER PRIMARY KEY, definition TEXT NOT NULL)');
      for(const table of schema.tables.values()) db.exec(table.sql);
      db.prepare('INSERT INTO _seda_schema VALUES (1, ?)').run(fingerprint);
      db.pragma('defer_foreign_keys = ON');
      for(const [id,rows] of Object.entries(initial)) for(const row of rows) insert(id,row);
    }).immediate();
  } catch(error) {
    db?.close();
    if(error instanceof DefinitionError) throw error;
    throw new DefinitionError(`database: ${error.message}`);
  }
  function insert(table,values) {
    const names=Object.keys(values);
    return db.prepare(names.length ? `INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(()=>'?').join(',')})` : `INSERT INTO ${quote(table)} DEFAULT VALUES`).run(...Object.values(values).map(encode));
  }
  const decode=(table,row)=>row===undefined?null:Object.fromEntries(Object.entries(row).map(([k,v])=>[k,table.columns.get(k)?.type==='boolean' && v!==null ? Boolean(v) : v]));
  return {
    schema, file,
    close(){if(db.open) db.close();},
    atomic(fn){
      try {return db.transaction(()=>{const result=fn();if(result?.success===false) throw new Rejected(result);return result;})();}
      catch(error){if(error instanceof Rejected)return error.result;throw error;}
    },
    execute(step,resolveValue) {
      const table=schema.tables.get(step.table);
      try {
        const where=Object.fromEntries(Object.entries(step.where??{}).map(([k,ref])=>[k,resolveValue(ref)]));
        for(const [key,value] of Object.entries(where)) if(value!==null) checkValue(value,table.columns.get(key),`${step.table}.${key}`);
        if (['findUnique','update'].includes(step.ormOperation) && !Object.entries(where).some(([key,value]) => value !== null && (table.columns.get(key).primary_key || table.columns.get(key).unique))) throw new DatabaseError('SEDA_UNIQUE_WHERE', '主キーまたはuniqueカラムにnull以外の値が必要です');
        const predicate=Object.keys(where).length ? ' WHERE '+Object.keys(where).map(k=>`${quote(k)} IS ?`).join(' AND ') : '';
        if(step.type==='db.select') {
          const columns=step.columns ?? [...table.columns.keys()];
          const order=step.order_by ?? [{column:[...table.columns.values()].find(c=>c.primary_key).id,direction:'asc'}];
          const sql=`SELECT ${columns.map(quote).join(',')} FROM ${quote(table.id)}${predicate} ORDER BY ${order.map(o=>`${quote(o.column)} ${(o.direction??'asc').toUpperCase()}`).join(',')} LIMIT ?`;
          const rows=db.prepare(sql).all(...Object.values(where).map(encode),step.mode==='many'?(step.limit??1000):2).map(row=>decode(table,row));
          if(step.mode==='many') return rows;
          if(rows.length>1) throw new DatabaseError('SEDA_MULTIPLE_ROWS',`${step.id}: 取得結果が複数行です`);
          return rows[0]??null;
        }
        const values=Object.fromEntries(Object.entries(step.values).map(([k,ref])=>[k,resolveValue(ref)]));
        for(const [key,value] of Object.entries(values)) checkValue(value,table.columns.get(key),`${step.table}.${key}`);
        if (step.ormOperation === 'create') {
          const names = Object.keys(values);
          const sql = names.length ? `INSERT INTO ${quote(table.id)} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})` : `INSERT INTO ${quote(table.id)} DEFAULT VALUES`;
          return decode(table, db.prepare(`${sql} RETURNING ${step.returnColumns.map(quote).join(',')}`).get(...Object.values(values).map(encode)));
        }
        if(step.type==='db.insert') {
          const info=insert(table.id,values);
          if(!Number.isSafeInteger(Number(info.lastInsertRowid))) throw new DatabaseError('SEDA_INTEGER_RANGE','生成IDが安全に扱える整数の範囲を超えました');
          return {changes:info.changes,last_insert_id:Number(info.lastInsertRowid)};
        }
        const sql=`UPDATE ${quote(table.id)} SET ${Object.keys(values).map(k=>`${quote(k)} = ?`).join(',')}${predicate}`;
        const params = [...Object.values(values).map(encode), ...Object.values(where).map(encode)];
        if (step.ormOperation === 'update') {
          const row = db.prepare(`${sql} RETURNING ${step.returnColumns.map(quote).join(',')}`).get(...params);
          if (!row) throw new DatabaseError('SEDA_RECORD_NOT_FOUND', `${step.id}: 更新対象が存在しません`);
          return decode(table, row);
        }
        const changes = db.prepare(sql).run(...params).changes;
        return step.ormOperation === 'updateMany' ? {count: changes} : {changes};
      } catch(error) {
        if(error instanceof DatabaseError)throw error;
        throw new DatabaseError(error.code ?? 'SEDA_DB_VALUE',`${step.id}: ${error.message}`);
      }
    },
    snapshot(expected) {
      validateRows(schema,expected);
      return Object.fromEntries(Object.entries(expected).map(([id,rows])=>{
        const table=schema.tables.get(id);
        // 指定したテーブルの全行を比較。各行の省略カラムは比較対象外。
        const columns=rows.length?[...new Set(rows.flatMap(row=>Object.keys(row)))]:[...table.columns.keys()];
        const pk=[...table.columns.values()].find(c=>c.primary_key).id;
        const actual=db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(id)} ORDER BY ${quote(pk)}`).all().map(row=>decode(table,row));
        return [id,actual];
      }));
    },
  };
}
