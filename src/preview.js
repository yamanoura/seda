import {loadApplication, composeScreen, enterRoute} from './application.js';
import stringWidth from 'string-width';
import { compileDesign, DefinitionError } from './verifier.js';

function requireValue(ok, path, message) {
  if (!ok) throw new DefinitionError(`${path}: ${message}`);
}
function label(value, path) {
  requireValue(typeof value === 'string' && !/[\x00-\x1f\x7f-\x9f]/u.test(value), path, '制御文字を含まない文字列が必要です');
  return value;
}
const pad = (text, width, align = 'left') => {
  const gap = Math.max(0, width - stringWidth(text));
  const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0;
  return ' '.repeat(left) + text + ' '.repeat(gap - left);
};

export function renderPreview(spec, document, { screen, device = 'desktop', width = 60, values = {}, numbered = false, focused, path } = {}) {
  const address = path === undefined ? undefined : `URL [ ${label(path, 'path')} ]`;
  const design = compileDesign(spec, screen);
  const view = document?.[design.screenId];
  requireValue(view && typeof view === 'object', 'view', `画面が存在しません: ${design.screenId}`);
  requireValue(['desktop', 'mobile'].includes(device), 'device', 'desktop / mobile を指定してください');
  requireValue(Number.isInteger(width) && width >= 24 && width <= 200, 'width', '24〜200の整数を指定してください');
  const layout = view.layout;
  requireValue(layout?.type === 'form', 'layout.type', 'formのみ対応しています');
  requireValue(['vertical', 'horizontal'].includes(layout.direction), 'layout.direction', 'vertical / horizontal を指定してください');
  requireValue(Array.isArray(layout.sections) && layout.sections.length, 'layout.sections', '1件以上必要です');
  const columns = view.responsive?.[device]?.columns ?? layout.columns ?? 1;
  requireValue(Number.isInteger(columns) && columns >= 1 && columns <= 4, 'columns', '1〜4の整数を指定してください');
  const ids = new Set();
  const fieldIds = new Set();
  let itemNumber = 0;
  let menu = '';
  if (layout.menu_bar !== undefined) {
    const bar = layout.menu_bar;
    requireValue(bar && typeof bar === 'object' && !Array.isArray(bar), 'layout.menu_bar', 'マッピングが必要です');
    requireValue(Object.keys(bar).every(key => key === 'fields'), 'layout.menu_bar', 'fieldsのみ指定できます');
    requireValue(Array.isArray(bar.fields) && bar.fields.length > 0, 'layout.menu_bar.fields', '1件以上必要です');
    menu = bar.fields.map(id => {
      const field = design.fields.get(id);
      requireValue(field?.type === 'button', 'layout.menu_bar.fields', `ボタン項目を指定してください: ${id}`);
      requireValue(!fieldIds.has(id), 'layout.menu_bar.fields', `項目が重複しています: ${id}`);
      fieldIds.add(id);
      const prefix = (focused === undefined ? '' : focused === id ? '> ' : '  ') + (numbered ? `${++itemNumber}. ` : '');
      return prefix + `[${label(field.label, `layout.menu_bar.${id}`)}]`;
    }).join('  ');
  }
  const sections = layout.sections.map((section, index) => {
    const path = `layout.sections[${index}]`;
    requireValue(typeof section?.id === 'string' && section.id && !ids.has(section.id), path, 'セクションIDが未指定または重複しています');
    ids.add(section.id);
    requireValue(Array.isArray(section.fields) && section.fields.length, path, 'fieldsに1件以上必要です');
    const align = section.align ?? 'left';
    requireValue(['left', 'center', 'right'].includes(align), path, '未対応のalignです');
    const direction = section.direction ?? layout.direction;
    requireValue(['vertical', 'horizontal'].includes(direction), path, '未対応のdirectionです');
    const span = section.column_span ?? 1;
    requireValue(Number.isInteger(span) && span >= 1 && span <= 4, path, 'column_spanは1〜4の整数が必要です');
    const fields = section.fields.map(id => {
      requireValue(design.fields.has(id), path, `項目が存在しません: ${id}`);
      requireValue(!fieldIds.has(id), path, `項目が重複しています: ${id}`);
      fieldIds.add(id);
      const field = design.fields.get(id);
      const text = label(field.label, `${path}.${id}`);
      const prefix = (focused === undefined ? '' : focused === id ? '> ' : '  ') + (numbered ? `${++itemNumber}. ` : '');
      const value = Object.hasOwn(values, id) ? label(String(values[id]), `${path}.${id}.value`) : '________';
      return prefix + (field.type === 'button' ? `[${text}]` : `${text} [${value}]${field.readonly ? ' (読取専用)' : ''}`);
    });
    return { align, span: Math.min(span, columns), lines: [
      ...(section.title === undefined ? [] : [label(section.title, `${path}.title`)]),
      ...(direction === 'horizontal' ? [fields.join('  ')] : fields),
    ] };
  });
  const missing = [...design.fields.keys()].filter(id => !fieldIds.has(id));
  requireValue(!missing.length, 'layout.sections', `未配置の項目: ${missing.join(', ')}`);
  // widthは最小表示幅。内容を切り捨てず、日本語の表示幅に合わせて拡張する。
  const gap = 3;
  const cell = Math.max(Math.ceil((width - 4 - gap * (columns - 1)) / columns),
    ...sections.map(s => Math.ceil((Math.max(...s.lines.map(stringWidth)) - gap * (s.span - 1)) / s.span)));
  const inner = Math.max(cell * columns + gap * (columns - 1), stringWidth(label(view.title ?? design.screenId, 'view.title')), stringWidth(menu), stringWidth(address ?? ''));
  const rows = [];
  let row = [], used = 0;
  for (const section of sections) {
    if (used + section.span > columns) { rows.push(row); row = []; used = 0; }
    row.push(section); used += section.span;
  }
  if (row.length) rows.push(row);
  const body = [pad(view.title ?? design.screenId, inner), ...(menu ? [pad(menu, inner), '-'.repeat(inner)] : []), ' '.repeat(inner)];
  rows.forEach((items, index) => {
    if (index) body.push(' '.repeat(inner));
    const height = Math.max(...items.map(s => s.lines.length));
    for (let line = 0; line < height; line++) {
      body.push(pad(items.map(s => pad(s.lines[line] ?? '', cell * s.span + gap * (s.span - 1), s.align)).join(' '.repeat(gap)), inner));
    }
  });
  const border = '+' + '-'.repeat(inner + 2) + '+';
  return [border, ...(address === undefined ? [] : [`| ${pad(address, inner)} |`, border]), ...body.map(line => `| ${line} |`), border].join('\n');
}

export async function loadPreviewScreens(filename, options = {}) {
  const screens = await loadApplication(filename);
  if (options.screen && !screens.some(s => s.screen === options.screen)) throw new DefinitionError(`画面が存在しません: ${options.screen}`);
  if (!options.screen) return screens;
  const selected = screens.filter(s => s.screen === options.screen);
  selected.app=screens.app; selected.routes=screens.routes; selected.catalog=screens.catalog;
  return selected;
}

export async function previewProject(filename, options = {}) {
  const screens = await loadPreviewScreens(filename);
  if (screens.app) {
    const path = options.path ?? (options.screen ? [...screens.routes].find(([,id]) => id === options.screen)?.[0] : '/');
    if (!path) throw new DefinitionError(`画面が存在しません: ${options.screen}`);
    const entered=enterRoute(screens,path);
    renderPreview(entered.screen.spec,entered.screen.view,{...options,screen:entered.screen.screen});
    const {spec,view}=composeScreen(entered.screen,screens.app);
    return [{screen:entered.screen.screen,path:entered.path,common_results:entered.hooks,text:renderPreview(spec,view,{...options,screen:entered.screen.screen,path:entered.path})}];
  }
  if (options.path) throw new DefinitionError('--pathにはproject.yamlのroutesが必要です');
  const selected=screens.filter(s=>!options.screen || s.screen===options.screen);
  if (!selected.length) throw new DefinitionError(`画面が存在しません: ${options.screen}`);
  return selected.map(({screen,spec,view})=>({screen,text:renderPreview(spec,view,{...options,screen})}));
}
