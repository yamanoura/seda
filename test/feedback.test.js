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

test('処理到達は自動表示せず、明示的なdebugログを表示する', () => {
  const text = formatFeedback({ success: true, messages: ['登録しました。\x1b'], validation_error: [], processes: ['create_user'], debug_logs: ['登録処理を確認しました。\x1b'] });
  const [messages, debug] = text.split('--- デバッグログ ---');
  assert.match(messages, /登録しました/);
  assert.doesNotMatch(messages, /成功/);
  assert.doesNotMatch(messages, /create_user/);
  assert.match(debug, /登録処理を確認しました/);
  assert.doesNotMatch(messages, /登録処理を確認しました/);
  assert.doesNotMatch(text, /処理到達|create_user/);
  assert.doesNotMatch(text, /\x1b/);
});

test('DBエラーを入力エラーとして二重表示しない', () => {
  const text=formatFeedback({success:false,messages:['DBエラー: users.nameの重複'],validation_error:[],db_error:['SQLITE_CONSTRAINT_UNIQUE'],processes:[]});
  assert.match(text,/DBエラー: users.nameの重複/);
  assert.doesNotMatch(text,/入力エラー/);
});
