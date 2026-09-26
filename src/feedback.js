const safe = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');

// 画面に表示する文言と、設計を追跡する内部情報を別の領域へ出力する。
export function formatFeedback(result) {
  const messages = [result.success ? '成功' : '入力エラー', ...result.messages.map(safe)];
  const debug = result.validation_error.map(e => `${safe(e.target)}: ${safe(e.validation)}`);
  if (result.processes.length) debug.push(`処理到達（模擬）: ${result.processes.map(safe).join(', ')}`);
  return '\n--- 画面メッセージ ---\n' + messages.join('\n')
    + '\n\n--- デバッグログ ---\n' + (debug.length ? debug.join('\n') : 'なし')
    + '\n\n';
}
