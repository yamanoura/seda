import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readYaml, compileDesign, simulate, validateTransitions, initializeFields } from '../src/verifier.js';
import { createFlowSession } from '../src/interact.js';
import { loadPreviewScreens } from '../src/preview.js';
import { runProject } from '../src/project.js';
import { keyboardController } from '../src/keyboard.js';
const screens = await loadPreviewScreens('examples/project.yaml');
const [a,b] = screens.map(s => s.spec);
const catalog = () => new Map(screens.map(s => [s.screen, compileDesign(s.spec, s.screen)]));

test('新形式の例は遷移、型継承、処理引数まで検証できる', async () => {
  assert.ok((await runProject('examples/project.yaml')).every(r=>r.passed));
  const d = compileDesign(b);
  assert.equal(d.fields.get('age').type,'number');
  assert.equal(b.screen02.fields[1].type, undefined, '元のYAMLデータを変更しない');
});

test('参照元を一箇所で指定し固定値・受信値・別名を解決する', () => {
  const data=structuredClone(a);
  data.screen01.inputs=[{id:'origin',type:'text',required:true}];
  const action=data.screen01.actions[0];
  data.screen01.fields[2].inputs={user:{field:'name'}, mode:{literal:'create'}, origin:{input:'origin'}};
  action.inputs=[{id:'user',type:'text'},{id:'mode',type:'text'},{id:'origin',type:'text'}];
  action.steps=[{id:'v',type:'validation',rules:[{validation:'required',target:'user'}],on_error:{action:'show_message'}},{id:'p',type:'process',action:'save',inputs:{user:{input:'user'},mode:{input:'mode'},origin:{input:'origin'}}}];
  data.screen01.actions.push({id:'save',inputs:structuredClone(action.inputs),steps:[{id:'log',type:'debug',message:'保存する'}]});
  const d=compileDesign(data);
  assert.deepEqual(simulate(d,'add_entry',{name:''},{origin:'test'}).messages,['名前を入力してください。']);
  assert.deepEqual(simulate(d,'add_entry',{name:'山田'},{origin:'test'}).process_calls,[{action:'save',inputs:{user:'山田',mode:'create',origin:'test'}}]);
});

test('曖昧な参照・参照切れ・継承型の不一致を拒否する', () => {
  for(const ref of [{field:'unknown'},{field:'name',literal:'x'},{literal:null},{input:'missing'}]) {
    const data=structuredClone(a);data.screen01.fields[2].inputs.name=ref;
    assert.throws(()=>compileDesign(data));
  }
  const data=structuredClone(b);data.screen02.fields[1].type='text';
  assert.throws(()=>compileDesign(data),/型と不一致/);
});

test('遷移先・必須引数・型をプロジェクト横断で検証する', () => {
  for(const modify of [step=>{step.target='missing';},step=>{delete step.inputs.age;},step=>{step.inputs.age={literal:'30'};},step=>{step.inputs.extra={literal:true};}]) {
    const data=structuredClone(a);modify(data.screen01.actions[0].steps[1]);
    const c=catalog();c.set('screen01',compileDesign(data));
    assert.throws(()=>validateTransitions(c));
  }
  const data=structuredClone(a);data.screen01.actions[0].steps.push({id:'after',type:'message',message:'x'});
  assert.throws(()=>compileDesign(data),/最後/);
});

test('受信値は必須・型・未知キーを検証しreadonlyを上書きさせない', () => {
  const d=compileDesign(b);
  for(const input of [{},{name:'山田',age:'30'},{name:'山田',age:30,extra:1}]) assert.throws(()=>initializeFields(d,input));
  assert.throws(()=>initializeFields(d,{name:'山田',age:30},{age:40}),/編集できない/);
});

test('対話画面が遷移し、受信値を保持・編集を禁止・先頭へリセットできる', () => {
  const session=createFlowSession(screens);
  assert.equal(session.press('add_button').transition,null);
  session.set('name','山田太郎');session.set('age','30');
  session.press('add_button');
  assert.equal(session.screenId,'screen02');
  assert.equal(session.get('name'),'山田太郎');
  assert.match(session.render(),/読取専用/);
  assert.throws(()=>session.set('name','別人'));
  assert.equal(session.press('confirm_button').success,true);
  session.reset();assert.equal(session.screenId,'screen01');assert.equal(session.get('name'),'');
});

test('キーボード遷移後のfocusとreadonly操作、リセット', () => {
  const session=createFlowSession(screens); session.set('name','山田');session.set('age','30');
  const ui=keyboardController(session);ui.key('',{name:'tab',shift:true});ui.key('',{name:'return'});
  assert.equal(ui.state().focus,0); assert.equal(session.screenId,'screen02');
  ui.key('',{name:'tab'});ui.key('',{name:'return'});assert.match(ui.state().feedback,/読み取り専用/);
  ui.key('r');assert.equal(session.screenId,'screen01');
});

test('CLIで入力→確認→確定を連続操作できる', () => {
  const r=spawnSync(process.execPath,['src/cli.js','interact','--project','examples/project.yaml'],{encoding:'utf8',input:'2\n山田\n3\n30\n4\n2\n4\nq\n',timeout:5000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/画面遷移: \/confirm/);assert.match(r.stdout,/読み取り専用/);assert.match(r.stdout,/登録しました/);
});
