import test from 'node:test';
import assert from 'node:assert/strict';
import { readYaml, compileDesign, validateTransitions, simulate } from '../src/verifier.js';
import { createFlowSession } from '../src/interact.js';
import { loadPreviewScreens } from '../src/preview.js';
const source = await readYaml('examples/features/screen01/screen01.spec.yaml');

test('遷移引数の省略は空として扱い、nullや配列は拒否する', () => {
  const spec=structuredClone(source);
  const step=spec.screen01.actions[0].steps[1];
  step.target='screen01';
  delete step.inputs;
  const design=compileDesign(spec);
  assert.doesNotThrow(()=>validateTransitions(new Map([['screen01',design]])));
  assert.deepEqual(simulate(design,'add_entry',{name:'山田',age:30}).transition,{target:'screen01',inputs:{}});
  assert.equal(step.inputs,undefined);
  for(const invalid of [null,[], '']) {
    step.inputs=invalid;
    assert.throws(()=>compileDesign(spec),/マッピング/);
  }
});

test('遷移先の必須引数は省略できず、任意引数は省略できる', async () => {
  const spec=structuredClone(source);
  delete spec.screen01.actions[0].steps[1].inputs;
  const target=await readYaml('examples/features/screen02/screen02.spec.yaml');
  const catalog=()=>Object.assign(new Map([['screen01',compileDesign(spec)],['screen02',compileDesign(target)]]),{routes:new Map([['/','screen01'],['/confirm','screen02']])});
  assert.throws(()=>validateTransitions(catalog()),/必須の遷移引数/);
  target.screen02.inputs.forEach(p=>{p.required=false;});
  assert.doesNotThrow(()=>validateTransitions(catalog()));
});

test('対話操作で確認画面から引数なしで入力画面へ戻れる', async () => {
  const session=createFlowSession(await loadPreviewScreens('examples/project.yaml'));
  session.set('name','山田');session.set('age','30');session.press('add_button');
  assert.equal(session.screenId,'screen02');
  const result=session.press('confirm_button');
  assert.deepEqual(result.transition,{target:'/',inputs:{}});
  assert.equal(session.screenId,'screen01');
});
