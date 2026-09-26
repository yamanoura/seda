import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFeedback } from '../src/feedback.js';

test('入力エラー文言と検証IDを別領域に表示する', () => {
  const text = formatFeedback({ success: false, messages: ['名前を入力してください。'], validation_error: [{ target: 'name', validation: 'required' }], processes: [] });
  const [messages, debug] = text.split('--- デバッグログ ---');
  assert.match(messages, /画面メッセージ/);
  assert.match(messages, /名前を入力してください/);
  assert.doesNotMatch(messages, /name: required/);
  assert.match(debug, /name: required/);
  assert.doesNotMatch(debug, /名前を入力してください/);
});

test('成功メッセージと処理到達を分離し、制御文字を無効化する', () => {
  const text = formatFeedback({ success: true, messages: ['登録しました。\x1b'], validation_error: [], processes: ['create_user'] });
  const [messages, debug] = text.split('--- デバッグログ ---');
  assert.match(messages, /登録しました/);
  assert.doesNotMatch(messages, /create_user/);
  assert.match(debug, /処理到達（模擬）: create_user/);
  assert.doesNotMatch(text, /\x1b/);
});
