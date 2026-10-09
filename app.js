(function () {
  'use strict';
  const C = globalThis.JournalCore;
  const LEGACY_KEY = 'shiguang-journal-v1';
  let KEY = LEGACY_KEY, DRAFT = KEY + '-draft', PREFS = KEY + '-preferences', editorBaseline = null, editorWorkspace = KEY;
  const $ = selector => document.querySelector(selector);
  const palettes = [
    { id: 'sage', name: '浅绿', color: '#c9e4c7', ink: '#315d3d' },
    { id: 'pink', name: '粉红', color: '#f4cddd', ink: '#7b4259' },
    { id: 'sky', name: '天蓝', color: '#c9e5f7', ink: '#305e79' },
    { id: 'lavender', name: '浅紫', color: '#dfd5f3', ink: '#655080' },
    { id: 'peach', name: '杏橙', color: '#f5dcc0', ink: '#855930' }
  ];
  let data = C.empty(), view = 'home', query = '', filter = 'all', sort = 'newest';
  let prefs = { palette: 'sage', dark: false, title: '我的人生清单' };
  let damagedRaw = null, storageLocked = false, toastTimer, undoAction, confirmResolve, imageUrls = [], imageGeneration = 0;
  function node(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (value !== null && value !== undefined) element.setAttribute(key, String(value));
    }
    for (const child of children.flat()) if (child !== null && child !== undefined) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return element;
  }
  function replace(element, children) { element.replaceChildren(...children); }
  function button(text, action, id, className = 'mini-btn', label) {
    return node('button', { type: 'button', class: className, 'data-action': action, 'data-id': id, 'aria-label': label || text }, text);
  }
  function localDate(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function displayDate(value) { return value ? value.slice(0, 10).replaceAll('-', '.') : ''; }
  function freshId() { return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function warning(message) { $('#storage-warning').textContent = message; $('#storage-warning').hidden = !message; }
  function toast(message, undo) {
    clearTimeout(toastTimer); undoAction = undo || null;
    $('#toast-text').textContent = message; $('#undo-btn').hidden = !undo; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; undoAction = null; }, undo ? 12000 : 4500);
  }
  function save(next, recovery = false) {
    if (storageLocked && !recovery) throw new Error('原有数据无法读取。请打开「数据与备份」下载原始数据，再导入有效备份恢复。');
    if (globalThis.JournalCloud && JournalCloud.active()) {
      data = JournalCloud.save(data, C.parseData(next)); render(); return data;
    }
    let validated = C.parseData(next);
    if (!recovery) {
      let latestRaw;
      try { latestRaw = localStorage.getItem(KEY); }
      catch (_) { throw new Error('没有保存成功：浏览器存储不可用。编辑框中的内容仍在，请检查浏览器设置。'); }
      let latest;
      try { latest = latestRaw ? C.parseData(JSON.parse(latestRaw)) : C.empty(); }
      catch (_) {
        damagedRaw = latestRaw; storageLocked = true; $('#recovery-btn').hidden = false;
        warning('另一标签页的存储数据无法读取，已保留原始数据。请打开「数据与备份」下载原始数据。');
        throw new Error('没有保存成功：当前存储数据无法读取。请先备份原始数据，再导入有效备份恢复。');
      }
      validated = C.applyChanges(data, validated, latest);
    }
    try {
      if (recovery && damagedRaw !== null) localStorage.setItem(KEY + '-recovery-' + Date.now(), damagedRaw);
      localStorage.setItem(KEY, JSON.stringify(validated));
    } catch (error) { throw new Error('没有保存成功：浏览器存储不可用或空间不足。请检查浏览器设置；编辑框中的内容仍在。'); }
    data = validated; storageLocked = false; damagedRaw = null; warning(''); render(); return validated;
  }
  function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (_) { /* preferences may remain session-only */ } }
  function applyPalette() {
    const p = palettes.find(x => x.id === prefs.palette) || palettes[0];
    document.documentElement.style.setProperty('--accent', p.color);
    document.documentElement.style.setProperty('--accent-ink', p.ink);
    document.body.classList.toggle('dark', prefs.dark === true);
    $('#theme-btn').setAttribute('aria-label', prefs.dark ? '切换浅色主题' : '切换深色主题');
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { try { data = C.parseData(JSON.parse(raw)); } catch (e) { damagedRaw = raw; storageLocked = true; warning('原有记录无法读取，已保留原始数据。请打开右上角「数据与备份」下载原始数据，再导入有效备份。'); } }
    } catch (e) { warning('浏览器存储目前不可用。保存失败时会明确提示；请允许此网站使用本地存储。'); }
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || 'null');
      if (p && typeof p === 'object') prefs = { palette: palettes.some(x => x.id === p.palette) ? p.palette : 'sage', dark: p.dark === true, title: typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 50) : '我的人生清单' };
    } catch (_) {}
    applyPalette(); $('#snapshot-title').value = prefs.title;
  }
  function showDialog(id) { const d = $('#' + id); if (!d.open) d.showModal(); }
  function confirm(message, title = '确认操作') {
    $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
    showDialog('confirm'); return new Promise(resolve => { confirmResolve = resolve; });
  }
  function finishConfirm(answer) { $('#confirm').close(); if (confirmResolve) { const resolve = confirmResolve; confirmResolve = null; resolve(answer); } }
  function switchView(next) {
    if (!['home', 'notes', 'goals'].includes(next)) return;
    view = next; query = ''; filter = 'all'; $('#search-input').value = ''; render();
  }
  function filtered(items) {
    return items.filter(item => C.matches(item, query) && (filter === 'all' || (filter === 'favorite' ? item.favorite : filter.startsWith('cat:') ? item.category === filter.slice(4) : item.status === filter)))
      .sort((a, b) => (sort === 'oldest' ? 1 : -1) * (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)));
  }
  function noteCard(item) {
    return node('article', { class: 'note-card' },
      node('div', { class: 'note-meta' }, node('span', { class: 'badge' }, item.category), node('span', {}, item.mood)),
      node('h3', {}, button(item.title, 'read-note', item.id, 'note-open', '阅读感悟：' + item.title)),
      node('p', { class: 'note-excerpt' }, item.content),
      node('div', { class: 'tags' }, item.tags.map(t => node('span', { class: 'tag' }, '#' + t))),
      node('div', { class: 'note-bottom' }, node('time', { datetime: item.date }, displayDate(item.date)),
        node('div', { class: 'mini-actions' },
          button(item.favorite ? '★' : '☆', 'favorite', item.id, 'mini-btn' + (item.favorite ? ' fav' : ''), item.favorite ? '取消收藏' : '收藏这篇感悟'),
          button('编辑', 'edit-note', item.id), button('删除', 'delete-note', item.id))));
  }
  function goalCard(item) {
    const done = item.status === 'done';
    return node('article', { class: 'goal-card' + (done ? ' done' : '') },
      node('div', { class: 'goal-heading' }, button(done ? '✓' : '', 'toggle-goal', item.id, 'check-btn' + (done ? ' done' : ''), done ? '将“' + item.title + '”恢复为未完成' : '完成“' + item.title + '”'), node('h3', {}, item.title)),
      node('div', { class: 'goal-info' }, node('span', { class: 'badge' }, item.category), node('span', { class: 'goal-status' + (done ? ' completed' : '') }, done ? '✓ 已完成' : item.status === 'doing' ? '↗ 正在做' : '○ 想去做'), item.dueDate ? node('span', {}, '目标 ' + displayDate(item.dueDate)) : null),
      item.description ? node('p', {}, item.description) : null,
      !done && item.nextStep ? node('div', { class: 'goal-next' }, '下一步 · ' + item.nextStep) : null,
      done && item.reflection ? node('p', {}, '完成心得 · ' + item.reflection) : null,
      node('div', { class: 'note-bottom' }, node('span', { class: 'muted' }, done ? '完成于 ' + displayDate(localDate(new Date(item.completedAt))) : '给未来的自己'),
        node('div', { class: 'mini-actions' }, button(done ? '写心得' : '编辑', 'edit-goal', item.id), button('删除', 'delete-goal', item.id))));
  }
  function emptyState(kind, searched) {
    return node('div', { class: 'empty' }, node('div', { class: 'empty-symbol', 'aria-hidden': 'true' }, kind === 'note' ? '✎' : '✧'),
      node('h3', {}, searched ? '这里暂时没有匹配的记录' : kind === 'note' ? '今天，想记住什么？' : '把想做的事，一件件写下来。'),
      node('p', {}, searched ? '换个关键词，或清除筛选再看看。' : kind === 'note' ? '一段文字，一个新发现，都值得留在这里。' : '从一件小事开始。完成后，在清单上留下你的颜色。'),
      button(searched ? '清除搜索与筛选' : kind === 'note' ? '＋ 写下第一篇感悟' : '＋ 添加我的第一件事', searched ? 'clear-filter' : kind === 'note' ? 'new-note' : 'new-goal', null, 'btn primary'),
      kind === 'goal' && !searched ? button('从灵感清单开始', 'add-ideas', null, 'btn secondary') : null);
  }
  function renderFilters() {
    const options = view === 'goals' ? [['all', '全部'], ['planned', '想去做'], ['doing', '正在做'], ['done', '已完成']] : [['all', '全部'], ['favorite', '收藏'], ...C.NOTE_CATEGORIES.map(x => ['cat:' + x, x])];
    replace($('#filters'), options.map(([id, label]) => node('button', { type: 'button', class: 'filter' + (filter === id ? ' active' : ''), 'data-filter': id, 'aria-pressed': filter === id }, label)));
  }
  function renderSidebar() {
    const pending = data.goals.filter(x => x.status !== 'done').slice().sort((a, b) => Number(b.status === 'doing') - Number(a.status === 'doing') || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
    const stats = C.summary(data);
    const wish = node('section', { class: 'side-card' }, node('div', { class: 'eyebrow' }, 'LITTLE WISHES'),
      node('div', { class: 'side-heading' }, node('h3', {}, '人生，有好多可能'), button('查看全部 ↗', 'view-goals', null, 'side-link')),
      node('p', {}, '已完成 ' + stats.completed + ' / ' + stats.total + ' · ' + stats.percent + '%'),
      node('div', { class: 'progress-track' }, node('span', { style: 'width:' + stats.percent + '%' })),
      ...(pending.length ? pending.map(x => node('div', { class: 'side-goal' }, button('', 'toggle-goal', x.id, 'check-btn', '完成“' + x.title + '”'), node('div', {}, button(x.title, 'edit-goal', x.id, 'side-goal-title'), node('small', {}, x.nextStep || x.category)))) : [node('p', {}, stats.total ? '这一页的愿望都实现了，再添一点新的期待吧。' : '还没有心愿。从一件一直想做的小事开始。')]),
      button('＋ 添加心愿', 'new-goal', null, 'btn secondary'));
    const dates = new Set([...data.notes.map(x => x.date), ...data.goals.filter(x => x.completedAt).map(x => localDate(new Date(x.completedAt)))]);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); const k = localDate(d);
      days.push(node('div', { class: 'day', title: k + (dates.has(k) ? ' 有记录' : ' 暂无记录') }, node('span', {}, ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]), node('i', { class: dates.has(k) ? 'filled' : '', 'aria-label': dates.has(k) ? '有记录' : '暂无记录' }), node('span', {}, d.getDate())));
    }
    const week = node('section', { class: 'side-card' }, node('div', { class: 'eyebrow' }, 'RECENT LITTLE STEPS'), node('h3', {}, '最近七天'), node('div', { class: 'week' }, days), node('p', {}, '有感悟或完成心愿的日子，会留下一个记号。'));
    const quote = node('section', { class: 'side-card' }, node('div', { class: 'eyebrow' }, 'A GENTLE REMINDER'), node('div', { class: 'quote' }, '生活不是赶路，', node('br'), '是感受路。'), node('p', {}, '不用一次实现所有心愿。让今天，有一点点不一样。'));
    replace($('#sidebar'), [wish, week, quote]);
  }
  function render() {
    const stats = C.summary(data);
    $('#stat-notes').textContent = stats.notes; $('#stat-done').textContent = stats.completed; $('#stat-total').textContent = stats.total; $('#stat-doing').textContent = stats.doing;
    $('#hero').hidden = view !== 'home';
    for (const nav of document.querySelectorAll('.nav')) { nav.classList.toggle('active', nav.dataset.view === view); if (nav.dataset.view === view) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current'); }
    const titles = { home: ['最近的日常', '写下来，是为了记得；去做，是为了经历。'], notes: ['学习感悟', '把知识变成自己的理解，把理解写成自己的话。'], goals: ['人生清单', '不止是待办事项，也是我想认真经历的人生。'] };
    $('#view-title').textContent = titles[view][0]; $('#view-description').textContent = titles[view][1];
    $('#create-btn').textContent = view === 'goals' ? '＋ 添加人生事项' : '＋ 新感悟';
    $('#search-input').placeholder = view === 'goals' ? '搜索人生事项、下一步或完成心得…' : '搜索标题、正文或标签…';
    $('#sidebar').hidden = view !== 'home'; $('#content-grid').classList.toggle('full', view !== 'home');
    renderFilters(); renderSidebar();
    const items = filtered(view === 'goals' ? data.goals : data.notes);
    replace($('#records'), items.length ? [node('div', { class: view === 'goals' ? 'goals-grid' : 'notes-grid' }, items.map(view === 'goals' ? goalCard : noteCard))] : [emptyState(view === 'goals' ? 'goal' : 'note', !!query.trim() || filter !== 'all')]);
    $('#recovery-btn').hidden = damagedRaw === null;
    if ($('#preview').open) renderSnapshot();
  }
  function setOptions(selector, values, selected) { replace($(selector), values.map(x => node('option', { value: x, selected: x === selected ? '' : null }, x))); }
  function openEditor(kind, item) {
    editorBaseline = item ? JSON.stringify(item) : null; editorWorkspace = KEY;
    const form = $('#editor-form'); form.reset(); $('#editor-error').hidden = true;
    $('#edit-kind').value = kind; $('#edit-id').value = item ? item.id : '';
    $('#editor-title').textContent = kind === 'note' ? item ? '编辑这篇感悟' : '写一篇感悟' : item ? '更新人生事项' : '添加一件想做的事';
    $('#editor-eyebrow').textContent = kind === 'note' ? 'A MOMENT TO REMEMBER' : 'SOMETHING TO LOOK FORWARD TO';
    $('#note-fields').hidden = kind !== 'note'; $('#goal-fields').hidden = kind !== 'goal'; $('#date-field').hidden = kind !== 'note'; $('#mood-field').hidden = kind !== 'note';
    $('#edit-content').required = kind === 'note'; $('#edit-date').required = kind === 'note';
    setOptions('#edit-category', kind === 'note' ? C.NOTE_CATEGORIES : C.GOAL_CATEGORIES, item && item.category);
    setOptions('#edit-mood', C.MOODS, item && item.mood);
    $('#edit-date').value = item && item.date || localDate(); $('#edit-title').value = item && item.title || '';
    if (kind === 'note') {
      $('#edit-content').value = item && item.content || ''; $('#edit-tags').value = item ? item.tags.join(', ') : '';
      if (!item) {
        try {
          const draft = JSON.parse(localStorage.getItem(DRAFT) || 'null');
          if (draft && typeof draft.title === 'string' && typeof draft.content === 'string') {
            $('#edit-title').value = draft.title.slice(0, 120); $('#edit-content').value = draft.content.slice(0, 20000);
            $('#edit-tags').value = typeof draft.tags === 'string' ? draft.tags.slice(0, 210) : '';
            if (C.NOTE_CATEGORIES.includes(draft.category)) $('#edit-category').value = draft.category;
            if (C.MOODS.includes(draft.mood)) $('#edit-mood').value = draft.mood;
            try { $('#edit-date').value = C.date(draft.date); } catch (_) {}
          }
        } catch (_) {}
      }
    } else {
      $('#edit-status').value = item && item.status || 'planned'; $('#edit-due').value = item && item.dueDate || '';
      $('#edit-description').value = item && item.description || ''; $('#edit-next').value = item && item.nextStep || ''; $('#edit-reflection').value = item && item.reflection || '';
    }
    $('#draft-hint').textContent = kind === 'note' && !item ? '新感悟会自动保存草稿' : '保存后会更新这条记录';
    showDialog('editor');
  }
  function persistDraft() {
    if ($('#edit-kind').value !== 'note' || $('#edit-id').value) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ title: $('#edit-title').value, content: $('#edit-content').value, tags: $('#edit-tags').value, category: $('#edit-category').value, mood: $('#edit-mood').value, date: $('#edit-date').value })); $('#draft-hint').textContent = '草稿已保存在此浏览器'; }
    catch (_) { $('#draft-hint').textContent = '草稿未能保存，请保持编辑框打开'; }
  }
  function submitRecord(event) {
    event.preventDefault();
    const kind = $('#edit-kind').value, collection = kind === 'note' ? 'notes' : 'goals', old = data[collection].find(x => x.id === $('#edit-id').value), now = new Date().toISOString();
    try {
      if (editorWorkspace !== KEY) throw new Error('当前账号已变化，请先复制编辑内容，再重新打开记录。');
      if ($('#edit-id').value && (!old || JSON.stringify(old) !== editorBaseline)) throw new Error('另一设备或标签页更新了这条记录。请先复制当前修改，再重新打开最新记录，避免覆盖其他修改。');
      const fields = { id: old ? old.id : freshId(), title: $('#edit-title').value, category: $('#edit-category').value, createdAt: old ? old.createdAt : now, updatedAt: now };
      if (kind === 'note') Object.assign(fields, { content: $('#edit-content').value, date: $('#edit-date').value, tags: $('#edit-tags').value.split(/[,，]/).map(x => x.trim()).filter(Boolean), mood: $('#edit-mood').value, favorite: old ? old.favorite : false });
      else {
        const status = $('#edit-status').value;
        Object.assign(fields, { description: $('#edit-description').value, nextStep: $('#edit-next').value, dueDate: $('#edit-due').value, status, reflection: $('#edit-reflection').value, completedAt: status === 'done' ? old && old.status === 'done' ? old.completedAt : now : null });
      }
      const item = C.record(fields, kind, now);
      if (!old && data[collection].length >= C.LIMIT) throw new Error('最多保存 ' + C.LIMIT + ' 条，请先整理旧记录');
      save({ ...data, [collection]: old ? data[collection].map(x => x.id === old.id ? item : x) : [item, ...data[collection]] });
      if (kind === 'note' && !old) { try { localStorage.removeItem(DRAFT); } catch (_) {} }
      $('#editor').close(); if ($('#reader').open) readNote(item.id);
      toast(globalThis.JournalCloud && JournalCloud.active() ? '已保存在本机，正在同步到你的账号。' : kind === 'goal' && item.status === 'done' ? '又实现了一件事，值得记住。' : '记录已保存。');
    } catch (e) { $('#editor-error').textContent = e.message; $('#editor-error').hidden = false; }
  }
  function readNote(id) {
    const item = data.notes.find(x => x.id === id); if (!item) return;
    $('#reader-title').textContent = item.title; $('#reader-meta').textContent = item.category + ' · ' + item.mood;
    $('#reader-content').textContent = item.content; $('#reader-date').textContent = displayDate(item.date);
    replace($('#reader-tags'), [node('div', { class: 'tags' }, item.tags.map(x => node('span', { class: 'tag' }, '#' + x)))]);
    $('#reader-edit').dataset.id = id; showDialog('reader');
  }
  function toggleGoal(id) {
    const old = data.goals.find(x => x.id === id); if (!old) return;
    const status = old.status === 'done' ? 'planned' : 'done';
    save({ ...data, goals: data.goals.map(x => x.id === id ? C.transitionGoal(x, status) : x) });
    toast(status === 'done' ? '已完成！清单和完成数量都更新了。' : '已恢复为「想去做」。', () => { save({ ...data, goals: data.goals.map(x => x.id === id ? { ...old, updatedAt: new Date().toISOString() } : x) }); toast('已撤销状态更改。'); });
  }
  async function removeRecord(kind, id) {
    const key = kind === 'note' ? 'notes' : 'goals', item = data[key].find(x => x.id === id); if (!item) return;
    if (!await confirm('删除「' + item.title + '」？删除后 12 秒内可以撤销。', '删除这条记录')) return;
    save({ ...data, [key]: data[key].filter(x => x.id !== id) });
    toast('记录已删除。', () => {
      if (data[key].some(x => x.id === id)) return;
      save({ ...data, [key]: [{ ...item, updatedAt: new Date().toISOString() }, ...data[key]] }); toast('记录已恢复。');
    });
  }
  async function addIdeas() {
    const ideas = [
      ['看一次日出', '体验'], ['一个人去看电影', '体验'], ['给未来的自己写一封信', '成长'], ['读完一本一直想读的书', '成长'],
      ['学会做一道拿手菜', '体验'], ['和朋友去一次旅行', '旅行'], ['尝试一种新运动', '健康'], ['认真拍一组喜欢的照片', '创造'],
      ['和家人聊一个完整的晚上', '关系'], ['去一个没去过的城市', '旅行'], ['完成一个自己的小作品', '创造'], ['练习一次公开表达', '成长'],
      ['在图书馆待一下午', '体验'], ['独自散步一个小时', '健康'], ['坚持一个月的好习惯', '成长'], ['学会一首喜欢的歌', '创造'],
      ['看一场现场演出', '体验'], ['参加一次志愿活动', '关系'], ['看海', '旅行'], ['认真感谢一个帮助过我的人', '关系']
    ].filter(([title]) => !data.goals.some(x => x.title === title));
    if (!ideas.length) return toast('灵感清单已经在你的清单里了。');
    if (!await confirm('添加 ' + ideas.length + ' 件生活灵感？它们都会以「想去做」开始，你可以编辑或删除。', '给人生加一点期待')) return;
    const now = new Date().toISOString();
    const records = ideas.map(([title, category]) => C.record({ id: freshId(), title, category, status: 'planned', createdAt: now, updatedAt: now }, 'goal', now));
    save({ ...data, goals: [...data.goals, ...records] }); toast('已添加 ' + records.length + ' 件灵感，慢慢去体验吧。');
  }
  function clearImages() { imageGeneration++; for (const url of imageUrls) URL.revokeObjectURL(url); imageUrls = []; $('#image-results').replaceChildren(); }
  function renderSnapshot() {
    const stats = C.summary(data); $('#snapshot-heading').textContent = prefs.title;
    $('#snapshot-counter').textContent = '已完成：' + stats.completed + ' / ' + stats.total + '　·　' + stats.percent + '%';
    $('#snapshot-progress').style.width = stats.percent + '%';
    replace($('#snapshot-chips'), data.goals.length ? data.goals.map(x => button(x.title, 'toggle-goal', x.id, 'life-chip' + (x.status === 'done' ? ' completed' : ''), x.title + (x.status === 'done' ? '，已完成，点击恢复未完成' : '，未完成，点击标记完成'))) : [node('div', { class: 'snapshot-empty' }, '添加人生事项后，这里会慢慢长出你的经历。')]);
    replace($('#palettes'), palettes.map(p => node('button', { type: 'button', class: 'swatch' + (p.id === prefs.palette ? ' active' : ''), 'data-palette': p.id, style: '--swatch:' + p.color, title: p.name, 'aria-label': p.name, 'aria-pressed': p.id === prefs.palette }, node('span', { 'aria-hidden': 'true' }))));
    clearImages();
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), a = node('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function exportBackup() {
    if (storageLocked) { toast('请先下载原始数据，或导入有效备份恢复记录。'); return; }
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString(), app: '拾光' }, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, '拾光-备份-' + localDate() + '.json'); $('#backup-status').textContent = '已生成备份文件（' + data.notes.length + ' 篇感悟，' + data.goals.length + ' 件人生事项）。请确认浏览器已保存下载。';
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份文件超过 5 MB，请先拆分或整理');
      const importWorkspace = KEY, incoming = C.parseData(JSON.parse(await file.text())), merged = C.mergeData(data, incoming);
      const newNotes = merged.notes.length - data.notes.length, newGoals = merged.goals.length - data.goals.length;
      const recovery = storageLocked;
      if (!await confirm('备份含 ' + incoming.notes.length + ' 篇感悟、' + incoming.goals.length + ' 件人生事项。合并将新增 ' + newNotes + ' 篇感悟、' + newGoals + ' 件事项；相同 ID 保留较新的记录。' + (recovery ? '原有无法读取的数据会另存一份恢复副本。' : ''), '导入并合并备份')) return;
      if (importWorkspace !== KEY) throw new Error('账号已变化，请重新导入。');
      save(C.mergeData(data,incoming), recovery); $('#backup-status').textContent = '导入成功：当前共有 ' + data.notes.length + ' 篇感悟，' + data.goals.length + ' 件人生事项。'; toast('备份已合并并保存。');
    } catch (e) { $('#backup-status').textContent = '导入失败：' + (e instanceof SyntaxError ? '文件不是有效 JSON。' : e.message); }
    finally { $('#import-file').value = ''; }
  }
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }
  async function exportImages() {
    if (!data.goals.length) return toast('先添加一件人生事项，就可以生成长图了。');
    const exportButton = $('#image-export'); exportButton.disabled = true; exportButton.textContent = '正在生成…';
    try {
      clearImages(); const generation = imageGeneration, snapshot = C.parseData(data), snapshotTitle = prefs.title;
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (generation !== imageGeneration) throw new Error('清单发生了变化，请重新生成长图。');
      const measuring = document.createElement('canvas').getContext('2d'); if (!measuring) throw new Error('浏览器不支持生成图片');
      const font = '30px "KaiTi", "Kaiti SC", "Microsoft YaHei", sans-serif'; measuring.font = font;
      const pages = C.layoutChips(snapshot.goals, text => measuring.measureText(text).width, 1000, 6000);
      const stats = C.summary(snapshot), p = palettes.find(x => x.id === prefs.palette) || palettes[0];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex], canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = page.height;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器不支持生成图片');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#303a38'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '42px "KaiTi", "Kaiti SC", "Microsoft YaHei", sans-serif';
        const heading = snapshotTitle; ctx.fillText(heading, 500, 80, 860);
        ctx.font = '27px "KaiTi", "Kaiti SC", "Microsoft YaHei", sans-serif'; ctx.fillText('已完成：' + stats.completed + ' / ' + stats.total + '   ·   ' + stats.percent + '%', 500, 143);
        ctx.fillStyle = '#f0f0eb'; rounded(ctx, 350, 179, 300, 5, 2);
        if (stats.percent) { ctx.fillStyle = p.color; rounded(ctx, 350, 179, 300 * stats.percent / 100, 5, 2); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = font;
        for (const box of page.boxes) {
          if (box.item.status === 'done') { ctx.fillStyle = p.color; rounded(ctx, box.x, box.y, box.width, box.height, 5); }
          ctx.fillStyle = box.item.status === 'done' ? p.ink : '#303a38';
          for (let i = 0; i < box.lines.length; i++) ctx.fillText(box.lines[i], box.x + 12, box.y + 12 + 18.5 + i * 37);
        }
        ctx.textAlign = 'center'; ctx.font = '20px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#959b92'; ctx.fillText('每一种经历，都在慢慢拼出我。', 500, page.height - 48);
        if (pages.length > 1) { ctx.font = '16px sans-serif'; ctx.fillText((pageIndex + 1) + ' / ' + pages.length, 500, page.height - 22); }
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败')), 'image/png'));
        if (generation !== imageGeneration) throw new Error('清单发生了变化，请重新生成长图。');
        const url = URL.createObjectURL(blob); imageUrls.push(url);
        const filename = '拾光-人生清单-' + localDate() + (pages.length > 1 ? '-' + (pageIndex + 1) : '') + '.png';
        const link = node('a', { href: url, download: filename, class: 'btn primary' }, '↓ 下载长图' + (pages.length > 1 ? '（第 ' + (pageIndex + 1) + ' 张）' : ''));
        $('#image-results').append(node('div', { class: 'image-result' }, node('img', { src: url, alt: '人生清单长图，已完成 ' + stats.completed + ' / ' + stats.total }), link, node('p', {}, '手机也可以长按图片保存。')));
      }
      toast(pages.length > 1 ? '清单较长，已生成 ' + pages.length + ' 张图片，请分别保存。' : '长图已生成，点击下方下载或长按保存。');
      $('#image-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message || '图片生成失败，请再试一次。'); }
    finally { exportButton.disabled = false; exportButton.textContent = '↓ 生成长图 PNG'; }
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('button'); if (!target) return;
    try {
      if (target.dataset.close) return $('#' + target.dataset.close).close();
      if (target.dataset.view) return switchView(target.dataset.view);
      if (target.dataset.filter) { filter = target.dataset.filter; return render(); }
      if (target.dataset.palette) { prefs.palette = target.dataset.palette; savePrefs(); applyPalette(); return renderSnapshot(); }
      const action = target.dataset.action, id = target.dataset.id;
      switch (action) {
        case 'new-note': return openEditor('note');
        case 'new-goal': return openEditor('goal');
        case 'edit-note': return openEditor('note', data.notes.find(x => x.id === id));
        case 'read-note': return readNote(id);
        case 'edit-goal': return openEditor('goal', data.goals.find(x => x.id === id));
        case 'toggle-goal': return toggleGoal(id);
        case 'delete-note': return await removeRecord('note', id);
        case 'delete-goal': return await removeRecord('goal', id);
        case 'view-goals': return switchView('goals');
        case 'add-ideas': return await addIdeas();
        case 'clear-filter': query = ''; filter = 'all'; $('#search-input').value = ''; return render();
        case 'favorite': {
          save({ ...data, notes: data.notes.map(x => x.id === id ? { ...x, favorite: !x.favorite, updatedAt: new Date().toISOString() } : x) }); return;
        }
      }
    } catch (e) { toast(e.message); }
  });
  $('#editor-form').addEventListener('submit', submitRecord);
  $('#editor-form').addEventListener('input', persistDraft);
  $('#editor-form').addEventListener('change', persistDraft);
  $('#search-input').addEventListener('input', event => { query = event.target.value; render(); });
  $('#sort-select').addEventListener('change', event => { sort = event.target.value; render(); });
  $('#create-btn').addEventListener('click', () => openEditor(view === 'goals' ? 'goal' : 'note'));
  $('#preview-btn').addEventListener('click', () => { showDialog('preview'); renderSnapshot(); });
  $('#snapshot-title').addEventListener('input', event => { prefs.title = event.target.value.trim().slice(0, 50) || '我的人生清单'; savePrefs(); renderSnapshot(); });
  $('#image-export').addEventListener('click', exportImages);
  $('#preview').addEventListener('close', clearImages);
  $('#reader-edit').addEventListener('click', event => { const item = data.notes.find(x => x.id === event.currentTarget.dataset.id); $('#reader').close(); if (item) openEditor('note', item); });
  $('#theme-btn').addEventListener('click', () => { prefs.dark = !prefs.dark; savePrefs(); applyPalette(); });
  for (const selector of ['#backup-btn', '#footer-backup']) $(selector).addEventListener('click', () => { $('#backup-status').textContent = '当前记录：' + data.notes.length + ' 篇感悟，' + data.goals.length + ' 件人生事项。'; showDialog('backup'); });
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => importBackup(event.target.files[0]));
  $('#recovery-btn').addEventListener('click', () => { if (damagedRaw !== null) downloadBlob(new Blob([damagedRaw], { type: 'application/json;charset=utf-8' }), '拾光-原始数据-' + localDate() + '.json'); });
  $('#confirm-yes').addEventListener('click', () => finishConfirm(true));
  $('#confirm-no').addEventListener('click', () => finishConfirm(false));
  $('#confirm').addEventListener('cancel', event => { event.preventDefault(); finishConfirm(false); });
  $('#undo-btn').addEventListener('click', () => { const action = undoAction; undoAction = null; $('#toast').hidden = true; if (action) try { action(); } catch (e) { toast(e.message); } });
  window.addEventListener('storage', event => {
    if (globalThis.JournalCloud && JournalCloud.active() || event.key !== KEY) return;
    load(); render(); toast($('#editor').open ? '另一标签页更新了记录，编辑内容仍然保留；如果同一条记录有变化，保存时会提示。' : '已同步此浏览器另一标签页的记录。');
  });
  load();
  $('#today-label').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  render();
  if (globalThis.JournalCloud) JournalCloud.init({
    confirm,
    onWorkspace(next,key) {
      const changed = key !== KEY;
      if (changed) {
        if ($('#confirm').open) finishConfirm(false);
        if ($('#editor').open) persistDraft();
        for (const id of ['editor','reader','preview','backup']) if ($('#' + id).open) $('#' + id).close();
        clearTimeout(toastTimer); undoAction = null; $('#toast').hidden = true; $('#undo-btn').hidden = true;
        $('#cloud-history').replaceChildren();
        KEY = key; DRAFT = KEY + '-draft'; PREFS = KEY + '-preferences';
        data = C.empty(); damagedRaw = null; storageLocked = false; warning('');
        prefs = {palette:'sage',dark:false,title:'我的人生清单'};
        if (key === LEGACY_KEY) load();
        else {
          try {
            const p = JSON.parse(localStorage.getItem(PREFS) || 'null');
            if (p) prefs = {palette:palettes.some(x => x.id === p.palette)?p.palette:'sage',dark:p.dark===true,title:typeof p.title==='string'&&p.title.trim()?p.title.trim().slice(0,50):'我的人生清单'};
          } catch (_) {}
          applyPalette(); $('#snapshot-title').value = prefs.title;
        }
      }
      if (next) data = C.parseData(next);
      render();
      if ($('#reader').open) {
        const id = $('#reader-edit').dataset.id;
        if (data.notes.some(x => x.id === id)) readNote(id); else $('#reader').close();
      }
    }
  });
})();
