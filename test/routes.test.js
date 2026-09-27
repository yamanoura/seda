import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parse,stringify} from 'yaml';
import {loadApplication,enterRoute} from '../src/application.js';
import {createFlowSession} from '../src/interact.js';
import {previewProject} from '../src/preview.js';
import {runProject} from '../src/project.js';
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'seda-routes-'));
  try {
    await cp('examples',dir,{recursive:true});
    const edit=async(file,mutate)=>{const path=join(dir,file), data=parse(await readFile(path,'utf8'));mutate(data);await writeFile(path,stringify(data));};
    await run(join(dir,'project.yaml'),edit,dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}

test('mainの順序によらず / から起動し、全遷移・リセットで共通レイアウトと処理を適用する',async()=>{
  await fixture(async(file,edit)=>{
    await edit('project.yaml',p=>p.main.reverse());
    const screens=await loadApplication(file);
    const session=createFlowSession(screens);
    assert.equal(session.path,'/');assert.equal(session.screenId,'screen01');
    assert.match(session.render(),/ユーザ管理サービス.*ユーザ登録/);
    assert.equal(session.entryFeedback.debug_logs.length,1);
    session.render();session.render();assert.equal(session.entryFeedback.debug_logs.length,1);
    session.set('name','山田');session.set('age','30');
    const result=session.press('add_button');
    assert.equal(session.path,'/confirm');assert.equal(session.screenId,'screen02');
    assert.equal(result.common_results.length,1);
    assert.equal(session.get('name'),'山田');
    assert.ok(session.fields.some(f=>f.id==='app::home'));
    session.press('app::home');assert.equal(session.path,'/');
    session.reset();assert.equal(session.path,'/');
    assert.equal(session.entryFeedback.debug_logs.length,1);
  });
});

test('共通処理へ解決済みのpathとscreenを渡し、条件付きリダイレクト先でも共通処理を実行する',async()=>{
  await fixture(async(file,edit)=>{
    await edit('project.yaml',p=>p.routes.push({path:'/old',screen:'screen01'}));
    await edit('app.yaml',d=>{
      d.app.actions[0].steps.unshift({id:'record',type:'process',action:'record',inputs:{path:{input:'path'},screen:{input:'screen'}}});
      d.app.actions.push({id:'record',inputs:[{id:'path',type:'text'},{id:'screen',type:'text'}],steps:[{id:'log',type:'debug',message:'訪問'}]});
      d.app.actions[0].steps.push({id:'redirect',type:'transition',target:'/',when:{input:'path',equals:'/old'}});
    });
    const screens=await loadApplication(file);
    const entered=enterRoute(screens,'/old');
    assert.equal(entered.path,'/');assert.equal(entered.hooks.length,2);
    assert.deepEqual(entered.hooks[0].process_calls[0].inputs,{path:'/old',screen:'screen01'});
    assert.deepEqual(entered.hooks[1].process_calls[0].inputs,{path:'/',screen:'screen01'});
    assert.equal(createFlowSession(screens,{path:'/old'}).path,'/');
    assert.equal((await previewProject(file,{path:'/old'}))[0].path,'/');
  });
});

test('ルートの不足・重複・未知の画面・必須app・不正なoutletを拒否する',async()=>{
  for(const [file,mutate] of [
    ['project.yaml',p=>{p.routes.shift();}],
    ['project.yaml',p=>{p.routes.push(p.routes[0]);}],
    ['project.yaml',p=>{p.routes[0].screen='missing';}],
    ['project.yaml',p=>{delete p.app_file;}],
    ['project.yaml',p=>{p.app_file='missing.yaml';}],
    ['project.yaml',p=>{p.routes[1].path='relative';}],
    ['app.yaml',d=>{d.app.before_each.action='missing';}],
    ['app.yaml',d=>{d.app.view.layout.sections=[];}],
    ['app.yaml',d=>{d.app.view.layout.sections.push({id:'other',type:'outlet'});}],
    ['app.yaml',d=>{d.app.actions[0].steps.push({id:'redirect',type:'transition',target:'/missing'});}],
    ['app.yaml',d=>{d.app.actions[0].steps[0].when={input:'missing',equals:'x'};}],
    ['app.yaml',d=>{d.app.actions[0].steps[0].when={input:'path',equals:true};}],
  ]) await fixture(async(path,edit)=>{await edit(file,mutate);await assert.rejects(()=>loadApplication(path));});
});

test('共通処理の循環・検証失敗で対象画面を開かない',async()=>{
  await fixture(async(file,edit)=>{
    await edit('app.yaml',d=>{d.app.actions[0].steps.push({id:'loop',type:'transition',target:'/'});});
    const screens=await loadApplication(file);
    assert.throws(()=>createFlowSession(screens),/循環/);
    await assert.rejects(()=>runProject(file),/循環/);
  });
  await fixture(async(file,edit)=>{
    await edit('app.yaml',d=>{
      d.app.validations=[{id:'deny',condition:{operator:'empty',expected:true},message:{template:'表示できません。'}}];
      d.app.actions[0].steps=[{id:'check',type:'validation',rules:[{validation:'deny',target:'path'}],on_error:{action:'show_message'}}];
    });
    const screens=await loadApplication(file);
    assert.throws(()=>createFlowSession(screens),/表示できません/);
  });
});

test('共通と画面の同名IDを分離し、不正な共通メニュー参照を見逃さない',async()=>{
  await fixture(async(file,edit)=>{
    await edit('app.yaml',d=>{
      d.app.fields[0].id='add_button';d.app.view.layout.menu_bar.fields=['add_button'];
    });
    const screens=await loadApplication(file);
    const session=createFlowSession(screens);
    assert.ok(session.fields.some(f=>f.id==='app::add_button'));
    assert.ok(session.fields.some(f=>f.id==='add_button'));
    session.press('app::add_button');assert.equal(session.path,'/');
    await edit('app.yaml',d=>{d.app.view.layout.menu_bar.fields=['missing'];});
    await assert.rejects(()=>runProject(file),/ボタン項目/);
  });
});

test('共通処理とパスの期待値をYAMLで検証し、不一致ならCLI終了コード1',async()=>{
  await fixture(async(file,edit)=>{
    assert.ok((await runProject(file)).every(r=>r.passed));
    await edit('routes.test.yaml',d=>{d.route_tests[0].expect.debug_logs=['誤った期待値'];});
    const r=spawnSync(process.execPath,[resolve('src/cli.js'),'verify','--project',file],{encoding:'utf8'});
    assert.equal(r.status,1,r.stderr);assert.match(r.stdout,/debug_logs/);
  });
});

test('CLIのpath指定と不正パス・引数なし確認画面への直アクセスを検証する',async()=>{
  const cli=(...args)=>spawnSync(process.execPath,[resolve('src/cli.js'),...args],{encoding:'utf8',input:'q\n',timeout:5000});
  const r=cli('interact','--project','examples/project.yaml');
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/URL \[ \/ \]/);assert.match(r.stdout,/共通の表示前処理/);
  assert.equal(cli('interact','--project','examples/project.yaml','--path','/missing').status,2);
  assert.equal(cli('interact','--project','examples/project.yaml','--path','/confirm').status,2);
  assert.equal(cli('interact','--project','examples/project.yaml','--path','/','--screen','screen01').status,2);
  const preview=cli('preview','--project','examples/project.yaml','--path','/confirm','--json');
  assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).previews[0].path,'/confirm');
});

test('旧mainだけのプロジェクトは引き続き起動できる',async()=>{
  await fixture(async(file,edit)=>{
    await edit('project.yaml',p=>{delete p.routes;delete p.app_file;delete p.route_test_file;});
    await edit('features/screen01/screen01.spec.yaml',d=>{d.screen01.actions[0].steps[1].target='screen02';});
    await edit('features/screen02/screen02.spec.yaml',d=>{d.screen02.actions[0].steps.at(-1).target='screen01';});
    const screens=await loadApplication(file);
    const session=createFlowSession(screens);
    assert.equal(session.screenId,'screen01');
    session.set('name','山田');session.set('age','30');session.press('add_button');
    assert.equal(session.screenId,'screen02');
  });
});
