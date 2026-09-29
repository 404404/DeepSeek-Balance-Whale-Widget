(() => {
  'use strict';
  const bridge = window.whaleDesktop;
  const modelApi = window.DesktopDemoModel;
  if (!bridge || !modelApi) return;
  const settingsDialog = document.querySelector('#settings-dialog');

  const { STATES, STATE_LABELS, MODELS, createDesktopDemoModel } = modelApi;
  const state = { imageSettingsOpen: false, imageSettingsState: 'received', returnToChat: false, notice: '', noticeTimer: 0 };
  const previews = new Map();
  const formatBytes = size => {
    const value = Math.max(0, Number(size) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };
  const extensionLabel = file => String(file.extension || file.type || '文件').replace(/^application\//, '').toUpperCase().slice(0, 16);
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function panel(title, content, name) {
    const element = document.createElement('dialog');
    element.className = 'desktop-demo-panel';
    element.setAttribute('aria-label', title);
    element.innerHTML = `<header><div class="desktop-demo-head-left"><h2 class="desktop-demo-title">${title}</h2><span class="desktop-demo-tag">本地演示</span></div><button class="desktop-demo-close" type="button" data-desktop-demo-action="${name}-close" aria-label="关闭${title}" title="关闭">×</button></header>${content}`;
    document.body.appendChild(element);
    return element;
  }

  const controls = document.createElement('dialog');
  controls.className = 'desktop-demo-controls';
  controls.setAttribute('aria-label', '小鲸鱼快捷操作');
  controls.innerHTML = '<button type="button" class="desktop-demo-button" data-desktop-demo-control="chat" aria-label="快速聊天" title="打开快速聊天"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.8A2.8 2.8 0 0 1 6.8 3h10.4A2.8 2.8 0 0 1 20 5.8v7.4a2.8 2.8 0 0 1-2.8 2.8h-5.5l-4.9 4v-4H6.8A2.8 2.8 0 0 1 4 13.2z"/><path d="M8 8h8M8 11h5"/></svg></button><button type="button" class="desktop-demo-button" data-desktop-demo-control="images" aria-label="设置交互状态图片" title="设置人偶交互状态图片"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><circle cx="9" cy="9" r="1.4"/><path d="m5 17 5-5 3.5 3 2.5-2 3 3"/></svg></button>';
  document.body.appendChild(controls);

  const chat = panel('快速聊天',
    '<div class="desktop-demo-banner">演示模式 · 本地模拟回复，不连接真实模型，也不会上传附件。</div><div class="desktop-demo-messages" data-desktop-demo-part="messages" role="log" aria-live="polite"><div class="desktop-demo-empty">发一条消息开始演示。Enter 发送，Shift+Enter 换行。</div></div><div class="desktop-demo-divider"></div><div class="desktop-demo-compose"><div class="desktop-demo-file-list" data-desktop-demo-part="attachments" hidden></div><div class="desktop-demo-model-row"><span>模型</span><select data-desktop-demo-part="model" aria-label="演示模型"><option value="fast">快速对话（演示）</option><option value="deep">深度思考（演示）</option></select><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="open-images" title="设置人偶交互状态图片">交互图片</button></div><div class="desktop-demo-attach-line"><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="pick-files">＋ 添加文件</button><span class="desktop-demo-attach-note">最多 20 个 · 仅本地展示</span></div><div class="desktop-demo-input-row"><textarea data-desktop-demo-part="draft" rows="2" placeholder="输入消息…" aria-label="聊天消息"></textarea><button type="button" class="desktop-demo-primary-btn desktop-demo-send" data-desktop-demo-action="send">发送</button></div><div class="desktop-demo-notice" data-desktop-demo-part="chat-notice" aria-live="polite"></div></div>', 'chat');

  const fileActions = panel('收到文件',
    '<div class="desktop-demo-banner">请为这批文件选择用途。此 Demo 不读取普通文件内容。</div><div class="desktop-demo-drop-list" data-desktop-demo-part="drop-files"></div><div class="desktop-demo-error" data-desktop-demo-part="drop-errors" hidden></div><div class="desktop-demo-notice" data-desktop-demo-part="action-notice"></div><div class="desktop-demo-drop-actions"><button type="button" class="desktop-demo-primary-btn" data-desktop-demo-action="route-chat">发送至聊天</button><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="route-assistant">交由 AI 助手处理</button><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="route-images">设为交互状态图片</button><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="cancel-drop">取消</button></div>', 'actions');

  const task = panel('AI 助手任务',
    '<div class="desktop-demo-banner">演示任务 · 不读取附件内容，也不会调用外部助手。</div><div class="desktop-demo-task-content"><div class="desktop-demo-task-files" data-desktop-demo-part="task-files"></div><label class="desktop-demo-field-label">预设任务<select class="desktop-demo-select" data-desktop-demo-part="task-kind"><option value="summary">总结内容</option><option value="key-points">提取要点</option></select></label><label class="desktop-demo-field-label">补充要求<textarea data-desktop-demo-part="task-notes" placeholder="例如：优先关注时间安排和风险"></textarea></label><div class="desktop-demo-task-state" data-desktop-demo-part="task-status" data-state="ready"><span>●</span><span data-desktop-demo-part="task-status-text">等待开始</span></div><div class="desktop-demo-task-result" data-desktop-demo-part="task-result" hidden></div><div class="desktop-demo-notice" data-desktop-demo-part="task-notice"></div><div class="desktop-demo-task-actions"><button type="button" class="desktop-demo-primary-btn" data-desktop-demo-action="start-task">开始演示</button><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="close-task">关闭</button></div></div>', 'task');

  const imageSettings = panel('交互状态图片',
    '<div class="desktop-demo-banner">状态图片单独保存在本应用数据目录，不会改写现有角色或聊天附件。</div><div class="desktop-demo-image-content"><label class="desktop-demo-field-label">人偶交互状态<select class="desktop-demo-select" data-desktop-demo-part="setting-state"></select></label><div class="desktop-demo-preview-wrap"><img class="desktop-demo-preview" data-desktop-demo-part="setting-preview" alt="当前交互状态图片预览"></div><div class="desktop-demo-image-description" data-desktop-demo-part="setting-description"></div><div class="desktop-demo-notice" data-desktop-demo-part="setting-notice" aria-live="polite"></div><div class="desktop-demo-image-actions"><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="reset-image">恢复内置图片</button><button type="button" class="desktop-demo-primary-btn" data-desktop-demo-action="pick-image">导入 / 替换</button></div></div>', 'images');

  const imageAssignment = panel('选择交互状态图片',
    '<div class="desktop-demo-banner">这张图片只用于人偶外观，不会作为聊天附件自动发送。</div><div class="desktop-demo-image-content"><label class="desktop-demo-field-label">拖入的图片<select class="desktop-demo-select" data-desktop-demo-part="drop-image-file"></select></label><div class="desktop-demo-preview-wrap"><img class="desktop-demo-preview" data-desktop-demo-part="drop-image-preview" alt="拖入图片预览"></div><label class="desktop-demo-field-label">应用到状态<select class="desktop-demo-select" data-desktop-demo-part="drop-image-state"></select></label><div class="desktop-demo-image-description">只支持 PNG、JPEG、WebP；导入后会复制到应用数据目录。</div><div class="desktop-demo-notice" data-desktop-demo-part="assignment-notice"></div><div class="desktop-demo-image-actions"><button type="button" class="desktop-demo-quiet-btn" data-desktop-demo-action="cancel-image-assignment">取消</button><button type="button" class="desktop-demo-primary-btn" data-desktop-demo-action="apply-drop-image">应用图片</button></div></div>', 'assignment');

  const root = document.querySelector('.dshwv-root');
  const pet = document.querySelector('.dshwv-img');
  const menuButton = document.querySelector('.dshwv-menu-btn');
  const body = document.querySelector('.dshwv-body');
  let avatar = null;
  if (body) {
    avatar = document.createElement('img');
    avatar.className = 'desktop-demo-avatar';
    avatar.alt = '';
    avatar.draggable = false;
    body.appendChild(avatar);
  }
  if (root) {
    const hint = document.createElement('span');
    hint.className = 'desktop-demo-drop-hint';
    hint.textContent = '松开发送文件';
    hint.setAttribute('aria-hidden', 'true');
    root.appendChild(hint);
  }

  function showNotice(message) {
    state.notice = String(message || '');
    window.clearTimeout(state.noticeTimer);
    if (state.notice) state.noticeTimer = window.setTimeout(() => { state.notice = ''; render(model.snapshot()); }, 4500);
    render(model.snapshot());
  }
  const model = createDesktopDemoModel({ onChange: render });
  let activeDropEpoch = 0;

  function dialogOpen(element) {
    try { if (!element.open) element.show(); } catch { element.setAttribute('open', ''); }
  }
  function dialogClose(element) {
    try { if (element.open) element.close(); } catch { element.removeAttribute('open'); }
  }
  function hidePetMenu() {
    if (document.querySelector('.dshwv-menu.dshwv-menu-open') && menuButton) menuButton.click();
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function placePanel(element, anchor = menuButton || pet) {
    if (!element.open || !anchor) return;
    const bounds = anchor.getBoundingClientRect();
    const availableWidth = Math.max(1, window.innerWidth - 16);
    const availableHeight = Math.max(1, window.innerHeight - 16);
    const width = Math.min(element.offsetWidth || 360, availableWidth);
    const height = Math.min(element.offsetHeight || 360, availableHeight);
    element.style.maxWidth = `${availableWidth}px`;
    element.style.maxHeight = `${availableHeight}px`;
    let left;
    if (bounds.left - width - 12 >= 8) left = bounds.left - width - 12;
    else if (bounds.right + width + 12 <= window.innerWidth - 8) left = bounds.right + 12;
    else left = bounds.left - width / 2;
    const top = bounds.bottom - height;
    element.style.left = `${Math.round(clamp(left, 8, Math.max(8, window.innerWidth - width - 8)))}px`;
    element.style.top = `${Math.round(clamp(top, 8, Math.max(8, window.innerHeight - height - 8)))}px`;
  }
  function placeControls() {
    if (!controls.open || !menuButton) return;
    const rect = menuButton.getBoundingClientRect();
    const left = rect.left + (rect.width - 26) / 2;
    controls.style.left = `${Math.round(clamp(left, 4, Math.max(4, window.innerWidth - 30)))}px`;
    controls.style.top = `${Math.round(clamp(rect.top - 68, 4, Math.max(4, window.innerHeight - 70)))}px`;
  }
  function setOpen(element, open) {
    if (open) dialogOpen(element);
    else dialogClose(element);
  }
  function stateImageUrl(value, key) {
    if (key) return `/desktop-demo/state-image?state=${encodeURIComponent(value)}&v=${encodeURIComponent(key)}`;
    return `/assets/desktop-demo-${encodeURIComponent(value)}.svg`;
  }
  function syncAvatar(snapshot) {
    if (!avatar) return;
    const name = snapshot.imageState || 'default';
    const custom = snapshot.imageMappings[name];
    if (name === 'default' && !custom) {
      avatar.classList.remove('is-visible');
      avatar.removeAttribute('data-source-key');
      return;
    }
    const key = custom ? `${name}:${custom.id}` : `${name}:builtin`;
    if (avatar.dataset.sourceKey === key) { avatar.classList.add('is-visible'); return; }
    avatar.dataset.sourceKey = key;
    avatar.classList.add('is-visible');
    avatar.src = stateImageUrl(name, custom?.id);
  }
  if (avatar) {
    avatar.addEventListener('error', () => {
      const key = avatar.dataset.sourceKey || '';
      const colon = key.indexOf(':');
      if (colon < 0) { avatar.classList.remove('is-visible'); return; }
      const status = key.slice(0, colon), imageId = key.slice(colon + 1);
      if (imageId !== 'builtin') {
        model.imageLoadFailed(status, imageId);
        bridge.getDesktopDemoStateImages().then(images => model.setImageMappings(images)).catch(() => {});
      } else {
        avatar.classList.remove('is-visible');
        avatar.removeAttribute('data-source-key');
      }
    });
  }

  function fileRow(file, { removable = false, preview = previews.get(file.id) } = {}) {
    const row = document.createElement('div');
    row.className = 'desktop-demo-file';
    if (preview) {
      const image = document.createElement('img');
      image.className = 'desktop-demo-file-thumb';
      image.src = preview;
      image.alt = '';
      row.appendChild(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'desktop-demo-file-icon';
      icon.textContent = file.isImage ? '▧' : '▤';
      row.appendChild(icon);
    }
    const main = document.createElement('span');
    main.className = 'desktop-demo-file-main';
    const name = document.createElement('span');
    name.className = 'desktop-demo-file-name';
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.className = 'desktop-demo-file-meta';
    meta.textContent = `${extensionLabel(file)} · ${formatBytes(file.size)}`;
    main.append(name, meta);
    row.appendChild(main);
    if (removable) {
      const remove = document.createElement('button');
      remove.className = 'desktop-demo-file-remove';
      remove.type = 'button';
      remove.title = `移除 ${file.name}`;
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      remove.dataset.desktopDemoRemove = file.id;
      remove.textContent = '×';
      row.appendChild(remove);
    }
    return row;
  }
  function renderMessageList(snapshot) {
    const host = chat.querySelector('[data-desktop-demo-part="messages"]');
    const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 48;
    host.replaceChildren();
    if (!snapshot.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'desktop-demo-empty';
      empty.textContent = '发一条消息开始演示。Enter 发送，Shift+Enter 换行。';
      host.appendChild(empty);
    }
    for (const message of snapshot.messages) {
      const item = document.createElement('article');
      item.className = `desktop-demo-message ${message.role === 'user' ? 'desktop-demo-message-user' : 'desktop-demo-message-assistant'}`;
      if (message.role === 'assistant') {
        const label = document.createElement('div');
        label.className = 'desktop-demo-message-model';
        label.textContent = MODELS[message.modelId] || MODELS.fast;
        item.appendChild(label);
      }
      if (message.status === 'thinking') {
        const thinking = document.createElement('span');
        thinking.className = 'desktop-demo-thinking';
        thinking.append(document.createTextNode('思考中'));
        for (let i = 0; i < 3; i += 1) thinking.appendChild(document.createElement('i'));
        item.appendChild(thinking);
      } else {
        const text = document.createElement('div');
        text.textContent = message.text || (message.files.length ? `发送了 ${message.files.length} 个附件` : '');
        item.appendChild(text);
      }
      if (message.files?.length) {
        const files = document.createElement('div');
        files.className = 'desktop-demo-message-files';
        for (const file of message.files) files.appendChild(fileRow(file));
        item.appendChild(files);
      }
      host.appendChild(item);
    }
    if (nearBottom || snapshot.messages.length) host.scrollTop = host.scrollHeight;
  }
  function renderAttachments(snapshot) {
    const host = chat.querySelector('[data-desktop-demo-part="attachments"]');
    host.replaceChildren();
    host.hidden = !snapshot.attachments.length;
    for (const file of snapshot.attachments) host.appendChild(fileRow(file, { removable: true }));
  }
  function renderDropFiles(snapshot) {
    const host = fileActions.querySelector('[data-desktop-demo-part="drop-files"]');
    const errors = fileActions.querySelector('[data-desktop-demo-part="drop-errors"]');
    host.replaceChildren();
    for (const file of snapshot.droppedFiles) host.appendChild(fileRow(file));
    errors.replaceChildren();
    errors.hidden = !snapshot.dropErrors.length;
    for (const item of snapshot.dropErrors) {
      const error = document.createElement('div');
      error.textContent = `${item.name}：${item.error}`;
      errors.appendChild(error);
    }
    fileActions.querySelector('[data-desktop-demo-action="route-chat"]').disabled = !snapshot.droppedFiles.length;
    fileActions.querySelector('[data-desktop-demo-action="route-assistant"]').disabled = !snapshot.droppedFiles.length;
    fileActions.querySelector('[data-desktop-demo-action="route-images"]').disabled = !snapshot.droppedFiles.some(file => file.isImage && file.imageSupported);
  }
  function populateStateSelect(select, value) {
    if (!select.options.length) {
      for (const item of STATES) {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = STATE_LABELS[item];
        select.appendChild(option);
      }
    }
    select.value = value;
  }
  function renderTask(snapshot) {
    const files = task.querySelector('[data-desktop-demo-part="task-files"]');
    files.textContent = snapshot.droppedFiles.length
      ? snapshot.droppedFiles.map(file => `${file.name}（${formatBytes(file.size)}）`).join(' · ')
      : '未附加文件';
    const kind = task.querySelector('[data-desktop-demo-part="task-kind"]');
    if (snapshot.task && kind.value !== (snapshot.task.kind === 'key-points' ? 'key-points' : 'summary')) kind.value = snapshot.task.kind;
    const notes = task.querySelector('[data-desktop-demo-part="task-notes"]');
    if (snapshot.task && notes.value !== snapshot.task.notes) notes.value = snapshot.task.notes;
    const taskStatus = snapshot.task?.status || 'ready';
    const status = task.querySelector('[data-desktop-demo-part="task-status"]');
    status.dataset.state = taskStatus;
    task.querySelector('[data-desktop-demo-part="task-status-text"]').textContent = ({ ready: '等待开始', waiting: '等待中', processing: '处理中', complete: '已完成', cancelled: '已取消' })[taskStatus] || '等待开始';
    const result = task.querySelector('[data-desktop-demo-part="task-result"]');
    result.textContent = snapshot.task?.result || '';
    result.hidden = !snapshot.task?.result;
    const start = task.querySelector('[data-desktop-demo-action="start-task"]');
    start.disabled = !snapshot.task || ['waiting', 'processing', 'complete'].includes(taskStatus);
    start.textContent = taskStatus === 'waiting' || taskStatus === 'processing' ? '处理中…' : taskStatus === 'complete' ? '演示完成' : '开始演示';
  }
  function renderImageSettings(snapshot) {
    const select = imageSettings.querySelector('[data-desktop-demo-part="setting-state"]');
    populateStateSelect(select, state.imageSettingsState);
    const custom = snapshot.imageMappings[state.imageSettingsState];
    const preview = imageSettings.querySelector('[data-desktop-demo-part="setting-preview"]');
    const source = custom ? stateImageUrl(state.imageSettingsState, custom.id)
      : state.imageSettingsState === 'default' ? (pet?.currentSrc || pet?.src || '/assets/DSniang1.png')
        : stateImageUrl(state.imageSettingsState);
    if (preview.dataset.source !== source) { preview.dataset.source = source; preview.src = source; }
    imageSettings.querySelector('[data-desktop-demo-part="setting-description"]').textContent = custom
      ? `当前自定义图片：${custom.name} · ${formatBytes(custom.size)}。`
      : `当前使用内置「${STATE_LABELS[state.imageSettingsState]}」图片。`;
    imageSettings.querySelector('[data-desktop-demo-action="reset-image"]').disabled = !custom;
  }
  function renderImageAssignment(snapshot) {
    const supported = snapshot.droppedFiles.filter(file => file.isImage && file.imageSupported);
    const fileSelect = imageAssignment.querySelector('[data-desktop-demo-part="drop-image-file"]');
    const previous = fileSelect.value;
    fileSelect.replaceChildren();
    for (const file of supported) {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      fileSelect.appendChild(option);
    }
    if (supported.some(file => file.id === previous)) fileSelect.value = previous;
    const stateSelect = imageAssignment.querySelector('[data-desktop-demo-part="drop-image-state"]');
    populateStateSelect(stateSelect, state.imageSettingsState);
    const image = supported.find(file => file.id === fileSelect.value);
    const preview = imageAssignment.querySelector('[data-desktop-demo-part="drop-image-preview"]');
    const source = image ? previews.get(image.id) : '';
    if (preview.dataset.source !== source) {
      preview.dataset.source = source || '';
      if (source) preview.src = source;
      else preview.removeAttribute('src');
    }
    imageAssignment.querySelector('[data-desktop-demo-action="apply-drop-image"]').disabled = !image;
  }
  function render(snapshot) {
    setOpen(chat, snapshot.chatOpen);
    setOpen(fileActions, snapshot.actionOpen);
    setOpen(task, snapshot.taskOpen);
    setOpen(imageAssignment, snapshot.imageAssignmentOpen);
    setOpen(imageSettings, state.imageSettingsOpen);
    renderMessageList(snapshot);
    renderAttachments(snapshot);
    renderDropFiles(snapshot);
    renderTask(snapshot);
    renderImageSettings(snapshot);
    renderImageAssignment(snapshot);
    chat.querySelector('[data-desktop-demo-part="model"]').value = snapshot.modelId;
    const draft = chat.querySelector('[data-desktop-demo-part="draft"]');
    if (draft.value !== snapshot.draft) draft.value = snapshot.draft;
    chat.querySelector('[data-desktop-demo-action="send"]').disabled = !snapshot.draft.trim() && !snapshot.attachments.length;
    chat.querySelector('[data-desktop-demo-part="chat-notice"]').textContent = snapshot.notice || state.notice;
    fileActions.querySelector('[data-desktop-demo-part="action-notice"]').textContent = snapshot.notice || state.notice;
    task.querySelector('[data-desktop-demo-part="task-notice"]').textContent = snapshot.notice || state.notice;
    imageSettings.querySelector('[data-desktop-demo-part="setting-notice"]').textContent = snapshot.notice || state.notice;
    if (root) root.classList.toggle('desktop-demo-drag-active', snapshot.dragOver);
    syncAvatar(snapshot);
    const hovering = !!menuButton?.classList.contains('dshwv-menu-btn-visible');
    const settingsVisible = !!settingsDialog?.open;
    const chatVisible = !settingsVisible && (hovering || snapshot.chatOpen);
    const imagesVisible = !settingsVisible && (hovering || state.imageSettingsOpen);
    controls.querySelector('[data-desktop-demo-control="chat"]').classList.toggle('is-visible', chatVisible);
    controls.querySelector('[data-desktop-demo-control="images"]').classList.toggle('is-visible', imagesVisible);
    const controlsNeeded = chatVisible || imagesVisible;
    setOpen(controls, controlsNeeded);
    placeControls();
    for (const element of [chat, fileActions, task, imageSettings, imageAssignment]) placePanel(element);
  }

  function clearPreviewUrls(ids = []) {
    for (const id of ids) {
      const url = previews.get(id);
      if (!url) continue;
      URL.revokeObjectURL(url);
      previews.delete(id);
    }
  }
  async function cancelDrop() {
    const ids = model.cancelDrop();
    ++activeDropEpoch;
    clearPreviewUrls(ids);
    await bridge.clearDroppedDesktopDemoFiles(ids).catch(() => {});
  }
  async function closeTask() {
    const ids = model.closeTask();
    clearPreviewUrls(ids);
    await bridge.clearDroppedDesktopDemoFiles(ids).catch(() => {});
  }
  async function closeImageAssignment() {
    const ids = model.closeImageAssignment();
    clearPreviewUrls(ids);
    await bridge.clearDroppedDesktopDemoFiles(ids).catch(() => {});
  }
  async function openChat() {
    hidePetMenu();
    model.openChat();
    window.requestAnimationFrame(() => chat.querySelector('[data-desktop-demo-part="draft"]').focus());
  }
  function openImageSettings() {
    hidePetMenu();
    state.returnToChat = model.snapshot().chatOpen;
    if (state.returnToChat) model.closeChat();
    state.imageSettingsOpen = true;
    state.imageSettingsState = model.snapshot().imageState === 'default' ? 'received' : model.snapshot().imageState;
    render(model.snapshot());
    imageSettings.querySelector('[data-desktop-demo-part="setting-state"]').focus();
  }
  function closeImageSettings() {
    state.imageSettingsOpen = false;
    const reopenChat = state.returnToChat;
    state.returnToChat = false;
    render(model.snapshot());
    if (reopenChat) openChat();
  }
  async function addNativeFiles() {
    let files = [];
    try { files = await bridge.pickDesktopDemoFiles(); }
    catch { showNotice('文件选择暂时不可用，请重试。'); return; }
    if (Array.isArray(files) && files.length) model.addAttachments(files);
  }
  async function routeToChat() {
    const result = model.chooseDropAction('chat');
    if (!result?.ok) return;
    clearPreviewUrls(result.clearIds);
    await bridge.clearDroppedDesktopDemoFiles(result.clearIds).catch(() => {});
    hidePetMenu();
    window.requestAnimationFrame(() => chat.querySelector('[data-desktop-demo-part="draft"]').focus());
  }
  async function routeToAssistant() {
    const ids = model.snapshot().droppedFiles.map(file => file.id);
    hidePetMenu();
    model.chooseDropAction('assistant');
    clearPreviewUrls(ids);
    await bridge.clearDroppedDesktopDemoFiles(ids).catch(() => {});
  }
  async function applyDroppedImage() {
    const snapshot = model.snapshot();
    const selectedId = imageAssignment.querySelector('[data-desktop-demo-part="drop-image-file"]').value;
    const file = snapshot.droppedFiles.find(item => item.id === selectedId && item.imageSupported);
    const imageState = imageAssignment.querySelector('[data-desktop-demo-part="drop-image-state"]').value;
    if (!file || !STATES.includes(imageState)) return;
    const button = imageAssignment.querySelector('[data-desktop-demo-action="apply-drop-image"]');
    button.disabled = true;
    try {
      const result = await bridge.importDroppedDesktopDemoImage(file.id, imageState);
      if (!result?.ok) { showNotice(result?.error || '图片导入失败，请重试。'); button.disabled = false; return; }
      model.setImageMappings(result.images);
      state.imageSettingsState = imageState;
      const oldIds = await closeImageAssignment();
      clearPreviewUrls(oldIds);
      state.imageSettingsOpen = true;
      render(model.snapshot());
      showNotice(`已将「${file.name}」设为「${STATE_LABELS[imageState]}」状态图片。`);
    } catch (error) {
      showNotice(error?.message || '图片导入失败，请重试。');
      button.disabled = false;
    }
  }
  async function importSettingImage() {
    const imageState = state.imageSettingsState;
    try {
      const result = await bridge.pickDesktopDemoStateImage(imageState);
      if (result?.canceled) return;
      if (!result?.ok) { showNotice(result?.error || '图片导入失败，请重试。'); return; }
      model.setImageMappings(result.images);
      showNotice(`已替换「${STATE_LABELS[imageState]}」状态图片。`);
    } catch (error) { showNotice(error?.message || '图片导入失败，请重试。'); }
  }
  async function resetSettingImage() {
    const imageState = state.imageSettingsState;
    const result = await bridge.resetDesktopDemoStateImage(imageState).catch(() => ({ ok: false }));
    if (!result?.ok) { showNotice('恢复内置图片失败，请重试。'); return; }
    model.setImageMappings(result.images);
    showNotice(`已恢复「${STATE_LABELS[imageState]}」内置图片。`);
  }
  async function handleAction(action) {
    switch (action) {
      case 'chat': return openChat();
      case 'images': return openImageSettings();
      case 'chat-close': return model.closeChat();
      case 'actions-close': return cancelDrop();
      case 'task-close': return closeTask();
      case 'images-close': return closeImageSettings();
      case 'assignment-close': return closeImageAssignment();
      case 'open-images': return openImageSettings();
      case 'pick-files': return addNativeFiles();
      case 'send': model.send(); return;
      case 'route-chat': return routeToChat();
      case 'route-assistant': return routeToAssistant();
      case 'route-images': {
        const result = model.chooseDropAction('images');
        if (!result?.ok) showNotice(result?.error || '请拖入支持的图片。');
        else state.imageSettingsState = 'received';
        return;
      }
      case 'cancel-drop': return cancelDrop();
      case 'start-task': model.startTask(); return;
      case 'close-task': return closeTask();
      case 'cancel-image-assignment': return closeImageAssignment();
      case 'apply-drop-image': return applyDroppedImage();
      case 'pick-image': return importSettingImage();
      case 'reset-image': return resetSettingImage();
      default: return;
    }
  }

  document.addEventListener('click', event => {
    const control = event.target.closest('[data-desktop-demo-control]');
    if (control) { handleAction(control.dataset.desktopDemoControl); return; }
    const action = event.target.closest('[data-desktop-demo-action]');
    if (action) { handleAction(action.dataset.desktopDemoAction); return; }
    const remove = event.target.closest('[data-desktop-demo-remove]');
    if (remove) {
      const item = remove.closest('.desktop-demo-message') ? null : remove.dataset.desktopDemoRemove;
      if (item) model.removeAttachment(item);
    }
  });
  chat.querySelector('[data-desktop-demo-part="model"]').addEventListener('change', event => model.setModel(event.target.value));
  chat.querySelector('[data-desktop-demo-part="draft"]').addEventListener('input', event => model.setDraft(event.target.value));
  chat.querySelector('[data-desktop-demo-part="draft"]').addEventListener('compositionstart', () => { state.composing = true; });
  chat.querySelector('[data-desktop-demo-part="draft"]').addEventListener('compositionend', () => { state.composing = false; });
  chat.querySelector('[data-desktop-demo-part="draft"]').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || state.composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    model.send();
  });
  imageSettings.querySelector('[data-desktop-demo-part="setting-state"]').addEventListener('change', event => {
    state.imageSettingsState = event.target.value;
    render(model.snapshot());
  });
  imageAssignment.querySelector('[data-desktop-demo-part="drop-image-file"]').addEventListener('change', () => renderImageAssignment(model.snapshot()));
  imageAssignment.querySelector('[data-desktop-demo-part="drop-image-state"]').addEventListener('change', event => { state.imageSettingsState = event.target.value; });
  task.querySelector('[data-desktop-demo-part="task-kind"]').addEventListener('change', event => model.setTaskKind(event.target.value));
  task.querySelector('[data-desktop-demo-part="task-notes"]').addEventListener('input', event => model.setTaskNotes(event.target.value));
  for (const element of [chat, fileActions, task, imageSettings, imageAssignment]) {
    element.addEventListener('cancel', event => {
      event.preventDefault();
      const closeActionName = element === chat ? 'chat-close' : element === fileActions ? 'actions-close' : element === task ? 'task-close' : element === imageSettings ? 'images-close' : 'assignment-close';
      handleAction(closeActionName);
    });
  }
  if (menuButton) {
    new MutationObserver(() => render(model.snapshot())).observe(menuButton, { attributes: true, attributeFilter: ['class', 'style'] });
    menuButton.addEventListener('click', () => render(model.snapshot()));
  }
  if (settingsDialog) new MutationObserver(() => render(model.snapshot())).observe(settingsDialog, { attributes: true, attributeFilter: ['open'] });
  window.addEventListener('resize', () => render(model.snapshot()));
  window.addEventListener('whale-native-root-offset', () => render(model.snapshot()));
  window.addEventListener('blur', () => {
    if (model.snapshot().dragOver) model.dragLeave();
  });

  function pointOverAvatar(event) {
    const rect = pet?.getBoundingClientRect();
    return !!rect && event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
  }
  function hasFiles(event) {
    return !!event.dataTransfer && (event.dataTransfer.files?.length > 0 || Array.from(event.dataTransfer.types || []).includes('Files'));
  }
  document.addEventListener('dragenter', event => {
    if (!hasFiles(event) || !pointOverAvatar(event)) return;
    event.preventDefault();
    model.dragEnter();
  }, true);
  document.addEventListener('dragover', event => {
    if (!hasFiles(event) || !pointOverAvatar(event)) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = 'copy'; } catch {}
    if (!model.snapshot().dragOver) model.dragEnter();
  }, true);
  document.addEventListener('dragleave', event => {
    if (!model.snapshot().dragOver) return;
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && pointOverAvatar(event)) return;
    model.dragLeave();
  }, true);
  document.addEventListener('dragend', () => { if (model.snapshot().dragOver) model.dragLeave(); }, true);
  document.addEventListener('drop', async event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!pointOverAvatar(event)) { if (model.snapshot().dragOver) model.dragLeave(); return; }
    const epoch = ++activeDropEpoch;
    const previousIds = model.snapshot().droppedFiles.map(file => file.id);
    clearPreviewUrls(previousIds);
    bridge.clearDroppedDesktopDemoFiles(previousIds).catch(() => {});
    const rawFiles = Array.from(event.dataTransfer.files || []);
    if (!rawFiles.length) {
      model.drop([{ name: '拖入项目', isFile: false, error: '暂不支持文件夹或无法读取的项目，请拖入普通文件' }]);
      return;
    }
    let files = [];
    try { files = await bridge.inspectDroppedDesktopDemoFiles(rawFiles); }
    catch {
      if (epoch === activeDropEpoch) model.drop([{ name: '拖入文件', isFile: false, error: '无法读取文件信息，请重新拖入' }]);
      return;
    }
    if (epoch !== activeDropEpoch) {
      await bridge.clearDroppedDesktopDemoFiles(files.map(file => file.id)).catch(() => {});
      return;
    }
    files.forEach((file, index) => {
      const raw = rawFiles[index];
      if (file.isImage && file.imageSupported && raw) {
        try { previews.set(file.id, URL.createObjectURL(raw)); } catch {}
      }
    });
    model.drop(files);
  }, true);

  for (const imageState of STATES) {
    if (imageState === 'default') continue;
    const preloaded = new Image();
    preloaded.src = stateImageUrl(imageState);
  }
  bridge.getDesktopDemoStateImages().then(images => model.setImageMappings(images)).catch(() => {});
  render(model.snapshot());

  window.addEventListener('beforeunload', () => {
    model.dispose();
    for (const url of previews.values()) URL.revokeObjectURL(url);
    previews.clear();
  }, { once: true });

  if (bridge.testMode) {
    window.__desktopDemoSmoke = Object.freeze({
      async reset() {
        model.dispose();
        for (const url of previews.values()) URL.revokeObjectURL(url);
        previews.clear();
        model.openChat();
        model.setDraft('');
        model.setModel('fast');
      },
      openChat() { controls.querySelector('[data-desktop-demo-control="chat"]').click(); },
      setModel(id) { const select = chat.querySelector('[data-desktop-demo-part="model"]'); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); },
      setDraft(value) { const input = chat.querySelector('[data-desktop-demo-part="draft"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); },
      send() { chat.querySelector('[data-desktop-demo-action="send"]').click(); },
      addFiles(files) { model.addAttachments(files); },
      dropFiles(files) { model.drop(files); },
      route(action) { fileActions.querySelector(`[data-desktop-demo-action="route-${action}"]`)?.click(); },
      startTask() { task.querySelector('[data-desktop-demo-action="start-task"]').click(); },
      getState() { return model.snapshot(); },
      async refreshImages() { model.setImageMappings(await bridge.getDesktopDemoStateImages()); },
      async openImageSettings() { state.imageSettingsOpen = true; state.imageSettingsState = 'received'; render(model.snapshot()); },
      async waitForImage() { await new Promise(resolve => { if (avatar?.complete && avatar.naturalWidth) return resolve(); const timer = setTimeout(resolve, 1800); avatar?.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true }); }); return { src: avatar?.currentSrc || '', width: avatar?.naturalWidth || 0, height: avatar?.naturalHeight || 0, visible: !!avatar?.classList.contains('is-visible') }; },
      async waitForSettingImage() { const image=imageSettings.querySelector('[data-desktop-demo-part="setting-preview"]'); await new Promise(resolve => { if (image.complete && image.naturalWidth) return resolve(); const timer=setTimeout(resolve,1800); image.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true}); }); return {src:image.currentSrc||'',width:image.naturalWidth||0,height:image.naturalHeight||0,open:imageSettings.open}; },
      geometry() { return { chat: chat.getBoundingClientRect().toJSON(), images: imageSettings.getBoundingClientRect().toJSON(), avatar: avatar?.getBoundingClientRect().toJSON() || null }; },
      closeChat() { chat.querySelector('[data-desktop-demo-action="chat-close"]').click(); },
      closeTask() { task.querySelector('[data-desktop-demo-action="task-close"]').click(); },
      closeImageAssignment() { imageAssignment.querySelector('[data-desktop-demo-action="cancel-image-assignment"]').click(); },
      setHover(value) { menuButton?.classList.toggle('dshwv-menu-btn-visible', !!value); render(model.snapshot()); },
      dragEnter() { model.dragEnter(); },
      dragLeave() { model.dragLeave(); },
      pressEnter({ composing = false, shiftKey = false } = {}) {
        const input = chat.querySelector('[data-desktop-demo-part="draft"]');
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, shiftKey, isComposing: composing });
        if (composing) Object.defineProperty(event, 'keyCode', { value: 229 });
        input.dispatchEvent(event);
        return { prevented: event.defaultPrevented, messages: model.snapshot().messages.length, draft: input.value };
      },
    });
  }
})();
