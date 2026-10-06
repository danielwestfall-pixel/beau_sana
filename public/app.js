import { moveMentions, mentionQuery } from './mentions.js';
import { renderContent, safeLink } from './content.js';
const el = id => document.getElementById(id);
let profile; let demo = false; let tasks = []; let selectedTask; let generation = 0;
let userStarted = false;
let currentTask; let saving = false; let demoTasks;
let mentions = []; let previousComment = ''; let mentionTimer; let mentionVersion = 0; let activeMention;
let demoFileUrls = [];
let savedToken = false;
async function refreshSavedToken() {
  const info = await api('/api/saved-token'); savedToken = info.saved;
  el('remember-token').disabled = !info.supported;
  el('saved-token-status').textContent = info.saved ? 'A token is saved for this Windows account.' : info.supported ? 'No token is saved on this computer.' : 'Remembering tokens is available on Windows only.';
  el('use-saved-token').hidden = !info.saved; el('forget-token').hidden = !info.saved;
  el('forget-token-connected').hidden = !info.saved || demo;
  return info;
}
const today = new Date();
const dateOffset = days => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const examples = [
  { gid: '101', name: 'Review the welcome packet', due_on: dateOffset(0), projects: [{ name: 'Contractor onboarding' }], notes: 'Read the welcome packet sent by email.\n\nCheck the contact information and let your coordinator know if anything needs updating.' },
  { gid: '102', name: 'Prepare your weekly update', due_on: dateOffset(3), projects: [{ name: 'Weekly work' }], notes: 'Write a short update covering:\n1. Work finished this week.\n2. Work planned for next week.\n3. Any questions or blockers.\n\nSend the update to your coordinator.' },
  { gid: '103', name: 'Read the project brief', due_on: null, projects: [{ name: 'Weekly work' }], notes: 'Review the project brief. Make a note of anything you would like clarified before starting.' },
];
function resetDemo() {
  demoTasks = structuredClone(examples).map(task => ({ ...task, comments: [], attachments: [], handoffRecipient: { gid: 'example-coordinator', name: 'Example coordinator', reason: 'person who initially assigned this task' } }));
  demoTasks[0].notes += '\n\nExample link: https://asana.com/';
  demoTasks[0].attachments = [{ gid: 'demo-file', name: 'Example instructions.txt', demo: true }];
}
resetDemo();
function status(message) { el('status').textContent = message; }
function error(message = '') { el('error').textContent = message; }
function show(view, focusId) {
  for (const name of ['connect', 'tasks', 'detail']) el(`${name}-view`).hidden = name !== view;
  if (focusId) el(focusId).focus();
}
async function api(path, body) {
  let response;
  try { response = await fetch(path, {
    method: body ? 'POST' : 'GET', headers: { 'X-BeauSana': 'local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }); } catch { throw new Error('The local app is not responding. Make sure the BeauSana window is open, then try again.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load your tasks. Try again.');
  return result;
}
function due(task) {
  if (!task.due_on && !task.due_at) return 'No due date';
  const date = task.due_at ? new Date(task.due_at) : new Date(`${task.due_on}T12:00:00`);
  const formatted = date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return 'Due ' + formatted + (task.due_at ? ' at ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
}
function renderTasks() {
  el('task-list').replaceChildren();
  el('task-summary').textContent = tasks.length ? `${tasks.length} unfinished ${tasks.length === 1 ? 'task' : 'tasks'}, ordered by due date.` : 'You have no unfinished tasks assigned to you in this workspace.';
  for (const task of tasks) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#task-${task.gid}`; link.id = `task-${task.gid}`; link.textContent = task.name || 'Untitled task';
    link.addEventListener('click', event => { event.preventDefault(); openTask(task.gid); });
    const info = document.createElement('p');
    info.textContent = due(task) + (task.projects?.length ? ` · ${task.projects.map(p => p.name).join(', ')}` : '');
    li.append(link, info); el('task-list').append(li);
  }
}
async function loadTasks({ focus = false } = {}) {
  const version = ++generation;
  error(); status('Loading your assigned tasks.');
  el('refresh').disabled = true;
  try {
    const result = demo ? { tasks: demoTasks } : await api(`/api/tasks?workspace=${encodeURIComponent(el('workspace').value)}`);
    if (version !== generation) return;
    tasks = result.tasks; renderTasks();
    el('updated').textContent = `${demo ? 'Example tasks' : 'Last refreshed'} · ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    status(`${tasks.length} unfinished ${tasks.length === 1 ? 'task' : 'tasks'} loaded.${demo ? ' These are examples, not live Asana tasks.' : ''}`);
    if (focus) el('tasks-heading').focus();
  } catch (err) {
    if (version !== generation) return;
    status(''); error(err.message);
    el('updated').textContent = tasks.length ? 'Refresh failed. The tasks below are from the previous successful refresh.' : '';
  } finally { if (version === generation) el('refresh').disabled = false; }
}
function enterTasks(focus = true) {
  selectedTask = undefined; currentTask = undefined;
  document.title = 'My tasks — BeauSana';
  el('identity').textContent = demo ? 'Demo mode · Example tasks' : `Connected as ${profile.name}`;
  el('disconnect').textContent = demo ? 'Exit demo' : 'Disconnect';
  el('forget-token-connected').hidden = !savedToken || demo;
  el('workspace').replaceChildren();
  for (const workspace of profile.workspaces) {
    const option = document.createElement('option'); option.value = workspace.gid; option.textContent = workspace.name;
    el('workspace').append(option);
  }
  el('workspace-control').hidden = profile.workspaces.length < 2;
  show('tasks'); tasks = []; renderTasks();
  if (!profile.workspaces.length) { status(''); error('Your Asana account has no available workspaces.'); if (focus) el('tasks-heading').focus(); return; }
  loadTasks({ focus });
}
async function openTask(gid) {
  const version = ++generation; error(); status('Loading task instructions.');
  try {
    const task = demo ? demoTasks.find(item => item.gid === gid) : (await api(`/api/tasks/${gid}?workspace=${encodeURIComponent(el('workspace').value)}`)).task;
    if (version !== generation) return;
    if (selectedTask !== gid) {
      el('description-addition').value = ''; el('comment-text').value = ''; el('upload-file').value = '';
      el('uploaded-files').replaceChildren();
      clearMentions();
      for (const details of el('task-actions').querySelectorAll('details')) details.open = false;
    }
    currentTask = task;
    selectedTask = gid;
    el('detail-heading').textContent = task.name || 'Untitled task';
    document.title = `${task.name || 'Task'} — BeauSana`;
    el('task-meta').replaceChildren();
    const meta = [['Due date', due(task)]];
    if (task.completed) meta.push(['Status', 'Completed']);
    if (task.projects?.length) meta.push(['Project', task.projects.map(p => p.name).join(', ')]);
    if (task.parent?.name) meta.push(['Part of', task.parent.name]);
    for (const [name, value] of meta) {
      const dt = document.createElement('dt'); dt.textContent = name;
      const dd = document.createElement('dd'); dd.textContent = value; el('task-meta').append(dt, dd);
    }
    renderContent(el('instructions'), task.notes || 'No instructions have been added to this task.', task.descriptionHtml);
    renderAttachments();
    renderActions();
    const link = el('asana-link'); link.hidden = true; link.removeAttribute('href');
    if (!demo && task.permalink_url) {
      try {
        const url = new URL(task.permalink_url);
        if (url.protocol === 'https:' && url.hostname === 'app.asana.com') { link.href = url.href; link.hidden = false; }
      } catch { /* No external link for an invalid URL. */ }
    }
    status(''); show('detail', 'detail-heading');
  } catch (err) { if (version === generation) { status(''); error(err.message); } }
  finally { if (version === generation) el('refresh').disabled = false; }
}
async function connect(body, focus = true) {
  error(); status('Connecting to Asana.'); el('connect-button').disabled = true; el('demo-button').disabled = true; el('use-saved-token').disabled = true;
  try {
    const result = await api('/api/connect', body);
    profile = result.profile; demo = false;
    await refreshSavedToken(); enterTasks(focus);
    if (result.warning) error(result.warning);
  } catch (err) { status(''); error(err.message); if (focus) el('token').focus(); }
  finally { el('connect-button').disabled = false; el('demo-button').disabled = false; el('use-saved-token').disabled = false; }
}
el('connect-form').addEventListener('submit', event => {
  event.preventDefault(); userStarted = true;
  const token = el('token').value; el('token').value = '';
  connect({ token, remember: el('remember-token').checked });
});
el('use-saved-token').addEventListener('click', () => { userStarted = true; connect({ useSaved: true }); });
async function forgetToken() {
  userStarted = true; ++generation; error();
  el('forget-token').disabled = true; el('forget-token-connected').disabled = true;
  try {
    await api('/api/forget-token', {});
    demo = false; profile = undefined; tasks = []; currentTask = undefined; selectedTask = undefined;
    el('token').value = ''; el('remember-token').checked = false;
    el('task-list').replaceChildren(); el('instructions').replaceChildren(); el('attachments').replaceChildren();
    el('comment-text').value = ''; clearMentions();
    await refreshSavedToken(); document.title = 'Connect to Asana — BeauSana';
    show('connect', 'connect-heading'); status('Saved token removed. Disconnected from Asana.');
  } catch (err) { error(err.message); }
  finally { el('forget-token').disabled = false; el('forget-token-connected').disabled = false; }
}
el('forget-token').addEventListener('click', forgetToken);
el('forget-token-connected').addEventListener('click', forgetToken);
el('demo-button').addEventListener('click', () => {
  userStarted = true; demo = true; resetDemo(); profile = { name: 'Example contractor', workspaces: [{ gid: 'demo', name: 'Example workspace' }] }; enterTasks();
});
el('refresh').addEventListener('click', () => loadTasks());
el('workspace').addEventListener('change', () => { tasks = []; renderTasks(); el('updated').textContent = ''; loadTasks(); });
el('disconnect').addEventListener('click', async () => {
  ++generation; el('disconnect').disabled = true; error();
  try {
    if (!demo) await api('/api/disconnect', {});
    demo = false; profile = undefined; tasks = []; selectedTask = undefined; currentTask = undefined;
    el('task-list').replaceChildren(); el('instructions').textContent = ''; el('token').value = '';
    el('comment-text').value = ''; clearMentions();
    document.title = 'Connect to Asana — BeauSana'; status('Disconnected.'); show('connect', 'connect-heading');
  } catch (err) { error(err.message); }
  finally { el('disconnect').disabled = false; el('refresh').disabled = false; }
});
el('back').addEventListener('click', event => {
  if (saving) { event.preventDefault(); return; }
  event.preventDefault(); ++generation; error(); status(''); document.title = 'My tasks — BeauSana'; show('tasks');
  dismissMentions();
  (el(`task-${selectedTask}`) || el('tasks-heading')).focus();
});
function renderComments() {
  el('comments').replaceChildren();
  const comments = currentTask.comments || [];
  el('comments-help').textContent = currentTask.historyUnavailable ? 'Comments could not be loaded. Reload the task to try again.' : comments.length ? '' : 'No comments yet.';
  for (const comment of comments) {
    const li = document.createElement('li');
    const author = document.createElement('strong'); author.textContent = comment.created_by?.name || 'Asana user';
    const text = document.createElement('div'); text.className = 'comment-body'; renderContent(text, comment.text || '', comment.html_text);
    li.append(author, text); el('comments').append(li);
  }
}
function renderAttachments() {
  for (const url of demoFileUrls) URL.revokeObjectURL(url);
  demoFileUrls = []; el('attachments').replaceChildren();
  const attachments = currentTask.attachments || [];
  el('attachments-help').textContent = currentTask.attachmentsUnavailable ? 'Files could not be loaded. Reload the task to try again.' : attachments.length ? (demo ? 'Demo downloads contain example text only.' : 'Download links open in a new tab. Cloud files may open in their provider and require sign-in.') : 'No attached files.';
  for (const attachment of attachments) {
    const li = document.createElement('li'); const link = document.createElement('a');
    const name = attachment.name || 'Unnamed file';
    link.textContent = `Download ${name}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `Download ${name} (opens in a new tab)`);
    if (demo) {
      const url = URL.createObjectURL(new Blob(['BeauSana example attachment.\nThis is demo content, not a file from Asana.'], { type: 'text/plain' }));
      demoFileUrls.push(url); link.href = url; link.download = name;
    } else {
      link.href = `/api/tasks/${selectedTask}/attachments/${encodeURIComponent(attachment.gid)}/download?workspace=${encodeURIComponent(el('workspace').value)}`;
    }
    li.append(link);
    const viewUrl = safeLink(attachment.view_url || attachment.permanent_url);
    if (!demo && viewUrl) {
      li.append(document.createTextNode(' · '));
      const view = document.createElement('a'); view.href = viewUrl; view.textContent = `View ${name}`;
      view.target = '_blank'; view.rel = 'noopener noreferrer'; view.setAttribute('aria-label', `View ${name} (opens in a new tab)`); li.append(view);
    }
    el('attachments').append(li);
  }
}
function renderActions() {
  el('action-help').textContent = demo ? 'Demo mode: changes affect these examples only. Files are not sent anywhere.' : 'Each submitted action saves directly to Asana.';
  const previous = currentTask.handoffRecipient;
  el('complete-task').disabled = currentTask.completed === true;
  const approval = currentTask.resource_subtype === 'approval';
  el('complete-task').textContent = approval ? 'Approve and complete task' : 'Mark task complete';
  el('complete-help').textContent = approval ? 'This is an Asana approval task. Completing it also approves it and removes it from your unfinished list.' : 'Mark this task complete in Asana when your work is finished. It will leave your unfinished task list.';
  el('handoff').disabled = !previous;
  el('handoff').textContent = previous ? `Reassign to ${previous.name || 'Asana user ' + previous.gid}` : 'Hand back unavailable';
  el('handoff-help').textContent = previous ? `Hand back to ${previous.name || 'Asana user ' + previous.gid}, the ${previous.reason}. Reassigning removes this task from your list.` : 'No other person could be identified as the previous assignee, initial assigner, or task creator. Use Asana to select the recipient.';
  renderComments();
}
async function saveAction(message, focusId, action) {
  if (saving) return;
  saving = true; error(); status(message);
  dismissMentions();
  el('task-actions').disabled = true; el('reload-task').disabled = true; el('back').setAttribute('aria-disabled', 'true');
  let success;
  try { success = await action(); }
  catch (err) { status(''); error(err.message); }
  finally {
    saving = false; el('task-actions').disabled = false; el('reload-task').disabled = false; el('back').removeAttribute('aria-disabled');
    el('handoff').disabled = !currentTask?.handoffRecipient;
    el('complete-task').disabled = currentTask?.completed === true;
    if (focusId && !el('detail-view').hidden) el(focusId).focus();
    if (success) status(success + (demo ? ' Example task only; Asana was not changed.' : ''));
  }
}
const actionPath = kind => `/api/tasks/${selectedTask}/${kind}?workspace=${encodeURIComponent(el('workspace').value)}`;
el('reload-task').addEventListener('click', () => { if (!saving) openTask(selectedTask); });
el('description-form').addEventListener('submit', event => {
  event.preventDefault();
  saveAction('Adding to the description.', 'description-addition', async () => {
    const text = el('description-addition').value.trim();
    if (!text) throw new Error('Enter some text to add.');
    if (demo) currentTask.notes = (currentTask.notes || '') + '\n\n' + text;
    else {
      const { result } = await api(actionPath('description'), { text, descriptionVersion: currentTask.descriptionVersion });
      currentTask.notes = result.notes; currentTask.descriptionHtml = result.descriptionHtml; currentTask.descriptionVersion = result.descriptionVersion;
    }
    renderContent(el('instructions'), currentTask.notes, currentTask.descriptionHtml); el('description-addition').value = '';
    return 'Description addition saved.';
  });
});
el('comment-form').addEventListener('submit', event => {
  event.preventDefault();
  saveAction('Posting your comment.', 'comment-text', async () => {
    const text = el('comment-text').value;
    if (!text.trim()) throw new Error('Enter a comment.');
    const comment = demo ? { text, created_by: { name: 'Example contractor' } } : (await api(actionPath('comments'), { text, mentions })).result;
    currentTask.comments ||= []; currentTask.comments.push({ ...comment, text, created_by: comment.created_by || { name: profile.name } });
    renderComments(); el('comment-text').value = ''; clearMentions(); return 'Comment posted.';
  });
});
function dismissMentions() {
  ++mentionVersion; clearTimeout(mentionTimer); activeMention = undefined;
  el('mention-panel').hidden = true; el('mention-suggestions').replaceChildren(); el('mention-status').textContent = '';
}
function clearMentions() {
  dismissMentions(); mentions = []; previousComment = el('comment-text').value; announceMentions();
}
function announceMentions() {
  const names = [...new Set(mentions.map(mention => mention.label))];
  el('selected-mentions').textContent = names.length ? `People tagged: ${names.join(', ')}.` : '';
}
function findMentions() {
  const input = el('comment-text');
  mentions = moveMentions(previousComment, input.value, mentions); previousComment = input.value; announceMentions();
  const query = mentionQuery(input.value, input.selectionStart, mentions);
  dismissMentions();
  if (!query || saving) return;
  activeMention = query;
  const version = mentionVersion; const gid = selectedTask; const draft = input.value;
  el('mention-panel').hidden = false; el('mention-status').textContent = 'Searching for people to mention.';
  mentionTimer = setTimeout(async () => {
    try {
      const people = demo ? [{ gid: 'example-coordinator', name: 'Example coordinator' }, { gid: 'example-contractor', name: 'Example contractor' }].filter(person => person.name.toLowerCase().includes(query.query.toLowerCase())) : (await api(actionPath('people') + `&query=${encodeURIComponent(query.query)}`)).people;
      if (version !== mentionVersion || gid !== selectedTask || draft !== input.value) return;
      el('mention-status').textContent = people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} found. Tab to a suggestion and press Enter.` : 'No matching people found. Try a different name. Plain text will not tag anyone.';
      for (const person of people) {
        const li = document.createElement('li'); const button = document.createElement('button');
        button.type = 'button'; button.className = 'secondary'; button.textContent = `Mention ${person.name}`;
        button.addEventListener('click', () => {
          if (saving || !activeMention || version !== mentionVersion || draft !== input.value) return;
          const label = `@${person.name}`; const next = draft.slice(0, query.start) + label + ' ' + draft.slice(query.end);
          mentions = moveMentions(draft, next, mentions);
          mentions.push({ gid: person.gid, label, start: query.start, end: query.start + label.length });
          input.value = next; previousComment = next; dismissMentions(); announceMentions();
          input.focus(); input.setSelectionRange(query.start + label.length + 1, query.start + label.length + 1);
        });
        li.append(button); el('mention-suggestions').append(li);
      }
    } catch (err) {
      if (version === mentionVersion) el('mention-status').textContent = `People suggestions unavailable. ${err.message} Unselected names remain plain text.`;
    }
  }, 250);
}
el('comment-text').addEventListener('input', findMentions);
el('comment-text').addEventListener('click', findMentions);
el('comment-text').addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) findMentions(); });
el('comment-form').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el('mention-panel').hidden) { event.preventDefault(); dismissMentions(); el('comment-text').focus(); }
});
el('file-form').addEventListener('submit', event => {
  event.preventDefault();
  saveAction('Uploading your file. Please wait.', 'upload-file', async () => {
    const file = el('upload-file').files[0];
    if (!file || !file.size) throw new Error('Choose a non-empty file.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file of 25 MiB or smaller.');
    let attachment;
    if (!demo) {
      let response;
      try { response = await fetch(actionPath('file'), { method: 'POST', headers: { 'X-BeauSana': 'local', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file }); }
      catch { throw new Error('The upload result could not be confirmed. Check the task in Asana before uploading again.'); }
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The file could not be uploaded.');
      attachment = result.result;
    }
    currentTask.attachments ||= []; currentTask.attachments.push(attachment || { gid: `demo-${Date.now()}`, name: file.name, demo: true }); renderAttachments();
    const li = document.createElement('li'); li.textContent = `${demo ? 'Example attachment' : 'Uploaded'}: ${file.name}`;
    el('uploaded-files').append(li); el('upload-file').value = ''; return demo ? 'Example attachment added.' : 'File uploaded.';
  });
});
el('handoff').addEventListener('click', () => {
  saveAction('Reassigning the task.', 'handoff', async () => {
    const previous = currentTask.handoffRecipient;
    if (!previous) throw new Error('The previous assignee is unavailable.');
    if (!demo) await api(actionPath('reassign'), { assignee: previous.gid });
    if (demo) demoTasks = demoTasks.filter(task => task.gid !== selectedTask);
    tasks = tasks.filter(task => task.gid !== selectedTask); renderTasks();
    currentTask = undefined; selectedTask = undefined;
    document.title = 'My tasks — BeauSana'; show('tasks', 'tasks-heading');
    return `Task reassigned to ${previous.name || 'the previous assignee'}.`;
  });
});
el('complete-task').addEventListener('click', () => {
  saveAction('Marking the task complete.', undefined, async () => {
    if (!demo) await api(actionPath('complete'), {});
    if (demo) demoTasks = demoTasks.filter(task => task.gid !== selectedTask);
    tasks = tasks.filter(task => task.gid !== selectedTask); renderTasks();
    currentTask = undefined; selectedTask = undefined;
    document.title = 'My tasks — BeauSana'; show('tasks', 'tasks-heading');
    return 'Task marked complete and removed from your unfinished list.';
  });
});
// Restore only at page startup; Disconnect does not immediately reconnect.
el('connect-button').disabled = true; el('demo-button').disabled = true;
(async () => {
  try {
    const info = await refreshSavedToken();
    if (userStarted) return;
    try { const result = await api('/api/session'); profile = result.profile; enterTasks(false); }
    catch { if (info.saved && !userStarted) await connect({ useSaved: true }, false); }
  } catch (err) { error(err.message); }
  finally { el('connect-button').disabled = false; el('demo-button').disabled = false; }
})();
