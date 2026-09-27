const safe = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ');

// 画面に表示する文言と、設計を追跡する内部情報を別の領域へ出力する。
export function formatFeedback(result) {
  const messages = [...(result.success || result.db_error?.length || result.action_error?.length ? [] : ['入力エラー']), ...result.messages.map(safe)];
  const debug = result.validation_error.map(e => `${safe(e.target)}: ${safe(e.validation)}`);
  debug.push(...(result.debug_logs ?? []).map(safe));
  if (result.transition) debug.push(`画面遷移: ${safe(result.transition.target)}`);
  return '\n--- 画面メッセージ ---\n' + messages.join('\n')
    + '\n\n--- デバッグログ ---\n' + (debug.length ? debug.join('\n') : 'なし')
    + '\n\n';
}
