(() => {
  'use strict';

  const STATES = Object.freeze(['default', 'dragging', 'received', 'processing', 'complete']);
  const STATE_LABELS = Object.freeze({
    default: '默认', dragging: '文件拖入时', received: '文件已接收',
    processing: '助手处理中', complete: '处理完成',
  });
  const MODELS = Object.freeze({
    fast: '快速对话（演示）',
    deep: '深度思考（演示）',
  });
  const COMPLETE_DURATION_MS = 2200;
  const allowedStates = new Set(STATES);
  const supportedImageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
  const copy = value => JSON.parse(JSON.stringify(value));

  function safeName(value) {
    return String(value || '未命名文件').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || '未命名文件';
  }

  function normalizeFile(value) {
    const name = safeName(value?.name);
    const inferredExtension = name.includes('.') ? name.split('.').pop() : '';
    const extension = String(value?.extension || inferredExtension).replace(/^\./, '').toLowerCase();
    const error = typeof value?.error === 'string' ? value.error.slice(0, 180) : '';
    const isFile = value?.isFile !== false && !error;
    return {
      id: String(value?.id || `${name}:${Number(value?.size) || 0}`),
      name,
      type: String(value?.type || (extension ? extension.toUpperCase() : '文件')).slice(0, 64),
      extension,
      size: Math.max(0, Number(value?.size) || 0),
      isFile,
      isImage: isFile && (value?.isImage === true || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)),
      imageSupported: isFile && (value?.imageSupported === true || supportedImageExtensions.has(extension)),
      error,
    };
  }

  function createDesktopDemoModel(options = {}) {
    const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
    const cancel = options.cancel || (handle => clearTimeout(handle));
    const replyDelay = Math.max(0, Number(options.replyDelay) || 760);
    const taskStepDelay = Math.max(0, Number(options.taskStepDelay) || 520);
    const completionDelay = Math.max(0, Number(options.completionDelay) || COMPLETE_DURATION_MS);
    const changed = typeof options.onChange === 'function' ? options.onChange : () => {};
    const state = {
      chatOpen: false,
      draft: '',
      modelId: 'fast',
      messages: [],
      attachments: [],
      dragOver: false,
      droppedFiles: [],
      dropErrors: [],
      actionOpen: false,
      imageAssignmentOpen: false,
      imageState: 'default',
      imageMappings: {},
      taskOpen: false,
      task: null,
      notice: '',
    };
    let messageCounter = 0;
    let taskEpoch = 0;
    let replyHandles = new Map();
    let taskHandles = [];

    function emit() { changed(copy(state)); }
    function snapshot() { return copy(state); }
    function closeActionSurface() {
      state.actionOpen = false;
      state.imageAssignmentOpen = false;
    }
    function clearTaskHandles() {
      for (const handle of taskHandles) cancel(handle);
      taskHandles = [];
    }
    function clearDropped() {
      const ids = state.droppedFiles.map(file => file.id);
      state.droppedFiles = [];
      state.dropErrors = [];
      state.dragOver = false;
      return ids;
    }
    function appendAttachments(files) {
      const existing = new Set(state.attachments.map(file => file.id));
      let added = 0;
      let ignored = 0;
      for (const value of files) {
        const file = normalizeFile(value);
        if (!file.isFile || existing.has(file.id)) continue;
        if (state.attachments.length >= 20) { ignored += 1; continue; }
        state.attachments.push(file);
        existing.add(file.id);
        added += 1;
      }
      if (ignored) state.notice = `附件最多添加 20 个，已忽略 ${ignored} 个文件`;
      return added;
    }
    function responseText(text, files, modelId) {
      const modelName = MODELS[modelId] || MODELS.fast;
      const summary = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 46);
      const fileCount = files.length;
      const details = summary ? `已收到“${summary}${String(text || '').length > 46 ? '…' : ''}”` : '已收到你的附件';
      return `${modelName}本地演示回复：${details}。${fileCount ? `本次消息包含 ${fileCount} 个附件。` : ''}此回复由演示流程生成，没有调用真实模型。`;
    }
    function taskResult(task) {
      const names = state.droppedFiles.map(file => file.name).slice(0, 3).join('、');
      const target = task.kind === 'key-points' ? '提取要点' : '总结内容';
      const fileSummary = names ? `待处理文件：${names}${state.droppedFiles.length > 3 ? ' 等' : ''}。` : '未附加文件。';
      const notes = task.notes.trim() ? `补充要求：${task.notes.trim().slice(0, 90)}。` : '';
      return `演示结果：已完成“${target}”流程。${fileSummary}${notes}本流程只展示本地交互，没有读取文件内容或调用真实助手。`;
    }

    return {
      snapshot,
      openChat() { state.chatOpen = true; state.notice = ''; emit(); },
      closeChat() { state.chatOpen = false; emit(); },
      setDraft(value) { state.draft = String(value ?? '').slice(0, 12000); emit(); },
      setModel(value) { if (Object.hasOwn(MODELS, value)) { state.modelId = value; emit(); } },
      addAttachments(files) { state.notice = ''; const count = appendAttachments(Array.from(files || [])); emit(); return count; },
      removeAttachment(id) { state.attachments = state.attachments.filter(file => file.id !== id); emit(); },
      send() {
        const text = state.draft.trim();
        if (!text && !state.attachments.length) return false;
        const modelId = state.modelId;
        const files = state.attachments.map(file => copy(file));
        const userId = `demo-message-${++messageCounter}`;
        const replyId = `demo-message-${++messageCounter}`;
        state.messages.push({ id: userId, role: 'user', text, files, status: 'sent', at: Date.now() });
        state.messages.push({ id: replyId, role: 'assistant', modelId, text: '', files: [], status: 'thinking', at: Date.now() });
        state.draft = '';
        state.attachments = [];
        state.notice = '';
        emit();
        const handle = schedule(() => {
          const message = state.messages.find(item => item.id === replyId);
          if (!message || message.status !== 'thinking') return;
          message.text = responseText(text, files, modelId);
          message.status = 'complete';
          replyHandles.delete(replyId);
          emit();
        }, replyDelay);
        replyHandles.set(replyId, handle);
        return true;
      },
      dragEnter() { state.dragOver = true; state.imageState = 'dragging'; state.notice = ''; emit(); },
      dragLeave() { state.dragOver = false; if (state.imageState === 'dragging') state.imageState = 'default'; emit(); },
      drop(files) {
        state.dragOver = false;
        state.droppedFiles = [];
        state.dropErrors = [];
        state.notice = '';
        closeActionSurface();
        for (const value of Array.from(files || [])) {
          const file = normalizeFile(value);
          if (file.isFile) state.droppedFiles.push(file);
          else state.dropErrors.push({ id: file.id, name: file.name, error: file.error || '此项目不是可用的普通文件' });
        }
        state.actionOpen = true;
        state.imageState = state.droppedFiles.length ? 'received' : 'default';
        if (!state.droppedFiles.length && !state.dropErrors.length) state.notice = '没有收到可用文件';
        emit();
      },
      chooseDropAction(action) {
        if (!state.actionOpen) return false;
        if (action === 'chat') {
          state.notice = '';
          appendAttachments(state.droppedFiles);
          const ids = clearDropped();
          state.actionOpen = false;
          state.imageState = 'default';
          state.chatOpen = true;
          emit();
          return { ok: true, clearIds: ids };
        }
        if (action === 'assistant') {
          state.actionOpen = false;
          state.taskOpen = true;
          state.task = { kind: 'summary', notes: '', status: 'ready', result: '', fileCount: state.droppedFiles.length };
          state.imageState = 'received';
          emit();
          return { ok: true };
        }
        if (action === 'images') {
          const images = state.droppedFiles.filter(file => file.isImage && file.imageSupported);
          if (!images.length) {
            state.notice = '这批文件没有可用的 PNG、JPEG 或 WebP 图片';
            emit();
            return { ok: false, error: state.notice };
          }
          state.actionOpen = false;
          state.imageAssignmentOpen = true;
          emit();
          return { ok: true, images: copy(images) };
        }
        return false;
      },
      cancelDrop() {
        const ids = clearDropped();
        closeActionSurface();
        state.actionOpen = false;
        state.imageState = 'default';
        state.notice = '';
        emit();
        return ids;
      },
      closeImageAssignment() {
        const ids = clearDropped();
        state.imageAssignmentOpen = false;
        state.imageState = 'default';
        emit();
        return ids;
      },
      setTaskKind(kind) { if (state.task && ['summary', 'key-points'].includes(kind)) { state.task.kind = kind; emit(); } },
      setTaskNotes(notes) { if (state.task) { state.task.notes = String(notes ?? '').slice(0, 2000); emit(); } },
      startTask() {
        if (!state.task || !['ready', 'cancelled'].includes(state.task.status)) return false;
        clearTaskHandles();
        const epoch = ++taskEpoch;
        state.task.status = 'waiting';
        state.task.result = '';
        state.imageState = 'received';
        emit();
        taskHandles.push(schedule(() => {
          if (epoch !== taskEpoch || !state.task || !state.taskOpen) return;
          state.task.status = 'processing';
          state.imageState = 'processing';
          emit();
          taskHandles.push(schedule(() => {
            if (epoch !== taskEpoch || !state.task || !state.taskOpen) return;
            state.task.status = 'complete';
            state.task.result = taskResult(state.task);
            state.imageState = 'complete';
            emit();
            taskHandles.push(schedule(() => {
              if (epoch !== taskEpoch || state.imageState !== 'complete') return;
              state.imageState = 'default';
              emit();
            }, completionDelay));
          }, taskStepDelay));
        }, taskStepDelay));
        return true;
      },
      closeTask() {
        ++taskEpoch;
        clearTaskHandles();
        state.taskOpen = false;
        state.task = null;
        state.imageState = 'default';
        const ids = clearDropped();
        emit();
        return ids;
      },
      cancelTask() { return this.closeTask(); },
      getTaskResult() { return state.task?.result || ''; },
      setImageMappings(mappings) {
        const next = {};
        for (const [key, value] of Object.entries(mappings || {})) {
          if (!allowedStates.has(key) || !value || typeof value.id !== 'string' || !value.id) continue;
          next[key] = { id: value.id, name: safeName(value.name), mime: String(value.mime || ''), size: Math.max(0, Number(value.size) || 0) };
        }
        state.imageMappings = next;
        emit();
      },
      setImageMapping(key, value) {
        if (!allowedStates.has(key) || !value || typeof value.id !== 'string' || !value.id) return false;
        state.imageMappings[key] = { id: value.id, name: safeName(value.name), mime: String(value.mime || ''), size: Math.max(0, Number(value.size) || 0) };
        emit();
        return true;
      },
      resetImageMapping(key) { if (!allowedStates.has(key)) return false; delete state.imageMappings[key]; emit(); return true; },
      imageLoadFailed(key, id) {
        if (!allowedStates.has(key) || state.imageMappings[key]?.id !== id) return false;
        delete state.imageMappings[key];
        state.notice = `“${STATE_LABELS[key]}”图片无法读取，已恢复内置样式`;
        emit();
        return true;
      },
      dispose() {
        ++taskEpoch;
        clearTaskHandles();
        for (const handle of replyHandles.values()) cancel(handle);
        replyHandles.clear();
        state.imageState = 'default';
        state.dragOver = false;
      },
    };
  }

  globalThis.DesktopDemoModel = Object.freeze({
    STATES, STATE_LABELS, MODELS, COMPLETE_DURATION_MS,
    supportedImageExtensions: Object.freeze([...supportedImageExtensions]),
    createDesktopDemoModel,
    normalizeFile,
  });
})();
