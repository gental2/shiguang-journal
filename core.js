(function (root) {
  'use strict';
  const VERSION = 1;
  const LIMIT = 1000;
  const NOTE_CATEGORIES = ['学习', '阅读', '工作', '生活', '灵感'];
  const GOAL_CATEGORIES = ['成长', '旅行', '体验', '关系', '健康', '创造'];
  const STATUSES = ['planned', 'doing', 'done'];
  const MOODS = ['平静', '开心', '专注', '迷茫', '疲惫'];
  function fail(message) { throw new Error(message); }
  function text(value, max, label, required = false) {
    if (typeof value !== 'string') fail(label + '需要是文字');
    const result = value.trim();
    if (required && !result) fail('请填写' + label);
    if (result.length > max) fail(label + '过长（最多 ' + max + ' 字符）');
    return result;
  }
  function date(value, optional = false) {
    if (optional && !value) return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期格式无效');
    const d = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('日期不存在');
    return value;
  }
  function stamp(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('记录时间无效');
    return new Date(value).toISOString();
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('记录 ID 无效');
    return value;
  }
  function record(item, kind, now = new Date().toISOString()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('记录内容无效');
    const categories = kind === 'note' ? NOTE_CATEGORIES : GOAL_CATEGORIES;
    const result = {
      id: id(item.id), title: text(item.title, 120, '标题', true),
      category: categories.includes(item.category) ? item.category : categories[0],
      createdAt: stamp(item.createdAt, now), updatedAt: stamp(item.updatedAt, now)
    };
    if (kind === 'note') {
      if (!Array.isArray(item.tags || [])) fail('标签格式无效');
      if ((item.tags || []).length > 8) fail('一篇感悟最多 8 个标签');
      Object.assign(result, {
        content: text(item.content, 20000, '感悟内容', true),
        date: date(item.date), mood: MOODS.includes(item.mood) ? item.mood : '平静',
        tags: [...new Set((item.tags || []).map(x => text(x, 24, '标签', true)))],
        favorite: item.favorite === true
      });
    } else {
      if (!STATUSES.includes(item.status)) fail('人生清单状态无效');
      Object.assign(result, {
        description: text(item.description || '', 5000, '想做这件事的原因'),
        nextStep: text(item.nextStep || '', 300, '下一步'),
        dueDate: date(item.dueDate, true), status: item.status,
        reflection: text(item.reflection || '', 5000, '完成心得'),
        completedAt: item.status === 'done' ? stamp(item.completedAt, now) : null
      });
    }
    return result;
  }
  function empty() { return { version: VERSION, notes: [], goals: [] }; }
  function parseData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== VERSION) fail('这不是拾光 v1 备份文件');
    for (const key of ['notes', 'goals']) {
      if (!Array.isArray(value[key]) || value[key].length > LIMIT) fail(key + '格式无效或超过 ' + LIMIT + ' 条');
    }
    const now = new Date().toISOString();
    const result = { version: VERSION, notes: value.notes.map(x => record(x, 'note', now)), goals: value.goals.map(x => record(x, 'goal', now)) };
    for (const key of ['notes', 'goals']) if (new Set(result[key].map(x => x.id)).size !== result[key].length) fail('备份包含重复 ID');
    return result;
  }
  function mergeData(current, incoming) {
    const left = parseData(current), right = parseData(incoming), result = empty();
    for (const key of ['notes', 'goals']) {
      const items = new Map(left[key].map(x => [x.id, x]));
      for (const item of right[key]) {
        const old = items.get(item.id);
        if (!old || Date.parse(item.updatedAt) > Date.parse(old.updatedAt)) items.set(item.id, item);
      }
      if (items.size > LIMIT) fail('合并后超过 ' + LIMIT + ' 条，请先分批整理');
      result[key] = [...items.values()];
    }
    return result;
  }
  function applyChanges(baseline, desired, latest) {
    const before = parseData(baseline), after = parseData(desired), remote = parseData(latest), result = empty();
    for (const key of ['notes', 'goals']) {
      const original = new Map(before[key].map(x => [x.id, x]));
      const next = new Map(after[key].map(x => [x.id, x]));
      const combined = new Map(remote[key].map(x => [x.id, x]));
      for (const old of before[key]) if (!next.has(old.id)) combined.delete(old.id);
      for (const item of after[key]) {
        const old = original.get(item.id);
        if (!old || JSON.stringify(old) !== JSON.stringify(item)) {
          const current = combined.get(item.id);
          if (!current || Date.parse(item.updatedAt) >= Date.parse(current.updatedAt)) combined.set(item.id, item);
        }
      }
      result[key] = [...combined.values()];
    }
    return parseData(result);
  }
  function transitionGoal(goal, status, now = new Date().toISOString()) {
    if (!STATUSES.includes(status)) fail('状态无效');
    return record({ ...goal, status, updatedAt: now, completedAt: status === 'done' ? (goal.status === 'done' ? goal.completedAt : now) : null }, 'goal', now);
  }
  function summary(data) {
    const completed = data.goals.filter(x => x.status === 'done').length;
    return { notes: data.notes.length, total: data.goals.length, completed, doing: data.goals.filter(x => x.status === 'doing').length, percent: data.goals.length ? Math.round(completed / data.goals.length * 100) : 0 };
  }
  function matches(item, query) {
    const haystack = [item.title, item.content, item.description, item.nextStep, item.reflection, item.category, ...(item.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase());
  }
  function layoutChips(items, measure, width = 1000, maxHeight = 6000) {
    const margin = 62, top = 235, gap = 12, rowGap = 16, lineHeight = 37, padding = 12;
    const available = width - margin * 2;
    let pages = [], boxes = [], x = margin, y = top, rowHeight = 0;
    function finish() { pages.push({ boxes, height: Math.max(520, y + rowHeight + 95) }); boxes = []; x = margin; y = top; rowHeight = 0; }
    for (const item of items) {
      const lines = []; let line = '';
      for (const character of item.title) {
        if (line && measure(line + character) > available - padding * 2) { lines.push(line); line = character; } else line += character;
      }
      if (line) lines.push(line);
      const w = Math.min(available, Math.max(56, ...lines.map(measure)) + padding * 2);
      const h = lines.length * lineHeight + padding * 2;
      if (x !== margin && x + w > width - margin) { x = margin; y += rowHeight + rowGap; rowHeight = 0; }
      if (boxes.length && y + h > maxHeight - 95) finish();
      boxes.push({ item, x, y, width: w, height: h, lines });
      x += w + gap; rowHeight = Math.max(rowHeight, h);
    }
    finish(); return pages;
  }
  root.JournalCore = { VERSION, LIMIT, NOTE_CATEGORIES, GOAL_CATEGORIES, STATUSES, MOODS, empty, record, parseData, mergeData, applyChanges, transitionGoal, summary, matches, layoutChips, date };
})(globalThis);
