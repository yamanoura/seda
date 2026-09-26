import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readYaml } from '../src/verifier.js';
import { createSession } from '../src/interact.js';
import { keyboardController, keyboardInteract } from '../src/keyboard.js';
const spec = await readYaml('design-yaml/features/screen01/screen01.spec.yaml');
const view = await readYaml('design-yaml/features/screen01/screen01.view.yaml');

test('フォーカス循環、日本語編集、取消、修正、ボタン押下', () => {
  const session = createSession(spec, view), ui = keyboardController(session);
  const key = (name, extra = {}) => ui.key('', { name, ...extra });
  key('tab', { shift: true }); assert.equal(ui.state().focus, 2);
  key('return'); assert.match(ui.state().feedback, /入力エラー/);
  key('down'); assert.equal(ui.state().focus, 0);
  key('return'); ui.key('山田😀'); key('backspace');
  assert.equal(ui.state().draft, '山田');
  key('home'); ui.key('新'); key('right'); key('delete');
  assert.equal(ui.state().draft, '新山');
  key('escape'); assert.equal(session.get('name'), '');
  key('return'); ui.key('山田太郎'); key('tab');
  assert.equal(session.get('name'), '山田太郎');
  assert.equal(ui.state().focus, 1);
  key('return'); ui.key('30'); key('return'); key('right'); key('return');
  assert.match(ui.state().feedback, /登録しました/);
  assert.match(ui.render(), /> 3\. \[登録\]/);
  key('left'); key('return'); ui.key('q'); assert.equal(ui.state().done, false);
  key('escape'); ui.key('r'); assert.equal(session.get('age'), '');
  ui.key('q'); assert.equal(ui.state().done, true);
});

test('TTYのrawモード・カーソル・リスナーを終了時に復元する', async () => {
  for (const finish of ['q', 'ctrl-c', 'eof']) {
    const input = new PassThrough(), output = new PassThrough();
    input.isRaw = false; input.setRawMode = value => { input.isRaw = value; };
    let printed = ''; output.on('data', chunk => { printed += chunk; });
    const running = keyboardInteract(createSession(spec, view), input, output);
    assert.equal(input.isRaw, true);
    if (finish === 'eof') input.end();
    else input.emit('keypress', finish === 'q' ? 'q' : '\x03', finish === 'q' ? { name: 'q' } : { name: 'c', ctrl: true });
    await running;
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('keypress'), 0);
    assert.match(printed, /\x1b\[\?25h\x1b\[\?1049l/);
  }
});
