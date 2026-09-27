import test from 'node:test';
import assert from 'node:assert/strict';
import { readYaml, compileDesign, simulate, runTests } from '../src/verifier.js';
import { createSession } from '../src/interact.js';
const source = await readYaml('test/fixtures/registration/features/screen01/screen01.spec.yaml');
const viewSource = await readYaml('test/fixtures/registration/features/screen01/screen01.view.yaml');
function fixture() {
  const spec = structuredClone(source), view = structuredClone(viewSource);
  const button = structuredClone(spec.screen01.fields[2]);
  button.id='draft_button';button.label='下書き';button.inputs.mode={literal:'draft'};
  button.inputs.name={literal:'下書きユーザ'};
  spec.screen01.fields.push(button);
  spec.screen01.actions[0].steps[1].inputs={mode:{input:'mode'},name:{input:'name'},age:{input:'age'}};
  spec.screen01.actions[1].inputs.push({id:'mode',type:'text'});
  view.screen01.layout.sections[1].fields.push('draft_button');
  return {spec,view};
}
test('同じアクションを2つのボタンから別の値で呼び出せる',()=>{
  const {spec,view}=fixture(); const session=createSession(spec,view);
  session.set('name','山田');session.set('age','30');
  assert.deepEqual(session.press('add_button').process_calls[0].inputs,{mode:'create',name:'山田',age:30});
  assert.deepEqual(session.press('draft_button').process_calls[0].inputs,{mode:'draft',name:'下書きユーザ',age:30});
  assert.equal(session.get('name'),'山田');
});
test('テストで呼び出し元を明示し、省略時の曖昧さを拒否する',()=>{
  const {spec}=fixture();
  const cases={design_tests:[{action:'add_entry',button:'draft_button',input:{age:20},expect:{process_calls:[{action:'create_user',inputs:{mode:'draft',name:'下書きユーザ',age:20}}]}}]};
  assert.ok(runTests(spec,cases)[0].passed);
  delete cases.design_tests[0].button;
  assert.throws(()=>runTests(spec,cases),/button/);
  assert.throws(()=>simulate(compileDesign(spec),'add_entry',{}, {},'name'),/ボタン/);
});
test('呼び出し引数の不足、余剰、型不一致と引数定義の重複を検出する',()=>{
  for(const mutate of [
    d=>{delete d.screen01.fields[2].inputs.mode;},
    d=>{d.screen01.fields[2].inputs.extra={literal:true};},
    d=>{d.screen01.fields[2].inputs.age={literal:'30'};},
    d=>{d.screen01.actions[0].inputs.push({id:'mode',type:'text'});},
    d=>{d.screen01.actions[0].inputs[0].type='unknown';},
    d=>{d.screen01.fields[0].inputs={};},
  ]){const d=structuredClone(source);mutate(d);assert.throws(()=>compileDesign(d));}
});
test('同一アクションでも呼び出し元のラベルで検証メッセージを生成する',()=>{
  const {spec}=fixture();
  spec.screen01.fields.push({id:'other',type:'text',label:'別名'});
  spec.screen01.fields[3].inputs.name={field:'other'};
  const d=compileDesign(spec);
  assert.deepEqual(simulate(d,'add_entry',{name:'山田',age:30,other:''},{},'draft_button').messages,['別名を入力してください。']);
});
test('旧アクション入力形式は呼び出し側の指定がない場合だけ互換対応する',()=>{
  for(const inputs of [['name','age'], {name:{field:'name'},age:{field:'age'}}]) {
    const d=structuredClone(source);d.screen01.actions[0].inputs=inputs;delete d.screen01.fields[2].inputs;
    assert.equal(simulate(compileDesign(d),'add_entry',{name:'山田',age:30}).success,true);
    d.screen01.fields[2].inputs={};assert.throws(()=>compileDesign(d),/混在/);
  }
});
