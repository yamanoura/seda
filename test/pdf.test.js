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
  assert.equal(blocks.filter(b=>b.kind==='page').length,1);
  assert.equal(blocks.filter(b=>b.kind==='wireframe').length,1);
  assert.ok(blocks.some(b=>b.kind==='flow' && b.button==='ホーム'));
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

test('customer pages show diagrams and tables, keeping technical IDs in the appendix',async()=>{
  const blocks=await buildReport({project:'examples/project.yaml'});
  const split=blocks.findIndex(b=>b.kind==='appendix');
  const body=blocks.slice(0,split);
  assert.equal(body.filter(b=>b.kind==='wireframe').length,2);
  const displayed=JSON.stringify(body.map(b=>({text:b.text,rows:b.rows,nodes:b.nodes})));
  assert.doesNotMatch(displayed,/add_entry|create_user|prepare_log|screen01/);
  assert.match(JSON.stringify(blocks.slice(split)),/create_user/);
  const validation=body.flatMap(b=>b.nodes ?? []).find(n=>n.failure);
  assert.match(validation.failure,/不|エラー/);
  assert.ok(body.some(b=>b.kind==='table' && b.headers.includes('入力・操作')));
  assert.ok(body.some(b=>b.kind==='table' && b.headers.includes('初期表示・入力ルール')));
  assert.ok(body.some(b=>b.kind==='flow' && b.text==='画面を表示する前'));
});

test('conditional child actions keep the parent condition and renamed labels in customer tables',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'seda-conditional-pdf-'));
  try {
    const file=join(dir,'spec.yaml');
    await writeFile(file,JSON.stringify({s:{fields:[{id:'name',type:'text',label:'氏名'},{id:'go',type:'button',label:'確認',trigger:'click',action:'outer',inputs:{alias:{field:'name'}}}],actions:[{id:'outer',inputs:[{id:'alias',type:'text'}],steps:[{id:'call',type:'process',action:'inner',inputs:{renamed:{input:'alias'}},when:{input:'alias',not_equals:'skip'}}]},{id:'inner',inputs:[{id:'renamed',type:'text'}],steps:[{id:'check',type:'validation',rules:[{target:'renamed',validation:'required'}],on_error:{action:'show_message'}}]}],validations:[{id:'required',condition:{operator:'empty',expected:false},message:{template:'{label}が必要'}}]}}));
    const blocks=await buildReport({design:file});
    const flow=blocks.find(b=>b.kind==='flow');
    assert.deepEqual(flow.nodes[0].conditions,['氏名が「skip」と等しくない']);
    assert.equal(flow.rules[0].field,'name');
    assert.equal(flow.rules[0].message,'氏名が必要');
    const rules=blocks.find(b=>b.kind==='table' && b.headers.includes('初期表示・入力ルール'));
    assert.match(rules.rows[0][4],/条件付き/);
    assert.ok(blocks.some(b=>b.kind==='caption' && b.text.includes('配置指定がない')));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('paginated tables preserve long cells and repeat headings without drawing below the page',async()=>{
  const {default:PDFDocument}=await import('pdfkit');
  const {renderReport}=await import('../src/pdf-layout.js');
  const doc=new PDFDocument({size:'A4',margins:{top:52,bottom:55,left:48,right:48}});
  doc.resume();
  const drawn=[], original=doc.text.bind(doc);
  doc.text=(text,x,y,options)=>{
    assert.ok(y<doc.page.height-54,`text outside page: ${y}`);
    assert.ok(y>=0);
    drawn.push(text);
    return original(text,x,y,options);
  };
  const long='long-value '.repeat(1300);
  renderReport(doc,[{kind:'title',text:'Report'},{kind:'table',headers:['Case','Expected'],rows:[['Long',long],...Array.from({length:50},(_,i)=>['case '+i,'result '+i])],widths:[0.3,0.7]}]);
  doc.end();
  assert.ok(drawn.filter(t=>t==='Case').length>3);
  assert.ok(drawn.includes('result 49'));
  assert.equal(drawn.filter(t=>t.includes('long-value')).join('').replaceAll(' ',''),long.replaceAll(' ',''));
});

test('five requested specification sections include undefined lengths and true editability',async()=>{
  const blocks=await buildReport({project:'examples/project.yaml'});
  const titles=blocks.map(b=>b.text).join('\n');
  for(const section of ['画面仕様概要','画面レイアウト（ワイヤーフレーム）','画面の項目定義仕様','画面遷移図','画面仕様詳細']) assert.ok(titles.includes(section));
  const tables=blocks.filter(b=>b.kind==='table' && b.headers.includes('長さ'));
  assert.equal(tables.length,2);
  assert.deepEqual(tables[0].rows[0].slice(0,4),['名前','文字列','未定義','入力・変更可']);
  assert.equal(tables[1].rows[0][3],'表示のみ（編集不可）');
  assert.ok(tables[0].rows.some(r=>r[1]==='ボタン' && r[2]==='対象外'));
  const edges=blocks.find(b=>b.kind==='transitions').edges;
  assert.ok(edges.some(e=>e.from==='ユーザ登録' && e.to==='ユーザ登録確認' && e.label==='「確認へ」操作'));
  assert.ok(edges.some(e=>e.from==='ユーザ登録確認' && e.to==='ユーザ登録' && e.label==='「確定」操作'));
  assert.equal(edges.filter(e=>e.label==='「ホーム」操作').length,2);
});
