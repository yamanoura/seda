import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import SQLite from 'better-sqlite3';
import {stringify,parse} from 'yaml';
import {compileDatabase,createDatabase} from '../src/database.js';
import {readYaml,compileDesign,runTests,simulate} from '../src/verifier.js';
import {loadApplication} from '../src/application.js';
import {runProject} from '../src/project.js';
import {createFlowSession} from '../src/interact.js';
import {previewProject} from '../src/preview.js';
const base='examples/sqlite';
const schemaDocument=await readYaml(`${base}/database.yaml`);
const schema=compileDatabase(schemaDocument);
const spec=await readYaml('test/fixtures/legacy-db.spec.yaml');
const tests=await readYaml(`${base}/features/screen02/screen02.test.yaml`);
const user={name:'山田',age:30};
const execute=(d,db,name='山田')=>simulate(compileDesign(d,'screen02',schema),'confirm_entry',{}, {name,age:30},undefined,db);
const rows=(db)=>db.snapshot({users:[{id:1,name:'x',age:1,plan_id:1,credit:1}],plans:[{id:1,registrations:0}]});
async function temporary(fn){const dir=await mkdtemp(join(tmpdir(),'seda-db-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('YAMLで参照・作成・更新を行い、ケースごとに初期状態へ戻す',async()=>{
  const legacyTests=structuredClone(tests);
  // 旧サンプルは返り値を宣言しない。DBへの副作用とエラーの互換性を検証する。
  for (const t of legacyTests.design_tests) delete t.expect.action_results;
  assert.ok(runTests(spec,legacyTests,'screen02',undefined,schema).every(r=>r.passed));
  assert.ok((await runProject(`${base}/project.yaml`)).every(r=>r.passed));
});

test('後続DBエラーと検証エラーはネストした呼び出しの書き込みもロールバックする',()=>{
  for(const kind of ['unique','validation','calculation']) {
    const d=structuredClone(spec), action=d.screen02.actions.find(a=>a.id==='create_user');
    if(kind==='unique') action.steps.splice(3,0,{...structuredClone(action.steps[1]),id:'duplicate'});
    if(kind==='validation') {
      d.screen02.validations=[{id:'fail',condition:{operator:'empty',expected:true},message:{template:'失敗'}}];
      action.steps.splice(3,0,{id:'fail',type:'validation',rules:[{validation:'fail',target:'name'}],on_error:{action:'show_message'}});
    }
    if(kind==='calculation') action.steps[2].values.registrations={divide:[{literal:1},{literal:0}]};
    const db=createDatabase(schema);
    try {
      const result=execute(d,db);
      assert.equal(result.success,false,kind);assert.equal(result.transition,null);
      assert.deepEqual(db.snapshot({users:[],plans:[{id:1,registrations:0}]}),{users:[],plans:[{id:1,registrations:0}]});
    }finally{db.close();}
  }
});

test('値はSQLへバインドし、引用符やSQL風文字列もデータとして保存する',()=>{
  const db=createDatabase(schema);
  try {
    const name="'; DROP TABLE users; --";
    assert.equal(execute(spec,db,name).success,true);
    assert.equal(rows(db).users[0].name,name);
    assert.equal(rows(db).plans[0].registrations,1);
  } finally {db.close();}
});

test('DB定義とDBステップの参照切れ・型違い・無条件更新を静的に拒否する',()=>{
  for(const mutate of [
    d=>{d.screen02.actions[1].steps[0].table='missing';},
    d=>{d.screen02.actions[1].steps[0].where={missing:{literal:1}};},
    d=>{d.screen02.actions[1].steps[1].values.name={literal:123};},
    d=>{d.screen02.actions[1].steps[1].values.credit={result:'later',column:'id'};},
    d=>{d.screen02.actions[1].steps[1].values.credit={result:'plan',column:'missing'};},
    d=>{d.screen02.actions[1].steps[0].mode='many';},
    d=>{delete d.screen02.actions[1].steps[1].values.name;},
    d=>{d.screen02.actions[1].steps[2].where={};},
  ]) {const d=structuredClone(spec);mutate(d);assert.throws(()=>compileDesign(d,'screen02',schema));}
  assert.throws(()=>compileDesign(spec),/database_file/);
  for(const mutate of [
    d=>{d.database.tables.push(structuredClone(d.database.tables[0]));},
    d=>{d.database.tables[0].id='x; DROP TABLE users';},
    d=>{d.database.tables[1].columns[3].references.table='missing';},
    d=>{d.database.tables[0].columns[0].generated='true';},
    d=>{d.database.seed.plans[0].id='1';},
  ]) {const d=structuredClone(schemaDocument);mutate(d);assert.throws(()=>compileDatabase(d));}
});

test('外部キー・非null・整数の制約を実行時にも適用する',()=>{
  for(const [ref,code] of [[{literal:999},'SQLITE_CONSTRAINT_FOREIGNKEY'],[{result:'plan',column:'id'},'SEDA_DB_VALUE']]) {
    const d=structuredClone(spec);d.screen02.actions[1].steps[1].values.plan_id=ref;
    const db=createDatabase(schema,{seed:code==='SEDA_DB_VALUE'?{plans:[]}:{}});
    try {const r=execute(d,db);assert.equal(r.success,false);assert.deepEqual(r.db_error,[code]);assert.deepEqual(db.snapshot({users:[]}),{users:[]});}finally{db.close();}
  }
  const db=createDatabase(schema);
  try {const r=simulate(compileDesign(spec,'screen02',schema),'confirm_entry',{}, {name:'山田',age:1.5},undefined,db);assert.equal(r.success,false);}finally{db.close();}
});

test('oneの複数件と条件付きスキップした結果の参照を拒否する',()=>{
  for(const kind of ['many','skipped']) {
    const d=structuredClone(spec);
    if(kind==='many') delete d.screen02.actions[1].steps[0].where;
    else d.screen02.actions[1].steps[0].when={input:'name',equals:'別人'};
    const db=createDatabase(schema,{seed:{plans:[{id:1,name:'A',initial_credit:1},{id:2,name:'B',initial_credit:2}]}});
    try {const r=execute(d,db);assert.deepEqual(r.db_error,[kind==='many'?'SEDA_MULTIPLE_ROWS':'SEDA_RESULT_MISSING']);}finally{db.close();}
  }
});

test('条件付き取得結果・manyの順序・boolean・null・デフォルトを扱う',()=>{
  const definition=compileDatabase({database:{tables:[{id:'items',columns:[{id:'id',type:'integer',primary_key:true,generated:true},{id:'active',type:'boolean',default:true},{id:'note',type:'text',nullable:true}]}],seed:{items:[{note:null},{active:false,note:'B'}]}}});
  const db=createDatabase(definition);
  try {
    const result=db.execute({id:'list',type:'db.select',table:'items',mode:'many',order_by:[{column:'id',direction:'desc'}],limit:1},ref=>ref.literal);
    assert.deepEqual(result,[{id:2,active:false,note:'B'}]);
    assert.deepEqual(db.execute({id:'lookup',type:'db.select',table:'items',where:{note:{literal:null}}},ref=>ref.literal),{id:1,active:true,note:null});
  }finally{db.close();}
});

test('interactは遷移とリセットを越えてDBを共有し、別セッションとは分離する',async()=>{
  const screens=await loadApplication(`${base}/project.yaml`);
  const session=createFlowSession(screens),other=createFlowSession(screens);
  try {
    session.set('name','山田');session.set('age','30');session.press('add_button');
    assert.equal(session.press('confirm_button').success,true);
    assert.equal(session.path,'/');assert.match(session.entryFeedback.debug_logs.join(''),/山田/);
    session.reset();assert.match(session.entryFeedback.debug_logs.join(''),/山田/);
    assert.doesNotMatch(other.entryFeedback.debug_logs.join(''),/山田/);
  }finally{session.close();other.close();}
});

test('ファイルDBは再起動後も保持し、seedを再投入せず、verifyとpreviewは変更しない',async()=>{
  await temporary(async dir=>{
    const file=join(dir,'data.sqlite'),screens=await loadApplication(`${base}/project.yaml`);
    const first=createFlowSession(screens,{dbFile:file});
    first.set('name','山田');first.set('age','30');first.press('add_button');first.press('confirm_button');first.close();
    const second=createFlowSession(screens,{dbFile:file});
    assert.match(second.entryFeedback.debug_logs.join(''),/山田/);second.close();
    const before=await readFile(file);
    await runProject(`${base}/project.yaml`);await previewProject(`${base}/project.yaml`);
    assert.deepEqual(await readFile(file),before);
    const db=createDatabase(schema,{file});try{assert.equal(rows(db).users.length,1);assert.equal(rows(db).plans[0].registrations,1);}finally{db.close();}
    const changed=structuredClone(schemaDocument);changed.database.tables[1].columns[2].type='text';
    assert.throws(()=>createDatabase(compileDatabase(changed),{file}),/一致しません/);
    const raw=new SQLite(file);raw.exec('ALTER TABLE users ADD COLUMN extra TEXT');raw.close();
    assert.throws(()=>createDatabase(schema,{file}),/一致しません/);
  });
});

test('共通処理からのDB操作と後続のルート失敗も同一操作として取り消す',async()=>{
  await temporary(async dir=>{
    await cp(base,dir,{recursive:true});
    const file=join(dir,'app.yaml'), app=parse(await readFile(file,'utf8'));
    app.app.actions[0].steps.push({id:'only_confirm',type:'db.insert',table:'users',when:{input:'path',equals:'/confirm'},values:{name:{literal:'共通作成'},age:{literal:1},plan_id:{literal:999},credit:{literal:1}}});
    await writeFile(file,stringify(app));
    const screens=await loadApplication(join(dir,'project.yaml'));
    const db=createDatabase(screens.databaseSchema),session=createFlowSession(screens,{database:db});
    try{
      session.set('name','山田');session.set('age','30');
      assert.throws(()=>session.press('add_button'),/共通処理/);
      assert.equal(session.path,'/');assert.deepEqual(db.snapshot({users:[]}),{users:[]});
    }finally{session.close();db.close();}
  });
});

test('CLIで永続化し、verifyの永続DB指定は拒否する',async()=>{
  await temporary(async dir=>{
    const file=join(dir,'cli.sqlite');
    const cli=(args,input='q\n')=>spawnSync(process.execPath,['src/cli.js',...args],{encoding:'utf8',input,timeout:5000});
    const args=['interact','--project',`${base}/project.yaml`,'--db-file',file];
    const first=cli(args,'2\n山田\n3\n30\n4\n4\nq\n');
    assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/登録データ:/);
    assert.match(cli(args).stdout,/山田/);
    assert.equal(cli(['verify','--project',`${base}/project.yaml`,'--db-file',file]).status,2);
    assert.equal(cli(['preview','--project',`${base}/project.yaml`,'--db-file',file]).status,2);
    assert.equal(cli(['interact','--project','examples/project.yaml','--db-file',join(dir,'no-schema.sqlite')]).status,2);
    const before=await readFile(file);assert.equal(cli(['verify','--project',`${base}/project.yaml`]).status,0);assert.deepEqual(await readFile(file),before);
  });
});

test('取得結果をアクションと遷移引数に渡せる',()=>{
  const d=structuredClone(spec);
  const parent=d.screen02.actions[0];
  parent.steps=[{id:'lookup',type:'db.select',table:'plans',where:{id:{literal:1}}},{id:'child',type:'process',action:'child',inputs:{value:{result:'lookup',column:'initial_credit'}}}];
  d.screen02.actions.push({id:'child',inputs:[{id:'value',type:'number'}],steps:[{id:'go',type:'transition',target:'/',inputs:{credit:{input:'value'}}}]});
  const db=createDatabase(schema);
  try{const r=execute(d,db);assert.equal(r.success,true);assert.deepEqual(r.transition,{target:'/',inputs:{credit:100}});}finally{db.close();}
});

test('取得ゼロ件をwhenで判断し、不要な登録を実行しない',()=>{
  const d=structuredClone(spec);
  d.screen02.actions[0].steps=[
    {id:'lookup',type:'db.select',table:'plans',where:{id:{literal:999}}},
    {id:'missing',type:'message',message:'プランがありません。',when:{result:'lookup',column:'id',equals:null}},
    {id:'skip',type:'process',action:'create_user',inputs:{name:{input:'name'},age:{input:'age'}},when:{result:'lookup',column:'id',not_equals:null}},
  ];
  const db=createDatabase(schema);
  try{const r=execute(d,db);assert.deepEqual(r.messages,['プランがありません。']);assert.deepEqual(db.snapshot({users:[]}),{users:[]});}finally{db.close();}
});

test('route_testsでも初期DBと共通処理後のDBを検証できる',async()=>{
  await temporary(async dir=>{
    await cp(base,dir,{recursive:true});
    const project=parse(await readFile(join(dir,'project.yaml'),'utf8'));
    project.route_test_file='db-route.test.yaml';await writeFile(join(dir,'project.yaml'),stringify(project));
    await writeFile(join(dir,'db-route.test.yaml'),stringify({route_tests:[{path:'/',database:{users:[{id:1,name:'初期ユーザ',age:40,plan_id:1,credit:50}]},expect:{screen:'screen01',database:{users:[{name:'初期ユーザ'}]}}}]}));
    assert.ok((await runProject(join(dir,'project.yaml'))).every(r=>r.passed));
  });
});

test('後続の共通処理が失敗したら直前の画面アクションのDB更新も取り消す',async()=>{
  await temporary(async dir=>{
    await cp(base,dir,{recursive:true});
    const screenFile=join(dir,'features/screen01/screen01.spec.yaml');
    const screen=parse(await readFile(screenFile,'utf8'));
    screen.screen01.actions[0].steps.splice(1,0,{id:'write',type:'db.update',table:'plans',where:{id:{literal:1}},values:{registrations:{literal:999}}});
    await writeFile(screenFile,stringify(screen));
    const appFile=join(dir,'app.yaml'),app=parse(await readFile(appFile,'utf8'));
    app.app.actions[0].steps.push({id:'fail',type:'db.insert',table:'users',when:{input:'path',equals:'/confirm'},values:{name:{literal:'X'},age:{literal:1},plan_id:{literal:999},credit:{literal:1}}});
    await writeFile(appFile,stringify(app));
    const screens=await loadApplication(join(dir,'project.yaml')),db=createDatabase(screens.databaseSchema);
    const session=createFlowSession(screens,{database:db});
    try {session.set('name','山田');session.set('age','30');assert.throws(()=>session.press('add_button'));assert.deepEqual(db.snapshot({plans:[{id:1,registrations:0}]}),{plans:[{id:1,registrations:0}]});}finally{session.close();db.close();}
  });
});
