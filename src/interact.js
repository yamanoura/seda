import { createInterface } from 'node:readline';
import { compileDesign, DefinitionError, simulate } from './verifier.js';
import { renderPreview } from './preview.js';
import { keyboardInteract } from './keyboard.js';
import { formatFeedback } from './feedback.js';

// 対話UIだけの入力変換。YAMLテストで指定された型は変更しない。
export function inputValue(field, raw) {
  if (/[\x00-\x1f\x7f-\x9f]/u.test(raw)) throw new DefinitionError('制御文字は入力できません');
  const trimmed = raw.trim();
  if (field.type === 'number' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) return value;
  }
  return raw;
}

export function createSession(spec, view, options = {}) {
  const design = compileDesign(spec, options.screen);
  const settings = { ...options, screen: design.screenId, numbered: true };
  renderPreview(spec, view, settings);
  const ids = view[design.screenId].layout.sections.flatMap(section => section.fields);
  let values = Object.create(null);
  return {
    fields: ids.map(id => design.fields.get(id)),
    render: (focused, draft) => renderPreview(spec, view, { ...settings, values: draft === undefined ? values : { ...values, [focused]: draft }, focused }),
    get: id => Object.hasOwn(values, id) ? String(values[id]) : '',
    set(id, raw) {
      const field = design.fields.get(id);
      if (!field || field.type === 'button') throw new DefinitionError('入力項目を指定してください');
      values[id] = inputValue(field, raw);
    },
    press(id) {
      const field = design.fields.get(id);
      if (field?.type !== 'button') throw new DefinitionError('ボタンを指定してください');
      return simulate(design, field.action, values);
    },
    reset() { values = Object.create(null); },
  };
}

export async function interact(spec, view, options = {}, input = process.stdin, output = process.stdout) {
  const session = createSession(spec, view, options);
  if (input.isTTY && output.isTTY) return keyboardInteract(session, input, output);
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  const write = text => output.write(text);
  const ask = async prompt => {
    write(prompt);
    const { value, done } = await lines.next();
    return done ? null : value;
  };
  const instructions = '番号 + Enter: 項目編集 / ボタン押下 | r: 入力をリセット | q: 終了';
  rl.on('SIGINT', () => rl.close());
  try {
    write('対話ワイヤーフレーム（processは記録のみ・データ保存なし）\n');
    let feedback = '';
    while (true) {
      write(`\n${session.render()}\n${feedback}--- 操作ガイド ---\n${instructions}\n`);
      const selected = await ask('操作 > ');
      if (selected === null || selected.trim() === 'q') break;
      if (selected.trim() === 'r') { session.reset(); feedback = '入力をリセットしました。\n'; continue; }
      if (!/^[1-9]\d*$/u.test(selected.trim())) { feedback = '項目番号、r、qを入力してください。\n'; continue; }
      const field = session.fields[Number(selected.trim()) - 1];
      if (!field) { feedback = '存在する項目番号を選んでください。\n'; continue; }
      if (field.type !== 'button') {
        const value = await ask(`${field.label}（空Enterで空欄） > `);
        if (value === null) break;
        try { session.set(field.id, value); feedback = ''; }
        catch (error) { feedback = `${error.message}\n`; }
      } else {
        const result = session.press(field.id);
        feedback = formatFeedback(result);
      }
    }
    write('\n終了しました。\n');
  } finally { rl.close(); }
}
