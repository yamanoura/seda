import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import {loadApplication} from '../src/application.js';
import {createFlowSession} from '../src/interact.js';
import {previewProject,renderPreview} from '../src/preview.js';

test('URL欄はワイヤーフレーム内に表示し、遷移・リセットに追従する',async()=>{
  const screens=await loadApplication('examples/project.yaml');
  const session=createFlowSession(screens);
  assert.match(session.render().split('\n')[1], /\| URL \[ \/ \]/);
  session.set('name','山田');session.set('age','30');session.press('add_button');
  assert.match(session.render().split('\n')[1], /URL \[ \/confirm \]/);
  session.reset();assert.match(session.render().split('\n')[1], /URL \[ \/ \]/);
  const preview=await previewProject('examples/project.yaml',{path:'/confirm'});
  assert.match(preview[0].text.split('\n')[1],/URL \[ \/confirm \]/);
  const screen=screens[0];
  const long=renderPreview(screen.spec,screen.view,{width:24,path:'/長い日本語のパス/確認画面/詳細情報'});
  assert.equal(new Set(long.split('\n').map(stringWidth)).size,1);
  assert.throws(()=>renderPreview(screen.spec,screen.view,{path:'/\x1b[31m'}),/制御文字/);
});
