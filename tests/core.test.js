import test from 'node:test';
import assert from 'node:assert/strict';
import '../core.js';
const C = globalThis.JournalCore;

const fixed = '2026-10-09T02:00:00.000Z';
const note = (overrides = {}) => C.record({ id: 'note-1', title: '学会观察', content: '今天的理解。\n下一步去实践。', date: '2026-10-09', category: '学习', tags: ['成长'], createdAt: fixed, updatedAt: fixed, ...overrides }, 'note', fixed);
const goal = (overrides = {}) => C.record({ id: 'goal-1', title: '去看日出', category: '体验', status: 'planned', createdAt: fixed, updatedAt: fixed, ...overrides }, 'goal', fixed);

test('空清单显示 0/0 和 0%，没有 NaN', () => {
  assert.deepEqual(C.summary(C.empty()), { notes: 0, total: 0, completed: 0, doing: 0, percent: 0 });
});
test('完成数量和完成率只由已完成事项决定', () => {
  assert.deepEqual(C.summary({ notes: [note()], goals: [goal(), goal({ id: 'g2', status: 'done' }), goal({ id: 'g3', status: 'doing' })] }), { notes: 1, total: 3, completed: 1, doing: 1, percent: 33 });
});
test('完成状态保留首次完成时间，恢复未完成时清空它', () => {
  const done = C.transitionGoal(goal(), 'done', fixed);
  assert.equal(done.completedAt, fixed);
  assert.equal(C.transitionGoal(done, 'done', '2026-10-10T02:00:00Z').completedAt, fixed);
  assert.equal(C.transitionGoal(done, 'planned').completedAt, null);
  assert.equal(C.transitionGoal(done, 'doing').completedAt, null);
});
test('完成心得、下一步和分类都可以搜索', () => {
  assert.equal(C.matches(goal({ reflection: '心里更平静', nextStep: '提前查好 ROUTE' }), 'route'), true);
  assert.equal(C.matches(goal({ reflection: '心里更平静' }), '平静'), true);
  assert.equal(C.matches(note(), '成长'), true);
  assert.equal(C.matches(note(), '不存在'), false);
});
test('备份拒绝错误版本、重复 ID 和不存在的日期', () => {
  assert.throws(() => C.parseData({ version: 2, notes: [], goals: [] }));
  assert.throws(() => C.parseData({ version: 1, notes: [note(), note()], goals: [] }));
  assert.throws(() => C.date('2026-02-29'));
  assert.throws(() => C.date('2026-04-31'));
  assert.equal(C.date('2024-02-29'), '2024-02-29');
});
test('备份拒绝超长、空白、无效内容和过量记录', () => {
  assert.throws(() => note({ title: '   ' }));
  assert.throws(() => note({ content: '' }));
  assert.throws(() => note({ title: '字'.repeat(121) }));
  assert.throws(() => note({ tags: new Array(9).fill('标签') }));
  assert.throws(() => goal({ status: 'unknown' }));
  assert.throws(() => C.parseData({ version: 1, notes: [], goals: new Array(C.LIMIT + 1).fill(goal()) }));
});
test('导入同 ID 只保留较新的记录，较旧备份不会覆盖新内容', () => {
  const old = note(), newer = note({ title: '新的理解', updatedAt: '2026-10-10T02:00:00Z' });
  const left = { version: 1, notes: [newer], goals: [] };
  const right = { version: 1, notes: [old, note({ id: 'note-2' })], goals: [goal()] };
  const merged = C.mergeData(left, right);
  assert.equal(merged.notes.length, 2);
  assert.equal(merged.notes.find(x => x.id === old.id).title, '新的理解');
  assert.equal(merged.goals.length, 1);
});
test('多标签页保存保留另一标签页新增记录，并应用本次删除', () => {
  const initial = { version: 1, notes: [note()], goals: [goal()] };
  const remote = { version: 1, notes: [note(), note({ id: 'remote' })], goals: [goal(), goal({ id: 'remote-goal' })] };
  const desired = { version: 1, notes: [note({ title: '本次编辑', updatedAt: '2026-10-11T02:00:00Z' })], goals: [] };
  const saved = C.applyChanges(initial, desired, remote);
  assert.equal(saved.notes.length, 2);
  assert.equal(saved.notes.find(x => x.id === 'note-1').title, '本次编辑');
  assert.deepEqual(saved.goals.map(x => x.id), ['remote-goal']);
});
test('导入只复制允许的字段，不污染对象原型', () => {
  const incoming = JSON.parse('{"version":1,"notes":[],"goals":[],"__proto__":{"polluted":true}}');
  assert.deepEqual(C.parseData(incoming), C.empty());
  assert.equal({}.polluted, undefined);
  const item = note({ title: '<img src=x onerror=alert(1)>', unexpected: 'ignored' });
  assert.equal(item.unexpected, undefined);
  assert.equal(item.title, '<img src=x onerror=alert(1)>');
});
test('长图所有事项保留原顺序，分页不丢失或重叠', () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: i % 7 === 0 ? '很长的事项'.repeat(15) : '人生事项 ' + i }));
  const pages = C.layoutChips(items, text => Array.from(text).length * 30);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flatMap(x => x.boxes.map(b => b.item.id)), items.map(x => x.id));
  for (const page of pages) {
    assert.ok(page.height <= 6000);
    for (const box of page.boxes) {
      assert.ok(box.x >= 62 && box.x + box.width <= 938);
      assert.equal(box.lines.join(''), box.item.title);
      assert.ok(box.y + box.height < page.height);
    }
    for (let i = 1; i < page.boxes.length; i++) {
      const previous = page.boxes[i - 1], current = page.boxes[i];
      assert.ok(current.y !== previous.y || current.x >= previous.x + previous.width);
    }
  }
});
test('长图空清单和超长标题仍有可用布局', () => {
  assert.equal(C.layoutChips([], text => text.length * 30).length, 1);
  const box = C.layoutChips([{ title: '字'.repeat(120) }], text => text.length * 30)[0].boxes[0];
  assert.ok(box.lines.length > 1);
  assert.equal(box.lines.join(''), '字'.repeat(120));
});

test('另一标签页较新的版本不会被旧备份或旧表单覆盖', () => {
  const initial = { version: 1, notes: [note()], goals: [] };
  const desired = { version: 1, notes: [note({ title: '旧导入', updatedAt: '2026-10-10T02:00:00Z' })], goals: [] };
  const latest = { version: 1, notes: [note({ title: '最新版本', updatedAt: '2026-10-11T02:00:00Z' })], goals: [] };
  assert.equal(C.applyChanges(initial, desired, latest).notes[0].title, '最新版本');
});
test('另一标签页清空后，保存只恢复本次变更，不恢复全部旧数据', () => {
  const initial = { version: 1, notes: [note(), note({ id: 'untouched' })], goals: [goal()] };
  const desired = { version: 1, notes: [note({ title: '当前编辑', updatedAt: '2026-10-11T02:00:00Z' }), note({ id: 'untouched' })], goals: [goal()] };
  const saved = C.applyChanges(initial, desired, C.empty());
  assert.deepEqual(saved.notes.map(x => x.id), ['note-1']);
  assert.equal(saved.goals.length, 0);
});
