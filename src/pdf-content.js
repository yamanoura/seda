import { loadApplication, composeScreen } from './application.js';
import { compileDesign, readYaml } from './verifier.js';
import { renderPreview } from './preview.js';

const types = {text:'文字列',number:'数値',boolean:'はい／いいえ',button:'ボタン'};
const literal = x => x === '' ? '未入力' : x === null ? '値なし' : typeof x === 'object' ? JSON.stringify(x) : String(x);
const ruleText = v => v.condition.operator === 'empty' ? (v.condition.expected ? '空欄にする' : '必須') : (v.condition.expected ? '数値を入力' : '数値以外を入力');

// Customer-facing content is derived separately from the complete technical appendix.
export async function buildHumanReport(options, technical) {
  const {project, design, screen, test} = options;
  let screens;
  if (design) {
    const spec=await readYaml(design), id=screen ?? Object.keys(spec)[0];
    screens=[{screen:id,spec,design:compileDesign(spec,id),testFile:test}];
  } else screens=await loadApplication(project,{requireViews:false});
  const selected=screens.filter(s=>!screen || screen===s.screen);
  const name = s => s.view?.[s.screen]?.title ?? s.spec[s.screen].description ?? '画面（名称未記載）';
  const destination = target => {
    const s=screens.find(s=>s.screen===(screens.routes?.get(target) ?? target));
    return s ? name(s) : '移動先（詳細は付録）';
  };
  const blocks=[];
  const add=(kind,text,extra={})=>blocks.push({kind,text,...extra});
  const table=(headers,rows,widths)=>add('table','',{headers,rows,widths});
  add('title',technical[0].text);
  add('subtitle','画面と操作の設計書');
  add('note','画面遷移図と、各画面の仕様概要・ワイヤーフレーム・項目定義仕様・仕様詳細を掲載しています。確認例は設計上の期待値で、実行結果ではありません。');
  add('heading','この設計書に含まれる画面');
  table(['画面','できる操作'],selected.map(s=>[name(s),[...s.design.fields.values()].filter(f=>f.type==='button').map(f=>f.label).join(' ／ ')]),[0.44,0.56]);

  function context(spec,compiled,hook) {
    const fields=[...compiled.fields.values()].filter(f=>f.id!=='__seda_before_each__');
    const byId=new Map(fields.map(f=>[f.id,f]));
    const actions=new Map(spec.actions.map(a=>[a.id,a]));
    const checks=new Map((spec.validations ?? []).map(v=>[v.id,v]));
    const received=id=>fields.find(f=>f.source?.input===id)?.label ?? '受信値（詳細は付録）';
    const source=(r,parent={})=> {
      if(r && 'field' in r) return {text:byId.get(r.field)?.label ?? '画面の値', field:r.field};
      if(r && 'input' in r) return parent[r.input] ?? {text:received(r.input)};
      if(r && 'literal' in r) return {text:`固定値「${literal(r.literal)}」`};
      return {text:'先行処理の結果（詳細は付録）'};
    };
    const bindings=(action,passed,parent={})=>Object.fromEntries(Object.entries(passed ?? (Array.isArray(action.inputs) ? Object.fromEntries(action.inputs.filter(x=>typeof x==='string').map(x=>[x,{field:x}])) : action.inputs) ?? {}).map(([k,v])=>[k,source(v,parent)]));
    const flows=[], rules=[];
    function walk(action,args,inherited=[],nested=false,depth=0) {
      if(depth>30) throw new Error('PDFの処理呼び出し階層が深すぎます');
      const nodes=[];
      for(const step of action.steps) {
        const conditions=[...inherited];
        if(step.when) {
          const equal=Object.hasOwn(step.when,'equals');
          conditions.push(`${source(step.when,args).text}が「${literal(equal?step.when.equals:step.when.not_equals)}」と${equal?'等しい':'等しくない'}`);
        }
        const node={title:'',detail:'',conditions};
        if(step.type==='validation') {
          const rowRules=step.rules.map(r=>{
            const v=checks.get(r.validation), binding=args[r.target] ?? {text:'入力値（詳細は付録）'};
            // The runtime substitutes the source field label, or the argument ID for constants.
            const message=v.message.template.replaceAll('{label}',binding.field ? byId.get(binding.field)?.label ?? r.target : r.target);
            const row={field:binding.field,label:binding.text,rule:ruleText(v),message,shown:!!step.on_error,conditions};
            rules.push(row);return row;
          });
          node.title='入力内容をチェック';
          node.detail=rowRules.map(r=>`${r.label}: ${r.rule}`).join('\n');
          node.failure=rowRules.some(r=>r.shown) ? '入力エラーを表示して終了\n文言は入力チェック表を参照' : 'チェック不適合で終了\n画面表示の指定なし';
        } else if(step.type==='process') {
          const called=actions.get(step.action);
          nodes.push(...walk(called,bindings(called,step.inputs,args),conditions,true,depth+1));
          continue;
        } else if(step.type==='transition') {
          node.title=`${destination(step.target)}へ移動`;
          node.target=step.target;
          const target=screens.find(s=>s.screen===(screens.routes?.get(step.target) ?? step.target));
          node.detail=Object.entries(step.inputs ?? {}).map(([k,r])=>`${source(r,args).text}を「${target ? [...target.design.fields.values()].find(f=>f.source?.input===k)?.label ?? '受信値' : '受信値'}」として引き継ぐ`).join('\n');
          node.terminal=true;
        } else if(step.type==='message') {
          node.title='画面にメッセージを表示';node.detail=step.message;
        } else if(step.type==='debug') {
          node.title='確認用ログを記録';node.detail='画面には表示しません。データの保存処理ではありません。';node.technical=true;
        } else if(step.type==='return') {
          node.title=nested?'結果を呼び出し元に返す':'結果を返して終了';node.terminal=!nested;
        } else if(step.type==='db' || step.type.startsWith('db.')) {
          const op=step.operation ?? step.type;
          node.title=({findUnique:'データを1件検索',findMany:'データを一覧検索',create:'データを登録',update:'データを1件更新',updateMany:'該当データをまとめて更新','db.select':'データを検索','db.insert':'データを登録','db.update':'データを更新'})[op];
          node.detail='対象データ・検索条件・保存内容は付録に記載。';
        }
        nodes.push(node);
      }
      return nodes;
    }
    const entries=fields.filter(f=>f.type==='button');
    if(hook) entries.unshift({label:'画面を表示する前',action:hook.action,inputs:hook.inputs});
    for(const button of entries) {
      const action=actions.get(button.action), start=rules.length;
      const nodes=walk(action,bindings(action,button.inputs));
      flows.push({button:button.label,nodes,rules:rules.slice(start).map(r=>({...r,button:button.label}))});
    }
    return {fields,byId,checks,flows,rules};
  }
  const contexts=new Map(selected.map(s=>[s.screen,context(s.spec[s.screen],s.design)]));
  const common=screens.app?context(screens.app.spec,screens.app.design,screens.app.before_each):undefined;
  if(screens.app) {
    add('heading','全画面共通の動作');
    const c=common;
    for(const flow of c.flows) add('flow',flow.button==='画面を表示する前'?flow.button:`「${flow.button}」を押したとき`,flow);
    add('note','各画面の表示前に共通処理を実行します。処理内容と受け渡す値は付録に記載しています。');
  }
  add('diagramPage','画面遷移図');
  add('caption','矢印はYAMLに定義された移動先です。入力チェックや条件により移動しない場合があります。実行条件・処理順は各画面の仕様詳細を参照してください。');
  const edges=[];
  for(const s of selected) {
    const ctx=contexts.get(s.screen);
    for(const flow of [...ctx.flows,...(common?.flows ?? [])]) {
      for(const node of flow.nodes.filter(n=>n.target!==undefined)) {
        edges.push({from:name(s),to:destination(node.target),label:flow.button==='画面を表示する前'?'表示前の共通処理':`「${flow.button}」操作`,conditional:node.conditions.length>0,conditions:node.conditions});
      }
    }
  }
  if(edges.length) add('transitions','',{edges});
  else add('note','画面遷移の定義はありません。');
  for(const [index,s] of selected.entries()) {
    const spec=s.spec[s.screen], c=contexts.get(s.screen);
    add('page',`${String(index+1).padStart(2,'0')}  ${name(s)}`);
    add('heading','画面仕様概要');
    table(['観点','仕様概要'],[
      ['画面の説明',spec.description ?? '未記載'],
      ['主な操作',c.flows.map(f=>f.button).join(' ／ ') || '定義なし'],
      ['受け取る値',(spec.inputs ?? []).map(p=>`${c.fields.find(f=>f.source?.input===p.id)?.label ?? '受信値（名称は付録）'}（${types[p.type]}・${p.required?'受け渡し必須':'省略可'}）`).join('、') || '定義なし'],
    ],[0.23,0.77]);
    add('heading','画面レイアウト（ワイヤーフレーム）');
    if(s.view) {
      const composed=composeScreen(s,screens.app);
      // Reuse preview validation without executing actions, route hooks, or database operations.
      renderPreview(composed.spec,composed.view,{screen:s.screen,databaseSchema:screens.databaseSchema});
      const cd=compileDesign(composed.spec,s.screen,screens.databaseSchema);
      add('wireframe',name(s),{fields:[...cd.fields.values()],view:composed.view[s.screen]});
      add('caption','デスクトップ配置の概略図です。色・寸法・文字サイズは実際の画面とは異なります。長い名称は図のみ省略し、横並びの項目は紙幅に合わせて折り返します。');
    } else {
      add('wireframe',name(s),{fields:c.fields,view:{layout:{direction:'vertical',sections:[{fields:c.fields.map(f=>f.id)}]}}});
      add('caption','配置指定がないため、項目の定義順で表示しています。');
    }
    add('specPage',`${String(index+1).padStart(2,'0')}  ${name(s)} / 項目定義仕様`);
    add('heading','画面の項目定義仕様');
    add('caption','長さは文字数・桁数の制限です。現行のseda記法には長さの指定がないため「未定義」と表示します。無制限であることを保証するものではありません。');
    table(['項目','型','長さ','編集仕様','初期表示・入力ルール'],c.fields.map(f=>{
      const rr=c.flows.flatMap(flow=>flow.rules.filter(r=>r.field===f.id).map(r=>`${r.rule}（「${flow.button}」操作時${r.conditions.length?'・条件付き':''}）`));
      const origin=f.source?['画面が受け取った値を初期表示']:[];
      return [f.label,types[f.type],f.type==='button'?'対象外':'未定義',f.type==='button'?'押下操作':f.readonly?'表示のみ（編集不可）':'入力・変更可',[...new Set(rr),...origin].join('\n') || (f.type==='button'?'処理は画面仕様詳細を参照':'初期値・チェックの指定なし')];
    }),[0.16,0.12,0.12,0.21,0.39]);
    for(const flow of c.flows) {
      if(flow.rules.length) {
        add('heading',`「${flow.button}」操作時の入力チェック`);
        table(['チェックする内容','不適合時の文言'],flow.rules.map(r=>[`${r.label}: ${r.rule}${r.conditions.length?'\n条件: '+r.conditions.join('、かつ '):''}`,`${r.message}${r.shown?'':'\n（画面表示の指定なし）'}`]),[0.48,0.52]);
      }
    }
    add('operationPage',`${String(index+1).padStart(2,'0')}  ${name(s)} / 画面仕様詳細`);
    add('heading','画面仕様詳細');
    add('caption','矢印の順に進みます。条件付きの枠は条件を満たす場合のみ実行します。移動・終了した場合は後続へ進みません。');
    for(const flow of c.flows) {
      add('flow',`「${flow.button}」を押したとき`,flow);

    }
    add('heading','入力と期待する動作');
    add('caption','設計上の期待値・未実行。内部ログや呼び出し順などの詳細な期待値は付録に記載しています。');
    if(s.testFile) {
      const tests=(await readYaml(s.testFile)).design_tests;
      const showInputs=o=>Object.entries(o ?? {}).map(([k,v])=>`${c.byId.get(k)?.label ?? c.fields.find(f=>f.source?.input===k)?.label ?? '値（名称は付録）'}: ${literal(v)}`).join('\n');
      table(['確認するケース','入力・操作','期待する動作'],tests.map(t=>{
        const candidates=c.fields.filter(f=>f.type==='button' && f.action===t.action);
        const button=c.byId.get(t.button) ?? (candidates.length===1?candidates[0]:undefined);
        const inputs=[t.screen_inputs ? '受信値\n'+showInputs(t.screen_inputs):'',showInputs(t.input),button?`「${button.label}」を押す`:'処理を実行（詳細は付録）'].filter(Boolean).join('\n');
        const e=t.expect, lines=[];
        if(e.success!==undefined) lines.push(e.success?'処理が成功する':'処理が失敗する');
        if(e.transition!==undefined) lines.push(e.transition ? `${destination(e.transition.target)}へ移動` : '画面を移動しない');
        for(const r of e.validation_error ?? []) lines.push(`${c.byId.get(r.target)?.label ?? '入力値'}: ${c.checks.has(r.validation)?ruleText(c.checks.get(r.validation)):'入力条件'}の条件を満たさない`);
        if(e.validation_error?.length===0) lines.push('入力エラーなし');
        if(e.messages) lines.push(...(e.messages.length?e.messages.map(m=>`表示: ${m}`):['画面メッセージなし']));
        if(e.field_values) lines.push('画面の値\n'+showInputs(e.field_values));
        if(e.database) lines.push('保存データが期待値に一致（詳細は付録）');
        if(e.db_error?.length) lines.push('データ処理でエラー（詳細は付録）');
        if(e.action_error?.length) lines.push('処理エラー（詳細は付録）');
        if(!lines.length) lines.push('内部処理の結果を確認（詳細は付録）');
        return [t.name ?? '確認例',inputs,lines.join('\n')];
      }),[0.26,0.34,0.40]);
    } else add('note','確認例は定義されていません。');
  }
  add('appendix','付録  技術情報・詳細な期待値');
  add('note','画面ID、処理ID、値の受け渡し、DB条件、内部ログ、テストの完全な期待値を掲載しています。');
  // Retain all original detail after the customer-facing pages; no definitions are discarded.
  for(const b of technical.slice(1)) {
    if(b.kind==='page') blocks.push({...b,kind:'technicalHeading'});
    else if(b.kind==='heading' || b.kind==='subheading') blocks.push({...b,kind:'technicalSubheading'});
    else blocks.push({...b,kind:'technical'});
  }
  return blocks;
}
