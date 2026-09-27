import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'desktop/ui/demo-model.js'), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(source, context, { filename: 'desktop/ui/demo-model.js' });
const { createDemoModel } = context.WhaleDemoModel;

function controlledClock() {
  const jobs = [];
  return {
    jobs,
    schedule(fn, delay) { const job = { fn, delay, cancelled: false }; jobs.push(job); return job; },
    cancel(job) { if (job) job.cancelled = true; },
    runNext({ evenIfCancelled = false } = {}) {
      const job = jobs.shift();
      assert.ok(job, 'expected a scheduled transition');
      if (evenIfCancelled || !job.cancelled) job.fn();
      return job;
    },
  };
}

const file = (id, name, extra = {}) => ({ id, name, extension: name.split('.').pop(), size: 1200, type: '文件', isFile: true, ...extra });

test('chat opens and closes without losing its draft or existing conversation', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  model.openChat();
  model.setDraft('还在编辑的草稿');
  model.closeChat();
  assert.equal(model.snapshot().chatOpen, false);
  model.openChat();
  assert.equal(model.snapshot().draft, '还在编辑的草稿');
  model.send();
  clock.runNext();
  const beforeClose = model.snapshot();
  model.closeChat();
  model.openChat();
  const afterReopen = model.snapshot();
  assert.equal(afterReopen.messages.length, 2);
  assert.equal(afterReopen.messages[1].text, beforeClose.messages[1].text);
  assert.match(afterReopen.messages[1].text, /快速对话（演示）/);
});

test('model choice is captured in the submitted message and local simulated reply', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  model.setModel('deep');
  model.setDraft('检查这个计划');
  assert.equal(model.send(), true);
  let snapshot = model.snapshot();
  assert.equal(snapshot.messages[1].status, 'thinking');
  assert.equal(snapshot.messages[1].modelId, 'deep');
  clock.runNext();
  snapshot = model.snapshot();
  assert.equal(snapshot.messages[1].status, 'complete');
  assert.match(snapshot.messages[1].text, /深度思考（演示）/);
  assert.match(snapshot.messages[1].text, /检查这个计划/);
  assert.match(snapshot.messages[1].text, /没有调用真实模型/);
  assert.equal(model.send(), false);
});

test('multiple attachments share stable records, deduplicate, remove individually, and cancel cleanly', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  const first = file('a', '预算 表.xlsx', { extension: 'xlsx', type: 'XLSX' });
  const second = file('b', '图片.png', { extension: 'png', type: 'PNG', isImage: true, imageSupported: true });
  assert.equal(model.addAttachments([first, second, first]), 2);
  model.removeAttachment('a');
  assert.deepEqual(model.snapshot().attachments.map(value => value.id), ['b']);
  model.setDraft('');
  assert.equal(model.send(), true, 'attachment-only message can be sent');
  clock.runNext();
  assert.equal(model.snapshot().messages[0].files[0].name, '图片.png');
  model.drop([first, second]);
  const action = model.chooseDropAction('chat');
  assert.equal(action.ok, true);
  assert.deepEqual(model.snapshot().attachments.map(value => value.id), ['a', 'b']);
  assert.equal(model.snapshot().chatOpen, true);
  const cancelled = model.cancelDrop();
  assert.deepEqual(cancelled, []);
  assert.deepEqual(model.snapshot().attachments.map(value => value.id), ['a', 'b']);
});

test('attachment list is capped at 20 across repeated imports and reports ignored files', () => {
  const model = createDemoModel();
  const files = Array.from({ length: 24 }, (_, index) => file(`file-${index}`, `文件-${index}.txt`, { extension: 'txt' }));
  assert.equal(model.addAttachments(files.slice(0, 17)), 17);
  assert.equal(model.addAttachments(files.slice(17)), 3);
  assert.equal(model.snapshot().attachments.length, 20);
  assert.match(model.snapshot().notice, /最多添加 20 个/);
});

test('drag enter, drag leave, drop, and the chat/assistant routes move between explicit states', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel, taskStepDelay: 20, completionDelay: 40 });
  model.dragEnter();
  assert.equal(model.snapshot().imageState, 'dragging');
  model.dragLeave();
  assert.equal(model.snapshot().imageState, 'default');
  model.dragEnter();
  model.drop([file('plain', '报告 2026.txt', { extension: 'txt', type: 'TXT' })]);
  assert.equal(model.snapshot().imageState, 'received');
  const route = model.chooseDropAction('assistant');
  assert.equal(route.ok, true);
  model.setTaskKind('key-points');
  model.setTaskNotes('关注风险与时间安排');
  assert.equal(model.startTask(), true);
  assert.equal(model.snapshot().task.status, 'waiting');
  assert.equal(model.snapshot().imageState, 'received');
  clock.runNext();
  assert.equal(model.snapshot().task.status, 'processing');
  assert.equal(model.snapshot().imageState, 'processing');
  clock.runNext();
  const complete = model.snapshot();
  assert.equal(complete.task.status, 'complete');
  assert.equal(complete.imageState, 'complete');
  assert.match(complete.task.result, /演示结果/);
  assert.match(complete.task.result, /报告 2026\.txt/);
  assert.match(complete.task.result, /关注风险与时间安排/);
  clock.runNext();
  assert.equal(model.snapshot().imageState, 'default');
  model.closeTask();
});

test('drop classification keeps invalid directories visible and blocks image routing without supported images', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  model.drop([{ id: 'folder', name: '我的资料夹', isFile: false, error: '目录暂不支持' }]);
  assert.equal(model.snapshot().actionOpen, true);
  assert.equal(model.snapshot().dropErrors[0].error, '目录暂不支持');
  assert.equal(model.chooseDropAction('images').ok, false);
  model.cancelDrop();
  model.drop([file('doc', '说明.pdf', { extension: 'pdf', isImage: false })]);
  assert.equal(model.chooseDropAction('images').ok, false);
  assert.equal(model.snapshot().imageAssignmentOpen, false);
});

test('state image mappings survive model restoration and broken images fall back to the built-in image', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  const mapping = { id: 'asset-123', name: '雨天小鲸鱼.webp', mime: 'image/webp', size: 8000 };
  assert.equal(model.setImageMapping('received', mapping), true);
  const saved = model.snapshot().imageMappings;
  const restored = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  restored.setImageMappings(saved);
  assert.deepEqual(restored.snapshot().imageMappings.received, mapping);
  assert.equal(restored.imageLoadFailed('received', 'stale-id'), false);
  assert.equal(restored.imageLoadFailed('received', 'asset-123'), true);
  assert.equal(restored.snapshot().imageMappings.received, undefined);
  assert.match(restored.snapshot().notice, /已恢复内置样式/);
});

test('closing a running task invalidates delayed callbacks and restores the avatar state', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  model.drop([file('a', '待处理.md', { extension: 'md' })]);
  model.chooseDropAction('assistant');
  model.startTask();
  const stale = clock.jobs[0];
  model.closeTask();
  stale.fn();
  assert.equal(model.snapshot().task, null);
  assert.equal(model.snapshot().imageState, 'default');
  assert.equal(model.snapshot().taskOpen, false);
});

test('closing during drag and dispose clear transient work without changing saved images', () => {
  const clock = controlledClock();
  const model = createDemoModel({ schedule: clock.schedule, cancel: clock.cancel });
  model.setImageMapping('processing', { id: 'saved', name: '自定义.png', mime: 'image/png', size: 42 });
  model.dragEnter();
  model.dispose();
  assert.equal(model.snapshot().imageState, 'default');
  assert.equal(model.snapshot().dragOver, false);
  assert.equal(model.snapshot().imageMappings.processing.id, 'saved');
});
