import { emitKeypressEvents } from 'node:readline';
import { formatFeedback } from './feedback.js';

const graphemes = text => Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text), s => s.segment);
const safe = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');

export function keyboardController(session) {
  let focus = 0, editing = false, draft = [], cursor = 0, feedback = session.entryFeedback ? formatFeedback(session.entryFeedback) : '', done = false;
  const field = () => session.fields[focus];
  const commit = () => {
    session.set(field().id, draft.join(''));
    editing = false;
    feedback = '';
  };
  const move = delta => { focus = (focus + delta + session.fields.length) % session.fields.length; };
  return {
    state: () => ({ focus, editing, draft: draft.join(''), cursor, done, feedback }),
    render() {
      const edit = editing ? `編集中: ${safe(field().label)} [${draft.slice(0, cursor).join('')}│${draft.slice(cursor).join('')}]\nEnter: 確定 | Esc: 取消 | ←→: カーソル | Tab: 確定して次へ` : 'Tab / ↓→: 次へ | Shift+Tab / ↑←: 前へ | Enter: 編集・押下 | r: リセット | q: 終了';
      return `対話ワイヤーフレーム（${session.databaseInfo ?? 'processは模擬・保存なし'}）\n${session.render(field().id, editing ? draft.join('') : undefined)}\n${feedback}--- 操作ガイド ---\n${edit}\nCtrl+C: 終了`;
    },
    key(text, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) { done = true; return; }
      try {
        if (editing) {
          if (key.name === 'escape') { editing = false; return; }
          if (key.name === 'return' || key.name === 'enter') { commit(); return; }
          if (key.name === 'tab') { commit(); move(key.shift ? -1 : 1); return; }
          if (key.name === 'left') { cursor = Math.max(0, cursor - 1); return; }
          if (key.name === 'right') { cursor = Math.min(draft.length, cursor + 1); return; }
          if (key.name === 'home') { cursor = 0; return; }
          if (key.name === 'end') { cursor = draft.length; return; }
          if (key.name === 'backspace') { if (cursor) draft.splice(--cursor, 1); return; }
          if (key.name === 'delete') { draft.splice(cursor, 1); return; }
          if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f-\x9f]/u.test(text)) {
            const parts = graphemes(text); draft.splice(cursor, 0, ...parts); cursor += parts.length;
          }
          return;
        }
        if (text === 'q') { done = true; return; }
        if (text === 'r') { session.reset(); focus = 0; feedback = '入力をリセットしました。\n' + (session.entryFeedback ? formatFeedback(session.entryFeedback) : ''); return; }
        if (key.name === 'tab') { move(key.shift ? -1 : 1); return; }
        if (['down', 'right'].includes(key.name)) { move(1); return; }
        if (['up', 'left'].includes(key.name)) { move(-1); return; }
        if (key.name === 'return' || key.name === 'enter') {
          if (field().readonly) { feedback = '読み取り専用です。\n'; return; }
          if (field().type !== 'button') {
            draft = graphemes(session.get(field().id)); cursor = draft.length; editing = true;
          } else {
            const result = session.press(field().id);
            feedback = formatFeedback(result);
            if (result.transition) focus = 0;
          }
        }
      } catch (error) { feedback = `${safe(error.message)}\n`; }
    },
  };
}

export async function keyboardInteract(session, input, output) {
  const controller = keyboardController(session);
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.readableFlowing !== true;
  emitKeypressEvents(input);
  await new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = error => {
      if (finished) return;
      finished = true;
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      output.removeListener('resize', draw);
      process.removeListener('SIGTERM', onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
      error ? reject(error) : resolve();
    };
    const draw = () => {
      try { output.write(`\x1b[H\x1b[2J${controller.render()}\n`); }
      catch (error) { cleanup(error); }
    };
    const onEnd = () => cleanup();
    const onError = error => cleanup(error);
    const onKey = (text, key) => {
      controller.key(text, key);
      if (controller.state().done) cleanup(); else draw();
    };
    input.on('keypress', onKey);
    input.on('end', onEnd);
    input.on('error', onError);
    output.on('resize', draw);
    process.on('SIGTERM', onEnd);
    try {
      input.setRawMode(true);
      input.resume();
      output.write('\x1b[?1049h\x1b[?25l');
      draw();
    } catch (error) { cleanup(error); }
  });
  output.write('終了しました。\n');
}
