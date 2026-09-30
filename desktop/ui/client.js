(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let currentConfig = null, toastTimer, subscriptionPoll;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
  window.whaleToast = toast;
  async function api(url, method = 'GET', body) {
    const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const result = await response.json();
    if (result.ok === false) throw new Error(result.error || '操作未完成');
    return result;
  }
  const form = $('settings-form');
  const element = name => form.elements.namedItem(name);
  const chatApi = window.WhaleQuickChatConfig;
  const chatConfigKey = 'dshw-quick-chat';
  const chatProviderSelect = element('chatProvider');
  chatProviderSelect.replaceChildren(
    ...Object.entries(chatApi.PRESETS).map(([id, provider]) => new Option(provider.name, id)),
    new Option('自定义 HTTPS 地址', 'custom'),
  );
  $('quick-chat-settings').querySelector('.help').textContent = '快速聊天在无地址栏的小窗中打开。默认 Chrome/Edge 可复用其默认浏览器资料；其他浏览器使用 AI Balance Whale 独立保存的登录会话。与额度和 Auth 相互独立。';
  function savedChatConfig() {
    try { return chatApi.parseChatConfig(localStorage.getItem(chatConfigKey)); }
    catch { return chatApi.parseChatConfig(null); }
  }
  function readChatForm() {
    return chatApi.parseChatConfig({ version: 1, provider: element('chatProvider').value, customUrl: element('customChatUrl').value.trim(), customName: element('customChatName').value.trim() });
  }
  function paintChatConfig(config) {
    const normalized = chatApi.parseChatConfig(config);
    element('chatProvider').value = normalized.provider;
    element('customChatUrl').value = normalized.customUrl;
    element('customChatName').value = normalized.customName;
    $('custom-chat-fields').hidden = normalized.provider !== 'custom';
    $('chat-config-error').hidden = true;
  }
  function chatError(message) {
    $('chat-config-error').textContent = message;
    $('chat-config-error').hidden = false;
  }
  element('chatProvider').addEventListener('change', () => {
    $('custom-chat-fields').hidden = element('chatProvider').value !== 'custom';
    $('chat-config-error').hidden = true;
  });
  $('chat-test-open').addEventListener('click', async () => {
    const config = readChatForm();
    if (!chatApi.resolveChatConfig(config)) { chatError('请输入有效的 HTTPS 网址，不要包含用户名或密码。'); return; }
    try {
      const result = await window.whaleDesktop.openQuickChat(config);
      if (!result?.ok) chatError(result?.error || '快速聊天小窗无法打开此网址，请重试。');
      else toast(result.cookieScope === 'default-browser-profile'
        ? `已在 ${result.browser || '默认浏览器'} 应用窗口打开聊天，并复用其默认登录资料。`
        : '已打开快速聊天小窗；登录状态保存在本应用中。');
    } catch (error) { chatError(error.message || '快速聊天小窗无法打开此网址，请重试。'); }
  });
  async function paintSubscriptions() {
    const data = await api('/api/subscriptions');
    const root = $('sub-auth');
    root.replaceChildren();
    let pending = false;
    for (const account of data.accounts || []) {
      if (account.status === 'pending') pending = true;
      const row = document.createElement('div');
      row.className = 'sub-row';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = account.name;
      const detail = document.createElement('small');
      const windows = (account.windows || []).filter(window => typeof window.remainPct === 'number').map(window => window.label + ' ' + Math.round(window.remainPct) + '%');
      detail.textContent = account.status === 'pending' ? (account.message || '正在等待浏览器登录') : (windows.join(' · ') || account.email || account.message || '未连接');
      copy.append(title, detail);
      const actions = document.createElement('div');
      actions.className = 'sub-actions';
      const login = document.createElement('button');
      login.type = 'button';
      login.className = 'primary';
      login.textContent = account.status === 'pending' ? '登录中' : (account.connected ? '重新登录' : '网页登录');
      login.disabled = account.status === 'pending';
      login.addEventListener('click', async () => {
        login.disabled = true;
        try {
          await api('/api/subscriptions/login', 'POST', { provider: account.id });
          toast('已打开浏览器。完成官方页面登录即可，不用把代码填回来。');
          await paintSubscriptions();
          watchSubscriptions();
        } catch (error) { toast(error.message); login.disabled = false; }
      });
      actions.append(login);
      if (account.connected && account.status !== 'pending') {
        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'quiet';
        logout.textContent = '断开';
        logout.addEventListener('click', async () => {
          try { await api('/api/subscriptions/logout', 'POST', { provider: account.id }); await paintSubscriptions(); }
          catch (error) { toast(error.message); }
        });
        actions.append(logout);
      }
      row.append(copy, actions);
      root.append(row);
    }
    return pending;
  }
  function watchSubscriptions() {
    clearInterval(subscriptionPoll);
    subscriptionPoll = setInterval(async () => {
      if (!$('settings-dialog').open) { clearInterval(subscriptionPoll); return; }
      try { if (!(await paintSubscriptions())) clearInterval(subscriptionPoll); }
      catch { clearInterval(subscriptionPoll); }
    }, 2000);
  }
  async function openSettings() {
    try {
      const info = await api('/api/config'); currentConfig = info.settings;
      for (const key of ['provider', 'baseUrl', 'keyEnv', 'profile', 'projectDir', 'currency', 'dashboardUrl', 'balancePath', 'balanceField', 'usedField', 'balanceScale', 'billingUsageDivisor', 'quotaPerUnit']) element(key).value = currentConfig[key] ?? '';
      element('baseUrl').placeholder = info.baseUrl;
      element('monitorSessions').checked = currentConfig.monitorSessions;
      paintChatConfig(savedChatConfig());
      const model = info.model || '';
      element('priceModel').value = model;
      const prices = currentConfig.models[model] || {};
      for (const [name, key] of [['priceInput', 'input'], ['priceCached', 'cachedInput'], ['priceOutput', 'output'], ['priceWrite', 'cacheWrite']]) element(name).value = prices[key] ?? '';
      $('settings-error').hidden = true; $('settings-dialog').showModal();
      if (await paintSubscriptions()) watchSubscriptions();
    } catch (error) { toast(error.message); }
  }
  window.addEventListener('whale-open-settings', openSettings);
  $('settings-dialog').addEventListener('close', () => clearInterval(subscriptionPoll));
  for (const id of ['close-settings', 'cancel-settings']) $(id).addEventListener('click', () => $('settings-dialog').close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const settings = structuredClone(currentConfig);
      const chatConfig = readChatForm();
      if (!chatApi.resolveChatConfig(chatConfig)) throw new Error('快速聊天网址无效：请输入 HTTPS 地址，且不能包含用户名或密码。');
      for (const key of ['provider', 'baseUrl', 'keyEnv', 'profile', 'projectDir', 'currency', 'dashboardUrl', 'balancePath', 'balanceField', 'usedField']) settings[key] = element(key).value.trim();
      for (const key of ['balanceScale', 'billingUsageDivisor', 'quotaPerUnit']) settings[key] = Number(element(key).value);
      settings.monitorSessions = element('monitorSessions').checked;
      const fields = ['priceInput', 'priceCached', 'priceOutput'];
      const hasPrice = fields.some(key => element(key).value !== '');
      const model = element('priceModel').value.trim();
      if (hasPrice) {
        if (!model || fields.some(key => element(key).value === '')) throw new Error('请完整填写模型名称、输入、缓存命中和输出价格');
        const prices = { input: Number(element('priceInput').value), cachedInput: Number(element('priceCached').value), output: Number(element('priceOutput').value) };
        if (element('priceWrite').value !== '') prices.cacheWrite = Number(element('priceWrite').value);
        settings.models[model] = prices;
      } else if (model) delete settings.models[model];
      await api('/api/config', 'PUT', settings);
      currentConfig = settings;
      const chatSave = await window.whaleDesktop.saveChatConfig(chatConfig);
      if (!chatSave?.ok) throw new Error('账户与用量设置已保存，但快速聊天设置保存失败：' + (chatSave?.error || '请检查应用数据目录的写入权限。其他设置不会被回滚。'));
      localStorage.setItem(chatConfigKey, JSON.stringify(chatSave.config));
      window.dispatchEvent(new Event('whale-quick-chat-config-changed'));
      $('settings-dialog').close();
      window.dispatchEvent(new Event('whale-refresh'));
      toast('设置已保存');
    } catch (error) { $('settings-error').hidden = false; $('settings-error').textContent = error.message; }
  });
})();
