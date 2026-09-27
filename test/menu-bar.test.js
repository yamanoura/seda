import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import stringWidth from 'string-width';
import {readYaml} from '../src/verifier.js';
import {renderPreview} from '../src/preview.js';
import {createSession} from '../src/interact.js';
import {keyboardController} from '../src/keyboard.js';
const project='examples/menu-bar/project.yaml';
const spec=await readYaml('examples/menu-bar/features/screen01/screen01.spec.yaml');
const view=await readYaml('examples/menu-bar/features/screen01/screen01.view.yaml');

test('メニューバーを本文の上に横並び表示し、日本語の枠を揃える',()=>{
  for(const device of ['desktop','mobile']) {
    const output=renderPreview(spec,view,{width:24,device,numbered:true});
    assert.match(output,/1\. \[ヘルプ\].*2\. \[登録\]/);
    assert.ok(output.indexOf('[ヘルプ]')<output.indexOf('ユーザ情報'));
    assert.match(output,/3\. 名前/);
    assert.equal(new Set(output.split('\n').map(stringWidth)).size,1);
  }
});

test('キーボードでメニューを実行し、本文へ移動して入力・登録できる',()=>{
  const session=createSession(spec,view);
  const ui=keyboardController(session);
  assert.deepEqual(session.fields.map(f=>f.id),['help_button','add_button','name','age']);
  ui.key('',{name:'return'});
  assert.match(ui.state().feedback,/名前と年齢を入力して/);
  assert.equal(ui.state().editing,false);
  ui.key('',{name:'right'});ui.key('',{name:'tab'});
  ui.key('',{name:'return'});ui.key('山田');ui.key('',{name:'return'});
  assert.equal(session.get('name'),'山田');
  session.set('age','30');
  ui.key('',{name:'tab',shift:true});ui.key('',{name:'return'});
  assert.match(ui.state().feedback,/登録しました/);
});

test('未定義・ボタン以外・二重配置・不正なメニューを拒否する',()=>{
  for(const mutate of [
    v=>{v.layout.menu_bar.fields=['missing'];},
    v=>{v.layout.menu_bar.fields=['name'];},
    v=>{v.layout.menu_bar.fields.push('help_button');},
    v=>{v.layout.sections[0].fields.push('help_button');},
    v=>{v.layout.menu_bar.fields=[];},
    v=>{v.layout.menu_bar=null;},
    v=>{v.layout.menu_bar.items=[];},
  ]) {
    const invalid=structuredClone(view);mutate(invalid.screen01);
    assert.throws(()=>renderPreview(spec,invalid));
  }
});

test('CLIの番号操作でもメニュー番号と実行が一致する',()=>{
  const r=spawnSync(process.execPath,['src/cli.js','interact','--project',project],{encoding:'utf8',input:'1\n3\n山田\n4\n30\n2\nq\n',timeout:5000});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/名前と年齢を入力して登録を選んでください/);
  assert.match(r.stdout,/登録しました/);
});
