'use strict';

const { validateDroppedPaths } = require('./native-share.cjs');

async function chooseDropAction(input, {
  validate = validateDroppedPaths,
  prompt,
  share,
  openQuickChat,
} = {}) {
  if (typeof prompt !== 'function' || typeof share !== 'function' || typeof openQuickChat !== 'function') {
    return { ok: false, code: 'drop-handler-unavailable', message: '拖放操作暂不可用，请重试' };
  }

  const checked = await validate(input);
  const canShare = checked?.ok === true;
  if (!canShare && checked?.code !== 'no-files') return checked || { ok: false, code: 'invalid-drop', message: '无法识别拖入的文件' };

  let action;
  try { action = await prompt({ fileCount: canShare ? checked.files.length : 0, canShare }); }
  catch { return { ok: false, code: 'drop-prompt-failed', message: '无法打开拖放操作选择，请重试' }; }
  if (action === 'cancel' || action == null) return { ok: true, status: 'cancelled' };
  if (action === 'quick-chat') return openQuickChat();
  if (action === 'share') return canShare ? share(checked.files.map(file => file.path)) : checked;
  return { ok: false, code: 'invalid-drop-action', message: '不支持的拖放操作' };
}

module.exports = { chooseDropAction };
