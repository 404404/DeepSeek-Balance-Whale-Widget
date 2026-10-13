'use strict';

(function publish(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhaleQuickChatConfig = api;
})(typeof globalThis === 'object' ? globalThis : this, function createQuickChatConfig() {
  const DEFAULT_CHAT_CONFIG = Object.freeze({ version: 2, provider: 'deepseek', customUrl: '', customName: '' });
  const STORAGE_KEY = 'dshw-quick-chat';
  const PRESETS = Object.freeze({
    chatgpt: Object.freeze({ name: 'ChatGPT', url: 'https://chatgpt.com/' }),
    grok: Object.freeze({ name: 'Grok', url: 'https://grok.com/' }),
    deepseek: Object.freeze({ name: 'DeepSeek', url: 'https://chat.deepseek.com/' }),
    doubao: Object.freeze({ name: '豆包', url: 'https://www.doubao.com/chat/' }),
    yuanbao: Object.freeze({ name: '元宝', url: 'https://yuanbao.tencent.com/chat/' }),
    qwen: Object.freeze({ name: '千问', url: 'https://chat.qwen.ai/' }),
  });
  const PROVIDERS = new Set([...Object.keys(PRESETS), 'custom']);

  function validateCustomUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || !value.trim() || /[\\\u0000-\u0020\u007f]/.test(value.trim())) return null;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
      return url;
    } catch { return null; }
  }

  function parseChatConfig(value) {
    if (value == null || value === '') return { ...DEFAULT_CHAT_CONFIG };
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return { ...DEFAULT_CHAT_CONFIG }; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CHAT_CONFIG };
    const provider = PROVIDERS.has(value.provider) ? value.provider : DEFAULT_CHAT_CONFIG.provider;
    return {
      version: 2,
      provider,
      customUrl: typeof value.customUrl === 'string' ? value.customUrl.slice(0, 2048) : '',
      customName: typeof value.customName === 'string' ? value.customName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) : '',
    };
  }

  function selectProvider(config, provider) {
    const current = parseChatConfig(config);
    return { ...current, provider: PROVIDERS.has(provider) ? provider : DEFAULT_CHAT_CONFIG.provider };
  }

  function resolveChatConfig(value) {
    const config = parseChatConfig(value);
    if (config.provider === 'custom') {
      const url = validateCustomUrl(config.customUrl);
      if (!url) return null;
      return { provider: 'custom', name: config.customName || '自定义', url: url.href };
    }
    const preset = PRESETS[config.provider];
    return preset ? { provider: config.provider, name: preset.name, url: preset.url } : null;
  }

  function storedConfig(state) {
    return parseChatConfig(state && typeof state === 'object' ? state[STORAGE_KEY] : null);
  }

  function mergeStoredConfig(state, value) {
    const config = parseChatConfig(value);
    if (!resolveChatConfig(config)) return null;
    const previous = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    return { ...previous, [STORAGE_KEY]: JSON.stringify(config) };
  }

  return Object.freeze({ DEFAULT_CHAT_CONFIG, STORAGE_KEY, PRESETS, parseChatConfig, selectProvider, validateCustomUrl, resolveChatConfig, storedConfig, mergeStoredConfig });
});
