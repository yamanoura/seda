import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReport, readable, writeReportPdf } from '../src/pdf.js';

test('report describes screens, common behavior, conditions and unexecuted tests', async () => {
  const blocks = await buildReport({project:'examples/project.yaml'});
  const text = blocks.map(b=>b.text).join('\n');
  assert.match(text,/共通の動作/);
  assert.match(text,/「確認へ」を押したとき/);
  assert.match(text,/名前を入力してください/);
  assert.match(text,/確認用ログに出力（保存処理ではありません）/);
  assert.match(text,/期待値・未実行/);
  assert.doesNotMatch(text,/__seda_before_each__/);
});

test('screen filter keeps common behavior but excludes other screen sections',async()=>{
  const blocks=await buildReport({project:'examples/project.yaml',screen:'screen01'});
  assert.equal(blocks.filter(b=>b.kind==='page').length,2);
  await assert.rejects(buildReport({project:'examples/project.yaml',screen:'missing'}),/画面が存在しません/);
});

test('SQLite descriptions include data operations without executing or changing the DB',async()=>{
  const blocks=await buildReport({project:'examples/sqlite/project.yaml'});
  assert.ok(blocks.some(b=>b.text.includes('データ「')));
});

test('readable preserves literal contents even when equal to a known key',()=>{
  assert.equal(readable({literal:'name'}),'固定値: name');
  assert.equal(readable({literal:'true'}),'固定値: true');
  assert.equal(readable({future_key:{x:0}}),'future_key: x: 0');
});

test('CLI rejects incompatible arguments and unavailable fonts',()=>{
  for(const args of [['pdf','--path','/'],['verify','--output','x.pdf'],['pdf','--design','x','--project','y'],['pdf','--test','x']]) {
    assert.equal(spawnSync(process.execPath,['src/cli.js',...args]).status,2);
  }
});

test('conditional checks and renamed inputs retain their field labels',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'seda-report-'));
  try {
    const file=join(dir,'spec.yaml');
    await writeFile(file,JSON.stringify({s:{fields:[{id:'n',type:'text',label:'氏名'},{id:'go',type:'button',label:'実行',trigger:'click',action:'check',inputs:{alias:{field:'n'}}}],actions:[{id:'check',inputs:[{id:'alias',type:'text'}],steps:[{id:'v',type:'validation',when:{input:'alias',not_equals:'skip'},rules:[{target:'alias',validation:'required'}],on_error:{action:'show_message'}}]}],validations:[{id:'required',condition:{operator:'empty',expected:false},message:{template:'{label}が必要'}}]}}));
    const text=(await buildReport({design:file})).map(b=>b.text).join('\n');
    assert.match(text,/氏名が必要/);
    assert.match(text,/場合のみ/);
    assert.match(text,/skip/);
    const output=join(dir,'existing.pdf');
    await writeFile(output,'original');
    await assert.rejects(writeReportPdf([{kind:'title',text:'test'}],{output,font:join(dir,'missing.ttf')}),/フォント/);
    assert.equal(await readFile(output,'utf8'),'original');
  } finally {await rm(dir,{recursive:true,force:true});}
});
