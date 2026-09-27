const C={ink:'#203545',muted:'#617480',accent:'#176b78',line:'#d7e2e7',pale:'#f0f6f8',blue:'#e6f3f4',red:'#934e41',rose:'#fbf0ec'};

export function renderReport(doc,blocks) {
  const left=48, width=doc.page.width-96, bottom=()=>doc.page.height-55;
  let section='画面と操作の設計書';
  const header=()=>{
    const y=doc.y;
    let label=`SEDA  /  ${section}`;
    doc.fontSize(8);
    while(doc.widthOfString(label)>width-10) label=label.slice(0,-2)+'…';
    doc.fillColor(C.muted).text(label,left,25,{width,lineBreak:false});
    doc.moveTo(left,40).lineTo(left+width,40).strokeColor(C.line).lineWidth(0.6).stroke();
    doc.x=left;doc.y=Math.max(y,54);
  };
  doc.on('pageAdded',header);
  header();
  const room=h=>{if(doc.y+h>bottom()) doc.addPage();};
  const lines=(text,w,size)=>{
    doc.fontSize(size);
    const result=[];
    for(const paragraph of String(text ?? '').split('\n')) {
      let row='';
      for(const char of paragraph) {
        if(row && doc.widthOfString(row+char)>w) {result.push(row);row='';}
        row+=char;
      }
      result.push(row);
    }
    return result;
  };
  const lineText=(text,x,y,size,color=C.ink)=>doc.fontSize(size).fillColor(color).text(text,x,y,{lineBreak:false});
  const paragraph=(text,{size=11,color=C.ink,gap=9}={})=>{
    for(const line of lines(text,width,size)) {
      room(size+7);const y=doc.y;lineText(line,left,y,size,color);doc.y=y+size+6;
    }
    doc.y+=gap;doc.x=left;
  };
  const heading=(text,size=15)=>{room(size+75);paragraph(text,{size,color:C.accent,gap:8});};
  const box=(x,y,w,h,fill,stroke=C.line)=>doc.roundedRect(x,y,w,h,5).fillAndStroke(fill,stroke);

  function table(block) {
    const widths=(block.widths ?? block.headers.map(()=>1/block.headers.length)).map(v=>v*width);
    const font=10,lh=15,pad=9;
    function row(cells,head=false) {
      let pending=cells.map((v,i)=>lines(v,widths[i]-pad*2,font));
      while(pending.some(a=>a.length)) {
        let available=Math.floor((bottom()-doc.y-pad*2)/lh);
        if(available<2) {doc.addPage();if(!head) drawHeader();available=Math.floor((bottom()-doc.y-pad*2)/lh);}
        const max=Math.max(...pending.map(a=>a.length));
        // Keep ordinary rows intact. Split exceptionally long cells, repeating headers.
        if(max>available && max*lh+pad*2<doc.page.height-170) {
          doc.addPage();if(!head) drawHeader();available=Math.floor((bottom()-doc.y-pad*2)/lh);
        }
        const count=Math.min(max,available),h=count*lh+pad*2,y=doc.y;
        let x=left;
        cells.forEach((_,i)=>{
          doc.rect(x,y,widths[i],h).fillAndStroke(head?C.accent:'#ffffff',C.line);
          pending[i].splice(0,count).forEach((text,j)=>lineText(text,x+pad,y+pad+j*lh,font,head?'#ffffff':C.ink));
          x+=widths[i];
        });
        doc.x=left;doc.y=y+h;
        if(pending.some(a=>a.length)) {doc.addPage();if(!head) drawHeader();}
      }
    }
    function drawHeader(){row(block.headers,true);}
    room(90);drawHeader();
    for(const cells of block.rows) row(cells);
    if(!block.rows.length) row(block.headers.map((_,i)=>i===0?'該当する項目なし':''));
    doc.y+=16;
  }

  function flow(block) {
    const fullHeight=block.nodes.reduce((sum,n)=>sum+Math.max(60,lines([...n.conditions,n.title,n.detail].filter(Boolean).join('\n'),(n.failure?width*0.60:width)-32,10.5).length*16+44)+29,40);
    if(fullHeight<doc.page.height-120) room(fullHeight);
    heading(block.text,12);
    for(const [index,node] of block.nodes.entries()) {
      const cardWidth=node.failure?width*0.60:width;
      const condition=node.conditions.length ? '条件: '+node.conditions.join('、かつ ')+'\n（満たす場合のみ。満たさない場合は次へ）\n' : '';
      const content=lines(`${condition}${node.title}${node.detail?'\n'+node.detail:''}`,cardWidth-32,10.5);
      let first=true;
      while(content.length) {
        room(95);
        const available=Math.max(1,Math.floor((bottom()-doc.y-44)/16));
        const take=Math.min(content.length,available),h=Math.max(node.failure?84:60,take*16+28),y=doc.y;
        box(left,y,cardWidth,h,node.technical?C.pale:C.blue);
        for(const [i,l] of content.splice(0,take).entries()) lineText(l,left+16,y+13+i*16,10.5);
        if(node.failure && first) {
          const x=left+cardWidth+26,w=width-cardWidth-26;
          const failureLines=lines('不適合\n'+node.failure,w-18,9);
          box(x,y,w,Math.max(h,failureLines.length*14+20),C.rose);
          failureLines.forEach((l,i)=>lineText(l,x+9,y+10+i*14,9,C.red));
          const cy=y+22;
          doc.moveTo(left+cardWidth,cy).lineTo(x-3,cy).strokeColor(C.red).lineWidth(1).stroke();
          doc.moveTo(x-8,cy-3).lineTo(x-3,cy).lineTo(x-8,cy+3).stroke();
        }
        doc.y=y+h;doc.x=left;
        if(content.length) {doc.addPage();first=false;continue;}
      }
      if(index<block.nodes.length-1) {
        if(doc.y+124>bottom()) {
          if(doc.y+16<bottom()) lineText('次ページへ続く',left,doc.y+3,8,C.muted);
          doc.addPage();heading(block.text+'（続き）',12);
          continue;
        }
        room(29);const y=doc.y,x=left+cardWidth/2;
        doc.moveTo(x,y+3).lineTo(x,y+22).strokeColor(C.accent).lineWidth(1).stroke();
        doc.moveTo(x-4,y+17).lineTo(x,y+22).lineTo(x+4,y+17).stroke();
        const label=node.failure?'問題なし':node.terminal?'移動・終了しなかった場合':'';
        if(label) lineText(label,x+10,y+6,8,C.muted);
        doc.y=y+29;
      } else doc.y+=15;
    }
  }

  function transitions(block) {
    for(const edge of block.edges) {
      const side=width*0.31, middle=width-side*2, lh=16;
      const from=lines(edge.from,side-24,11),to=lines(edge.to,side-24,11);
      const trigger=lines(edge.label+(edge.conditional?'\n（条件付き）':''),middle-20,9);
      const h=Math.max(from.length*lh,to.length*lh,trigger.length*14+30)+26;
      if(h>doc.page.height-140) {
        table({headers:['移動元','操作','移動先'],rows:[[edge.from,edge.label+(edge.conditional?'（条件付き）':''),edge.to]],widths:[0.31,0.38,0.31]});
        continue;
      }
      room(h+22);const y=doc.y;
      box(left,y,side,h,C.pale);box(left+width-side,y,side,h,C.blue);
      from.forEach((l,i)=>lineText(l,left+12,y+13+i*lh,11));
      to.forEach((l,i)=>lineText(l,left+width-side+12,y+13+i*lh,11));
      const cy=y+h-16,x1=left+side+6,x2=left+width-side-6;
      trigger.forEach((l,i)=>lineText(l,x1+4,y+10+i*14,9,C.accent));
      doc.moveTo(x1,cy).lineTo(x2,cy).strokeColor(C.accent).lineWidth(1).stroke();
      doc.moveTo(x2-5,cy-4).lineTo(x2,cy).lineTo(x2-5,cy+4).stroke();
      doc.y=y+h+22;doc.x=left;
    }
  }

  function wireframe(block) {
    const fields=new Map(block.fields.map(f=>[f.id,f]));
    const layout=block.view.layout, columns=block.view.responsive?.desktop?.columns ?? layout.columns ?? 1;
    let menu=(layout.menu_bar?.fields ?? []).map(id=>fields.get(id)?.label).join('　／　');
    let continued=false;
    const start=()=>{
      room(125);const y=doc.y;
      box(left,y,width,38,C.pale);
      lineText(block.text+(continued?'（続き）':''),left+14,y+10,12,C.accent);
      doc.y=y+47;
      if(menu) {paragraph('メニュー: '+menu,{size:9,color:C.muted,gap:5});}
    };
    start();
    const gap=12;
    let packed=[],used=0;
    const drawPacked=()=>{
      if(!packed.length)return;
      const groups=packed.map(({s,span})=>{
        const w=(width-gap*(columns-1))*span/columns+gap*(span-1);
        const horizontal=(s.direction ?? layout.direction)==='horizontal';
        const items=s.fields.map(id=>fields.get(id));
        const count=horizontal?Math.max(1,Math.min(3,Math.floor(w/100))):1;
        const rows=[];for(let i=0;i<items.length;i+=count) rows.push(items.slice(i,i+count));
        const rendered=rows.map(row=>{
          const cellW=(w-gap*(row.length-1))/row.length;
          const cells=row.map(f=>({field:f,lines:lines(Array.from(f.label).length>48?Array.from(f.label).slice(0,48).join('')+'…':f.label,cellW-18,10)}));
          return {cells,cellW,height:Math.max(...cells.map(c=>c.lines.length))*14+39};
        });
        return {s,w,rows:rendered};
      });
      for(const g of groups) if(g.s.title && Array.from(g.s.title).length>48) g.s={...g.s,title:Array.from(g.s.title).slice(0,48).join('')+'…'};
      const titleHeight=Math.max(...groups.map(g=>g.s.title?lines(g.s.title,g.w,10).length*14+8:0));
      const maxRows=Math.max(...groups.map(g=>g.rows.length));
      for(let r=0;r<maxRows;r++) {
        const h=Math.max(...groups.map(g=>g.rows[r]?.height ?? 0))+(r===0?titleHeight:0);
        if(doc.y+h>bottom()) {doc.addPage();continued=true;start();}
        const y=doc.y;let x=left;
        for(const g of groups) {
          if(r===0 && g.s.title) lines(g.s.title,g.w,10).forEach((l,i)=>lineText(l,x,y+i*14,10,C.accent));
          const row=g.rows[r];
          if(row) row.cells.forEach((cell,i)=>{
            let cx=x+i*(row.cellW+gap);const cy=y+(r===0?titleHeight:0),f=cell.field;
            const buttonWidth=Math.min(row.cellW,Math.max(100,...cell.lines.map(l=>doc.fontSize(10).widthOfString(l)+24)));
            if(f.type==='button' && row.cells.length===1) {
              const align=g.s.align ?? 'left';
              cx+=align==='right'?row.cellW-buttonWidth:align==='center'?(row.cellW-buttonWidth)/2:0;
            }
            const textH=cell.lines.length*14;
            if(f.type==='button') {
              box(cx,cy,buttonWidth,textH+19,C.accent,C.accent);
              cell.lines.forEach((l,j)=>lineText(l,cx+9,cy+8+j*14,10,'#ffffff'));
            } else {
              cell.lines.forEach((l,j)=>lineText(l,cx,cy+j*14,10));
              box(cx,cy+textH+3,row.cellW,25,f.readonly?C.pale:'#ffffff');
              const hint=f.readonly?'受信値を表示':f.type==='number'?'数値を入力':'入力してください';
              // Short narrow fields use a neutral blank, avoiding overflowing placeholders.
              if(doc.fontSize(8).widthOfString(hint)<row.cellW-18) lineText(hint,cx+9,cy+textH+10,8,C.muted);
            }
          });
          x+=g.w+gap;
        }
        doc.y=y+h+6;doc.x=left;
      }
      packed=[];used=0;
    };
    for(const s of layout.sections) {
      const span=Math.min(s.column_span ?? 1,columns);
      if(used+span>columns) drawPacked();
      packed.push({s,span});used+=span;
      if(used===columns) drawPacked();
    }
    drawPacked();doc.y+=6;
  }

  for(const block of blocks) {
    if(block.kind==='page' || block.kind==='operationPage' || block.kind==='specPage' || block.kind==='diagramPage' || block.kind==='appendix') {
      section=block.text;doc.addPage();heading(block.text,21);continue;
    }
    if(block.kind==='table') {table(block);continue;}
    if(block.kind==='transitions') {transitions(block);continue;}
    if(block.kind==='flow') {flow(block);continue;}
    if(block.kind==='wireframe') {wireframe(block);continue;}
    if(block.kind==='title') {paragraph(block.text,{size:25,color:C.accent,gap:10});continue;}
    if(block.kind==='subtitle') {paragraph(block.text,{size:15,color:C.muted,gap:17});continue;}
    if(block.kind==='heading') {heading(block.text);continue;}
    if(block.kind==='technicalHeading') {heading(block.text,14);continue;}
    if(block.kind==='technicalSubheading') {heading(block.text,10);continue;}
    if(block.kind==='note') {
      const ls=lines(block.text,width-26,10),h=ls.length*16+22;room(h+10);const y=doc.y;
      box(left,y,width,h,C.pale);
      ls.forEach((l,i)=>lineText(l,left+13,y+11+i*16,10,C.muted));
      doc.y=y+h+15;doc.x=left;continue;
    }
    paragraph(block.text,{size:block.kind==='technical'?8.5:block.kind==='caption'?9:11,color:block.kind==='caption'?C.muted:C.ink,gap:block.kind==='technical'?4:10});
  }
  doc.removeListener('pageAdded',header);
}
