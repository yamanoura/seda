import test from 'node:test';
import assert from 'node:assert/strict';
import { readYaml, compileDesign, simulate, runTests } from '../src/verifier.js';
import { formatFeedback } from '../src/feedback.js';
const source = await readYaml('test/fixtures/registration/features/screen01/screen01.spec.yaml');
const call = (action, inputs = {}) => ({id:'call',type:'process',action,inputs});

test('呼び出し先を実行し、debugは画面メッセージに混在させない', () => {
  const spec = structuredClone(source);
  spec.screen01.actions.reverse(); // 前方・後方参照の両方を許可
  const result = simulate(compileDesign(spec), 'add_entry', {name:'山田',age:30});
  assert.deepEqual(result.messages,['登録しました。']);
  assert.deepEqual(result.debug_logs,['登録しました。']);
  assert.deepEqual(result.executed_steps,['validate','register','create_user.register','completed']);
  result.debug_logs = ['内部情報\x1b[31m'];
  const [screen, debug] = formatFeedback(result).split('--- デバッグログ ---');
  assert.doesNotMatch(screen,/内部情報/);
  assert.match(debug,/内部情報/);
  assert.doesNotMatch(debug,/\x1b/);
});

test('複数段の引数渡しと子の検証失敗を伝播し、親の後続処理を停止する', () => {
  const spec = structuredClone(source);
  spec.screen01.actions[1].steps = [call('check_user',{user:{input:'name'},mode:{literal:false},count:{literal:0}})];
  spec.screen01.actions.push({id:'check_user',inputs:[{id:'user',type:'text'},{id:'mode',type:'boolean'},{id:'count',type:'number'}],steps:[
    {id:'check',type:'validation',rules:[{validation:'required',target:'user'}],on_error:{action:'show_message'}},
    {id:'debug',type:'debug',message:'child done'},
  ]});
  spec.screen01.actions[0].steps.shift();
  const ok = simulate(compileDesign(spec),'add_entry',{name:'山田',age:30});
  assert.deepEqual(ok.process_calls[1],{action:'check_user',inputs:{user:'山田',mode:false,count:0}});
  assert.deepEqual(ok.debug_logs,['child done']);
  const cases = {design_tests:[{action:'add_entry',input:{name:'',age:30},expect:{success:false,validation_error:[{validation:'required',target:'user'}],messages:['名前を入力してください。'],debug_logs:[]}}]};
  assert.ok(runTests(spec,cases)[0].passed);
});

test('子の画面遷移で親の後続処理も停止する', () => {
  const spec = structuredClone(source);
  spec.screen01.actions[1].steps = [{id:'next',type:'transition',target:'screen02',inputs:{name:{input:'name'},age:{input:'age'}}}];
  const result=simulate(compileDesign(spec),'add_entry',{name:'山田',age:30});
  assert.deepEqual(result.transition,{target:'screen02',inputs:{name:'山田',age:30}});
  assert.deepEqual(result.messages,[]);
  assert.ok(!result.executed_steps.includes('completed'));
});

test('未使用アクションを含め自己・相互循環と未定義参照を拒否する', () => {
  for (const steps of [[call('loop')],[call('other')],[call('missing')]]) {
    const spec=structuredClone(source);
    spec.screen01.actions.push({id:'loop',inputs:[],steps});
    spec.screen01.actions.push({id:'other',inputs:[],steps:[call('loop')]});
    assert.throws(()=>compileDesign(spec), /循環呼び出し|定義されていません/);
  }
  const spec=structuredClone(source);
  spec.screen01.processes=[];
  assert.throws(()=>compileDesign(spec),/processes/);
});
