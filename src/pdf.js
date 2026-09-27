import PDFDocument from 'pdfkit';
import { buildHumanReport } from './pdf-content.js';
import { renderReport } from './pdf-layout.js';
import { create as createFont } from 'fontkit';
import { access, mkdir, open, rename, rm, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { loadApplication } from './application.js';
import { compileDesign, DefinitionError, readYaml, validateTests } from './verifier.js';

const types = {text:'文字列',number:'数値',boolean:'真偽値',button:'ボタン'};
const words = {success:'処理の成功',transition:'移動先',target:'対象',inputs:'引き継ぐ値',input:'入力値',field:'画面項目',literal:'固定値',result:'処理結果',column:'列',processes:'呼び出す処理',validation_error:'入力エラー',validation:'チェック',executed_steps:'実行される処理',messages:'画面メッセージ',debug_logs:'確認用ログ',database:'保存データ',returns:'返り値',return_value:'返り値',field_values:'画面の値',process_calls:'処理呼び出し',db_results:'DB処理結果',db_error:'DBエラー',action_results:'処理の返却結果',action_error:'処理エラー',where:'検索・更新条件（すべて一致）',data:'値',values:'値',select:'取得する列',orderBy:'並び順',order_by:'並び順',take:'最大取得件数',limit:'最大取得件数',columns:'取得する列',mode:'取得方法',equals:'等しい',not_equals:'等しくない',add:'加算',subtract:'減算',multiply:'乗算',divide:'除算',path:'URL',screen:'画面',screen_inputs:'画面が受け取る値',button:'操作するボタン',action:'処理',name:'名前',expect:'期待する結果',asc:'昇順',desc:'降順',true:'はい',false:'いいえ'};
const value = v => v === null ? '値なし' : v === '' ? '空文字' : typeof v === 'boolean' ? (v ? 'はい' : 'いいえ') : String(v);

// Render every nested value, including keys we cannot translate. Never silently omit data.
export function readable(v, labels = {}, key) {
  if (['target','validation','action','button','screen','field','input'].includes(key) && typeof v === 'string') return labels[v] ?? v;
  if (Array.isArray(v)) return v.length ? v.map(x => readable(x, labels)).join('、') : 'なし';
  if (v && typeof v === 'object') return Object.entries(v).map(([k,x]) => `${labels[k] ?? words[k] ?? k}: ${readable(x, labels, k)}`).join(' / ') || 'なし';
  return value(v);
}

async function buildTechnicalReport({project, design, screen, test, title} = {}) {
  let screens;
  if (design) {
    const spec = await readYaml(design);
    const compiled = compileDesign(spec, screen);
    const id = screen ?? Object.keys(spec)[0];
    screens = [{screen:id, spec, design:compiled, testFile:test}];
  } else screens = await loadApplication(project, {requireViews:false});
  if (screen && !screens.some(s => s.screen === screen)) throw new DefinitionError(`画面が存在しません: ${screen}`);
  const blocks = [];
  const add = (kind, text) => blocks.push({kind, text});
  const names = Object.fromEntries(screens.map(s => [s.screen, s.view?.[s.screen]?.title ?? s.spec[s.screen].description ?? s.screen]));
  const destination = target => names[screens.routes?.get(target) ?? target] ? `${names[screens.routes?.get(target) ?? target]}（${target}）` : target;
  add('title', title ?? screens.app?.view.title ?? '画面・操作の設計書');
  add('body', '設計YAMLから生成した仕様です。テスト欄は期待する動作を示し、実行結果ではありません。');
  add('body', '処理は記載順に進みます。入力チェックで不適合、画面への移動、または値の返却が起きると、その処理の後続は実行しません。呼び出し先での入力エラーや画面移動も呼び出し元の後続を停止します。');
  add('heading', '画面一覧');
  for (const s of screens.filter(s => !screen || s.screen === screen)) add('body', `${names[s.screen]}（${s.screen}）${screens.routes ? ' / ' + [...screens.routes].filter(([,id]) => id === s.screen).map(([p]) => p).join('、') : ''}`);

  function describe(spec, compiled) {
    const fields = [...compiled.fields.values()].filter(f => f.id !== '__seda_before_each__');
    const labels = Object.fromEntries(fields.map(f => [f.id, f.label]));
    const actions = new Map(spec.actions.map(a => [a.id,a]));
    const checks = new Map((spec.validations ?? []).map(v => [v.id,v]));
    const ref = (v, bindings = {}) => {
      if (v && typeof v === 'object') {
        if ('literal' in v) return `「${value(v.literal)}」`;
        if ('field' in v) return `画面の「${labels[v.field] ?? v.field}」`;
        if ('input' in v) return bindings[v.input] ?? `受け取った「${labels[v.input] ?? v.input}」`;
        if ('result' in v) return `処理「${v.result}」の結果${v.column ? `の「${v.column}」` : ''}`;
      }
      return readable(v, labels);
    };
    const bindingsFor = (a, passed, parent = {}) => Object.fromEntries(Object.entries(passed ?? (Array.isArray(a.inputs) ? Object.fromEntries(a.inputs.filter(x => typeof x === 'string').map(x => [x,{field:x}])) : a.inputs) ?? {}).map(([k,v]) => [k, ref(v,parent)]));
    const argumentLabels = (a, passed, parent = {}) => Object.fromEntries(Object.entries(passed ?? (Array.isArray(a.inputs) ? Object.fromEntries(a.inputs.filter(x => typeof x === 'string').map(x => [x,{field:x}])) : a.inputs) ?? {}).map(([k,v]) => [k, v.field ? labels[v.field] : v.input ? parent[v.input] : undefined]));
    function steps(action, bindings, depth = 0, inputLabels = {}) {
      if (depth > 30) throw new DefinitionError('PDFの処理呼び出し階層が深すぎます');
      for (const [i,s] of action.steps.entries()) {
        const prefix = `${'　'.repeat(Math.min(depth,3))}${i+1}. `;
        if (s.when) {
          const {equals,not_equals,...r} = s.when;
          add('body', `${prefix}次の条件を満たす場合のみ: ${ref(r,bindings)}が「${value(Object.hasOwn(s.when,'equals') ? equals : not_equals)}」と${Object.hasOwn(s.when,'equals') ? '等しい' : '等しくない'}`);
        }
        const lead = `${prefix}［${s.id}］`;
        if (s.type === 'validation') {
          add('body', `${lead}入力をチェックします。`);
          for (const rule of s.rules) {
            const d = checks.get(rule.validation);
            const condition = d.condition.operator === 'empty' ? (d.condition.expected ? '空であること' : '空でないこと（必須）') : (d.condition.expected ? '数値であること' : '数値ではないこと');
            const label = inputLabels[rule.target] ?? rule.target;
            add('detail', `${bindings[rule.target] ?? label}: ${condition}。不適合時の文言: 「${d.message.template.replaceAll('{label}',label)}」${s.on_error ? '（画面に表示）' : '（画面表示の指定なし）'}`);
          }
        } else if (s.type === 'transition') {
          add('body', `${lead}${destination(s.target)}へ移動します。`);
          for (const [k,v] of Object.entries(s.inputs ?? {})) add('detail', `引き継ぐ「${labels[k] ?? k}」: ${ref(v,bindings)}`);
        } else if (s.type === 'process') {
          const called = actions.get(s.action);
          add('body', `${lead}「${called.description ?? called.id}」を呼び出します。以下は呼び出し先の処理です。`);
          steps(called,bindingsFor(called,s.inputs,bindings),depth+1,argumentLabels(called,s.inputs,inputLabels));
          add('detail', `「${called.description ?? called.id}」の説明ここまで。`);
        } else if (s.type === 'message' || s.type === 'debug') {
          add('body', `${lead}${s.type === 'message' ? '画面に表示' : '確認用ログに出力（保存処理ではありません）'}: 「${s.message}」`);
          if (s.data) add('detail', `出力する値: ${ref(s.data,bindings)}`);
        } else if (s.type === 'return') add('body', `${lead}${ref(s.value,bindings)}を返して処理を終了します。`);
        else if (s.type === 'db' || s.type.startsWith('db.')) {
          const op = s.operation ?? s.type;
          add('body', `${lead}データ「${s.model ?? s.table}」を${({findUnique:'1件検索',findMany:'一覧検索',create:'登録',update:'1件更新',updateMany:'複数件更新','db.select':'検索','db.insert':'登録','db.update':'更新'})[op] ?? op}します。`);
          for (const [k,v] of Object.entries(s).filter(([k]) => !['id','type','model','table','operation','when'].includes(k))) add('detail', `${words[k] ?? k}: ${readable(v,labels)}`);
        } else throw new DefinitionError(`PDF説明に未対応の処理: ${s.type}`);
      }
    }
    add('heading','画面項目');
    for (const f of fields) add('body', `${f.label} / ${types[f.type] ?? f.type}${f.readonly ? ' / 編集不可' : ''}${f.source ? ` / 受け取った「${f.source.input}」を初期表示` : ''}`);
    if (spec.inputs?.length) {
      add('heading','画面が受け取る値');
      for (const p of spec.inputs) add('body', `${labels[p.id] ?? p.id} / ${types[p.type]} / ${p.required ? '受け渡し必須' : '省略可能'}`);
    }
    for (const f of fields) if (f.type === 'button') {
      add('heading', `「${f.label}」を押したとき`);
      const a = actions.get(f.action);
      steps(a,bindingsFor(a,f.inputs),0,argumentLabels(a,f.inputs));
    }
    // Include definitions not directly attached to buttons, so no behavior disappears.
    for (const a of spec.actions.filter(a => !fields.some(f => f.action === a.id))) {
      add('heading', `処理の定義: ${a.description ?? a.id}`);
      steps(a,bindingsFor(a),0,argumentLabels(a));
    }
    return {...labels, ...Object.fromEntries([...checks].map(([id,v])=>[id, v.condition.operator === 'empty' ? (v.condition.expected ? '空欄チェック' : '必須チェック') : (v.condition.expected ? '数値チェック' : '数値以外のチェック')])), ...Object.fromEntries([...actions].map(([id,a])=>[id,a.description ?? fields.find(f=>f.action===id)?.label ?? id]))};
  }
  if (screens.app) {
    add('page','共通の動作');
    add('body', `各画面の表示前に「${screens.app.before_each.action}」を実行します。受け渡し: ${readable(screens.app.before_each.inputs)}`);
    describe(screens.app.spec,screens.app.design);
  }
  for (const s of screens.filter(s => !screen || s.screen === screen)) {
    add('page',names[s.screen]);
    add('detail', `画面ID: ${s.screen}`);
    const labels = describe(s.spec[s.screen],s.design);
    if (s.testFile) {
      const tests = await readYaml(s.testFile);
      validateTests(tests,s.design);
      add('heading','確認例（設計上の期待値・未実行）');
      for (const t of tests.design_tests) {
        add('subheading',t.name ?? '確認例');
        for (const [k,v] of Object.entries(t).filter(([k]) => k !== 'name')) add('body', `${words[k] ?? k}: ${readable(v,labels)}`);
      }
    } else add('body','確認例: テストファイルの指定なし');
  }
  if (screens.routeTestFile && !screen) {
    add('page','画面へのアクセスの確認例（未実行）');
    const tests = await readYaml(screens.routeTestFile);
    for (const t of tests.route_tests ?? []) {
      add('subheading',t.name ?? '確認例');
      for (const [k,v] of Object.entries(t).filter(([k]) => k !== 'name')) add('body',`${words[k] ?? k}: ${readable(v,names)}`);
    }
  }
  return blocks;
}

export async function buildReport(options = {}) {
  const technical = await buildTechnicalReport(options);
  return buildHumanReport(options, technical);
}

async function fontOptions(path) {
  const candidates = path ? [path] : [process.env.SEDA_PDF_FONT, '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'C:/Windows/Fonts/meiryo.ttc'].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); } catch { continue; }
    return candidate;
  }
  throw new DefinitionError('日本語フォントが見つかりません。--font <日本語TTF/OTF/TTC> または SEDA_PDF_FONT を指定してください');
}

export async function writeReportPdf(blocks, {output='design.pdf',font} = {}) {
  if (!output.toLowerCase().endsWith('.pdf')) throw new DefinitionError('--outputには拡張子.pdfのファイルを指定してください');
  const fontPath = await fontOptions(font);
  const buffer = await readFile(fontPath);
  const parsedFont = createFont(buffer);
  const face = parsedFont.fonts?.[0]?.postscriptName;
  const dest=resolve(output), tmp=`${dest}.${randomUUID()}.tmp`;
  await mkdir(dirname(dest),{recursive:true});
  const doc=new PDFDocument({size:'A4',margins:{top:52,bottom:55,left:48,right:48},bufferPages:true,info:{Title:blocks[0].text,Author:'seda'}});
  doc.registerFont('Japanese',buffer,face).font('Japanese');
  const handle=await open(tmp,'wx');
  const finished=pipeline(doc,handle.createWriteStream());
  // Attach an immediate rejection handler while synchronous layout is running.
  finished.catch(()=>{});
  try {
    renderReport(doc, blocks);
    const range=doc.bufferedPageRange();
    for(let i=range.start;i<range.start+range.count;i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#647580').text(`seda  |  ${i+1} / ${range.count}`,48,doc.page.height-35,{lineBreak:false});
    }
    doc.end();
    await finished;
    await rename(tmp,dest);
    return {output:dest,pages:range.count};
  } catch(error) {
    doc.destroy(error);
    await finished.catch(()=>{});
    await rm(tmp,{force:true});
    throw error;
  }
}
