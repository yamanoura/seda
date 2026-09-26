import { dirname, resolve } from 'node:path';
import stringWidth from 'string-width';
import { compileDesign, DefinitionError, readYaml } from './verifier.js';

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

export function renderPreview(spec, document, { screen, device = 'desktop', width = 60, values = {}, numbered = false, focused } = {}) {
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
      return prefix + (field.type === 'button' ? `[${text}]` : `${text} [${value}]`);
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
  const inner = Math.max(cell * columns + gap * (columns - 1), stringWidth(label(view.title ?? design.screenId, 'view.title')));
  const rows = [];
  let row = [], used = 0;
  for (const section of sections) {
    if (used + section.span > columns) { rows.push(row); row = []; used = 0; }
    row.push(section); used += section.span;
  }
  if (row.length) rows.push(row);
  const body = [pad(view.title ?? design.screenId, inner), ' '.repeat(inner)];
  rows.forEach((items, index) => {
    if (index) body.push(' '.repeat(inner));
    const height = Math.max(...items.map(s => s.lines.length));
    for (let line = 0; line < height; line++) {
      body.push(pad(items.map(s => pad(s.lines[line] ?? '', cell * s.span + gap * (s.span - 1), s.align)).join(' '.repeat(gap)), inner));
    }
  });
  return ['+' + '-'.repeat(inner + 2) + '+', ...body.map(line => `| ${line} |`), '+' + '-'.repeat(inner + 2) + '+'].join('\n');
}

export async function loadPreviewScreens(filename, options = {}) {
  const project = await readYaml(filename);
  requireValue(Array.isArray(project?.main) && project.main.length, filename, 'mainに画面一覧が必要です');
  const ids = project.main.map(e => e?.id);
  requireValue(ids.every(id => typeof id === 'string' && id) && new Set(ids).size === ids.length, filename, '画面IDが未指定または重複しています');
  const entries = project.main.filter(e => !options.screen || e.id === options.screen);
  requireValue(entries.length > 0, filename, `画面が存在しません: ${options.screen}`);
  const results = [];
  for (const entry of entries) {
    requireValue(entry.type === 'screen', filename, `未対応のtype: ${entry.type}`);
    for (const key of ['spec_file', 'view_file']) requireValue(typeof entry[key] === 'string' && entry[key], filename, `${entry.id}.${key}が必要です`);
    const spec = await readYaml(resolve(dirname(filename), entry.spec_file));
    const view = await readYaml(resolve(dirname(filename), entry.view_file));
    results.push({ screen: entry.id, spec, view });
  }
  return results;
}

export async function previewProject(filename, options) {
  const screens = await loadPreviewScreens(filename, options);
  return screens.map(({ screen, spec, view }) => ({ screen, text: renderPreview(spec, view, { ...options, screen }) }));
}
