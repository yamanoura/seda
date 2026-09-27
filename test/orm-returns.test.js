import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDesign,simulate,runTests,readYaml} from '../src/verifier.js';
import {compileDatabase,createDatabase} from '../src/database.js';
import {loadApplication} from '../src/application.js';
import {createFlowSession} from '../src/interact.js';
import {formatFeedback} from '../src/feedback.js';
const schema=compileDatabase(await readYaml('examples/sqlite/database.yaml'));
const step=(id,operation,options={})=>({id,type:'db',model:'users',operation,...options});
const literal=value=>({literal:value});
const data={name:literal('山田'),age:literal(30),plan_id:literal(1),credit:literal(100)};
const doc=(steps,returns,extra=[])=>({screen:{fields:[{id:'go',type:'button',label:'実行',trigger:'click',action:'main',inputs:{}}],actions:[{id:'main',inputs:[],...(returns?{returns}:{}),steps},...extra]}});
function execute(document,fn=()=>{},seed={}) {
 const db=createDatabase(schema,{seed});
 try {const result=simulate(compileDesign(document,undefined,schema),'main',{}, {},'go',db);fn(result,db);return result;}finally{db.close();}
}
const ret=value=>({id:'return',type:'return',value});

test('ORM create/updateはレコード、findManyは選択した配列、updateManyはcountを返す',()=>{
 const d=doc([
  step('created','create',{data,select:{id:true,name:true}}),
  step('updated','update',{where:{id:{result:'created',column:'id'}},data:{age:literal(31)},select:{id:true,age:true}}),
  step('all','findMany',{select:{name:true,age:true},orderBy:[{age:'desc'},{id:'asc'}],take:2}),
  step('many','updateMany',{where:{age:literal(31)},data:{age:literal(32)}}),
  ret({result:'created'}),
 ],{model:'users',select:{id:true,name:true}});
 execute(d,(r,db)=>{
  assert.equal(r.success,true);assert.deepEqual(r.return_value,{id:1,name:'山田'});
  assert.deepEqual(r.db_results.updated,{id:1,age:31});assert.deepEqual(r.db_results.all,[{name:'山田',age:31}]);
  assert.deepEqual(r.db_results.many,{count:1});assert.deepEqual(db.snapshot({users:[{age:32}]}),{users:[{age:32}]});
 });
});

test('findUniqueは未取得ならnull、返り値のnullableを検証する',()=>{
 const steps=[step('found','findUnique',{where:{name:literal('不在')}}),ret({result:'found'})];
 assert.equal(execute(doc(steps,{model:'users',nullable:true})).return_value,null);
 const result=execute(doc(steps,{model:'users'}));
 assert.equal(result.success,false);assert.deepEqual(result.action_error,['SEDA_RETURN_TYPE']);
 assert.doesNotMatch(formatFeedback(result),/入力エラー/);
});

test('配列とモデルの型を継承して返せる',()=>{
 const r=execute(doc([step('all','findMany',{select:{name:true}}),ret({result:'all'})],{model:'users',many:true,select:{name:true}}));
 assert.equal(r.success,true);assert.deepEqual(r.return_value,[]);
 assert.throws(()=>compileDesign(doc([step('all','findMany'),ret({result:'all'})],{model:'users'}),undefined,schema),/返り値の型/);
});

test('未定義モデル・カラム・操作・unique条件・型違い・未対応キーを静的に拒否する',()=>{
 for(const bad of [
  step('x','create',{model:'missing',data}),step('x','remove'),
  step('x','findUnique',{where:{age:literal(1)}}),step('x','findUnique',{where:{name:literal(null)}}),
  step('x','findMany',{select:{nope:true}}),step('x','findMany',{select:{id:false}}),
  step('x','findMany',{orderBy:{id:'sideways'}}),step('x','findMany',{take:0}),
  step('x','create',{data:{...data,age:literal('x')}}),step('x','update',{where:{},data:{age:literal(1)}}),
  step('x','create',{data,include:{plans:true}}),step('x','updateMany',{where:{},data:{age:literal(1)}}),
 ]) assert.throws(()=>compileDesign(doc([bad]),undefined,schema));
});

test('updateがゼロ件なら、それ以前のcreateもロールバックする',()=>{
 execute(doc([step('new','create',{data}),step('change','update',{where:{id:literal(999)},data:{age:literal(1)}})]),(r,db)=>{
  assert.equal(r.success,false);assert.deepEqual(r.db_error,['SEDA_RECORD_NOT_FOUND']);assert.deepEqual(db.snapshot({users:[]}),{users:[]});
 });
});

test('前方定義の関数とネストした関数から値を受け取り、後続の引数・条件・返り値に使える',()=>{
 const d=doc([
  {id:'call',type:'process',action:'twice',inputs:{n:literal(3)}},
  {id:'visible',type:'message',message:'6です',when:{result:'call',equals:6}},
  ret({object:{answer:{result:'call'},ok:literal(true)}}),
 ],{type:'object',properties:{answer:{type:'number'},ok:{type:'boolean'}}},[
  {id:'twice',inputs:[{id:'n',type:'number'}],returns:{type:'number'},steps:[
   {id:'inner',type:'process',action:'double',inputs:{n:{input:'n'}}},ret({result:'inner'}),
  ]},
  {id:'double',inputs:[{id:'n',type:'number'}],returns:{type:'number'},steps:[ret({multiply:[{input:'n'},literal(2)]})]},
 ]);
 const r=simulate(compileDesign(d),'main',{});
 assert.equal(r.success,true);assert.deepEqual(r.return_value,{answer:6,ok:true});
 assert.deepEqual(r.action_results,{'twice.inner':6,call:6});assert.deepEqual(r.messages,['6です']);
 const cases={design_tests:[{action:'main',input:{},expect:{return_value:{answer:6,ok:true},action_results:{'twice.inner':6,call:6}}}]};
 assert.ok(runTests(d,cases).every(r=>r.passed));
});

test('条件付きreturnは呼び出し先だけを終了し、0・false・空文字も返せる',()=>{
 for(const [value,type] of [[0,'number'],[false,'boolean'],['','text']]) {
  const child={id:'child',inputs:[],returns:{type},steps:[
   {id:'early',type:'return',value:literal(value),when:{input:'flag',equals:true}},ret(literal(value)),
  ]};
  child.inputs=[{id:'flag',type:'boolean'}];
  const d=doc([{id:'call',type:'process',action:'child',inputs:{flag:literal(true)}},{id:'after',type:'message',message:'継続'},ret({result:'call'})],{type},[child]);
  const r=simulate(compileDesign(d),'main',{});
  assert.equal(r.return_value,value);assert.deepEqual(r.messages,['継続']);assert.ok(!r.executed_steps.includes('child.return'));
 }
});

test('返却宣言の欠落・不一致・未return・void結果・先行しない結果・遷移を拒否する',()=>{
 for(const d of [
  doc([ret(literal(1))]),doc([ret(literal('x'))],{type:'number'}),
  doc([{id:'log',type:'message',message:'x'}],{type:'number'}),
  doc([{...ret(literal(1)),when:{input:'missing',equals:1}}],{type:'number'}),
  doc([ret({result:'later'})],{type:'number'}),
  doc([{id:'call',type:'process',action:'void'},ret({result:'call'})],{type:'number'},[{id:'void',inputs:[],steps:[{id:'x',type:'message',message:'x'}]}]),
  doc([{id:'call',type:'process',action:'go'},ret(literal(1))],{type:'number'},[{id:'go',inputs:[],steps:[{id:'x',type:'transition',target:'/'}]}]),
  doc([ret({object:{id:literal(1)}})],{type:'object',properties:{name:{type:'text'}}}),
 ]) assert.throws(()=>compileDesign(d));
});

test('実行時の返却型エラーでネストしたDB書き込みを取り消す',()=>{
 const d=doc([{id:'call',type:'process',action:'create'},step('missing','findUnique',{where:{id:literal(999)}}),ret({result:'missing'})],{model:'users'},[
  {id:'create',inputs:[],returns:{model:'users'},steps:[step('saved','create',{data}),ret({result:'saved'})]},
 ]);
 execute(d,(r,db)=>{assert.equal(r.success,false);assert.deepEqual(r.action_error,['SEDA_RETURN_TYPE']);assert.deepEqual(db.snapshot({users:[]}),{users:[]});});
});

test('DBなしでも返却型を実行時に検証し、検証失敗時は返却しない',()=>{
 const d=doc([ret(literal(1))],{type:'number'});
 d.screen.fields.push({id:'n',type:'number',label:'数値'});d.screen.fields[0].inputs={n:{field:'n'}};
 d.screen.actions[0].inputs=[{id:'n',type:'number'}];d.screen.actions[0].steps=[ret({input:'n'})];
 const r=simulate(compileDesign(d),'main',{});
 assert.equal(r.success,false);assert.deepEqual(r.action_error,['SEDA_RETURN_TYPE']);assert.equal(r.return_value,null);
});

test('更新したSQLiteサンプルで関数がレコードを返し、呼び出し側が表示する',async()=>{
 const app=await loadApplication('examples/sqlite/project.yaml');const session=createFlowSession(app);
 try {
  session.set('name','山田');session.set('age','30');session.press('add_button');
  const r=session.press('confirm_button');
  assert.equal(r.success,true);assert.equal(r.action_results.register.name,'山田');
  assert.ok(r.debug_logs.some(line=>line.includes('登録データ:') && line.includes('山田')));
 }finally{session.close();}
});

test('関数の返り値を次の関数と画面遷移の引数に渡せる',()=>{
 const d=doc([
  {id:'first',type:'process',action:'echo',inputs:{n:literal(7)}},
  {id:'second',type:'process',action:'echo',inputs:{n:{result:'first'}}},
  {id:'go',type:'transition',target:'/',inputs:{id:{result:'second'}}},
 ],undefined,[{id:'echo',inputs:[{id:'n',type:'number'}],returns:{type:'number'},steps:[ret({input:'n'})]}]);
 const r=simulate(compileDesign(d),'main',{});
 assert.deepEqual(r.process_calls,[{action:'echo',inputs:{n:7}},{action:'echo',inputs:{n:7}}]);
 assert.deepEqual(r.transition,{target:'/',inputs:{id:7}});
});

test('返り値のある関数で検証失敗すると、呼び出し側の後続処理を止める',()=>{
 const d=doc([{id:'call',type:'process',action:'child',inputs:{n:literal(1)}},{id:'after',type:'message',message:'継続'}],undefined,[
  {id:'child',inputs:[{id:'n',type:'number'}],returns:{type:'number'},steps:[{id:'validate',type:'validation',rules:[{validation:'empty',target:'n'}]},ret({input:'n'})]},
 ]);
 d.screen.validations=[{id:'empty',condition:{operator:'empty',expected:true},message:{template:'空が必要'}}];
 const r=simulate(compileDesign(d),'main',{});
 assert.equal(r.success,false);assert.deepEqual(r.action_results,{});assert.deepEqual(r.messages,[]);
});

test('findUniqueのunique条件は実行時もnullを拒否し、updateManyは0件でも正常終了する',()=>{
 const d=doc([step('none','findUnique',{where:{name:{result:'missing',column:'name'}}})]);
 d.screen.actions[0].steps.unshift(step('missing','findUnique',{where:{id:literal(999)}}));
 const r=execute(d);assert.deepEqual(r.db_error,['SEDA_UNIQUE_WHERE']);
 const zero=execute(doc([step('update','updateMany',{where:{name:literal('不在')},data:{age:literal(1)}})]));
 assert.equal(zero.success,true);assert.deepEqual(zero.db_results.update,{count:0});
});
