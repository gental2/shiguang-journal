import test from 'node:test';
import assert from 'node:assert/strict';
import '../core.js';
import '../sync-core.js';

const C = globalThis.JournalCore;
const S = globalThis.JournalSync;
const stamp = '2026-10-09T02:00:00.000Z';
const note = (id, text = id) => C.record({ id, title: text, content: text, date: '2026-10-09', tags: [], category: '学习', mood: '平静', createdAt: stamp, updatedAt: stamp }, 'note', stamp);
const doc = (...notes) => ({ version: 1, notes, goals: [] });
const eq = (a, b) => assert.deepEqual(a, b);
test('不同设备的新记录与修改会同时保留', () => {
 const a = note('a'), b = note('b'), edited = {...a, content:'新感悟'};
 const r = S.reconcile(doc(a), doc(edited), doc(a, b));
 eq(r.data.notes.map(x => x.id), ['a','b']); eq(r.data.notes[0].content, '新感悟'); eq(r.conflicts.length, 0);
});
test('另一设备删除的未修改记录不会被旧缓存复活', () => {
 const a = note('a'); const r = S.reconcile(doc(a), doc(a), doc());
 eq(r.data.notes.length, 0); eq(r.conflicts.length, 0);
});
test('离线删除可与另一设备新增记录合并', () => {
 const a=note('a'), b=note('b'); const r=S.reconcile(doc(a), doc(), doc(a,b));
 eq(r.data.notes.map(x=>x.id),['b']); eq(r.conflicts.length,0);
});
test('同时修改同一条记录或删除对方修改会要求处理冲突', () => {
 const a=note('a'), local={...a,content:'本机内容'}, remote={...a,content:'云端内容'};
 eq(S.reconcile(doc(a),doc(local),doc(remote)).conflicts.length,1);
 eq(S.reconcile(doc(a),doc(),doc(remote)).conflicts.length,1);
 eq(S.reconcile(doc(a),doc(local),doc()).conflicts.length,1);
 eq(S.reconcile(doc(a),doc(local),doc(remote),'local').data.notes[0].content,'本机内容');
 eq(S.reconcile(doc(a),doc(local),doc(remote),'remote').data.notes[0].content,'云端内容');
});
test('读到未知版本或损坏缓存会报错并保留原始内容', () => {
 assert.throws(()=>S.envelope({version:2}));
 assert.throws(()=>S.snapshot({revision:-1,data:doc()}));
 const storage = memory(); storage.setItem('account-a','bad json');
 assert.throws(()=>S.createEngine({storage,key:'account-a',transport:{}}));
 eq(storage.getItem('account-a'),'bad json');
});
function memory() { const m = new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; }
function server(initial=doc()) {
 let data=C.parseData(initial), revision=0;
 return {
 read: async()=>({revision,data:C.parseData(data)}),
 write:async (expected,desired)=> {
  if(expected!==revision) return {ok:false,revision,data:C.parseData(data)};
  data=C.parseData(desired);revision++;return {ok:true,revision,data:C.parseData(data)};
 },
 edit:(next)=>{data=C.parseData(next);revision++;},
 peek:()=>({revision,data:C.parseData(data)})
 };
}
test('保存后等待同步，刷新页面仍保留离线待上传记录', async () => {
 const storage=memory(), remote=server(); let broken=true;
 const transport={read:async()=>{if(broken)throw new Error('offline');return remote.read()},write:remote.write};
 let e=S.createEngine({storage,key:'account-a',transport});e.commit(doc(),doc(note('a')));
 await e.sync();eq(e.status().kind,'error');
 e.dispose();e=S.createEngine({storage,key:'account-a',transport});eq(e.data().notes.length,1);
 broken=false;await e.sync();eq(remote.peek().data.notes.length,1);eq(e.status().kind,'synced');
});
test('上传过程中新增的记录不会被上传响应覆盖', async () => {
 const storage=memory(), remote=server();let finish,started,blocked=true;
 const ready=new Promise(r=>started=r);
 const transport={read:remote.read,write:async(rev,desired)=>{if(blocked){blocked=false;started();await new Promise(r=>finish=r);}return remote.write(rev,desired);}};
 const e=S.createEngine({storage,key:'account-a',transport});
 e.commit(doc(),doc(note('a')));const sync=e.sync();await ready;
 e.commit(e.data(),doc(note('a'),note('b')));finish();await sync;
 eq(e.data().notes.map(x=>x.id),['a','b']);
 eq(JSON.parse(storage.getItem('account-a')).data.notes.length,2);
 e.dispose();
});
test('并发修改遇到版本竞争会重新拉取合并', async () => {
 const storage=memory(), remote=server();let first=true;
 const transport={read:remote.read,write:async(rev,desired)=>{
  if(first){first=false;remote.edit(doc(note('b')));}
  return remote.write(rev,desired);
 }};
 const e=S.createEngine({storage,key:'account-a',transport});e.commit(doc(),doc(note('a')));
 await e.sync();eq(remote.peek().data.notes.map(x=>x.id).sort(),['a','b']);eq(e.status().kind,'synced');
});
test('云端冲突不会静默覆盖本机，明确选择后才同步', async () => {
 const storage=memory(), remote=server(doc(note('a')));
 const e=S.createEngine({storage,key:'account-a',transport:remote});await e.sync();
 e.commit(e.data(),doc(note('a','本机修改')));remote.edit(doc(note('a','云端修改')));
 await e.sync();eq(e.status().kind,'conflict');eq(e.data().notes[0].title,'本机修改');eq(remote.peek().data.notes[0].title,'云端修改');
 e.resolve('local');await e.sync();eq(remote.peek().data.notes[0].title,'本机修改');eq(e.status().kind,'synced');
});
test('两个账号缓存隔离，退出账号不会删除云端记录', async () => {
 const storage=memory(), a=server(), b=server();
 const ea=S.createEngine({storage,key:'account-a',transport:a});ea.commit(doc(),doc(note('a')));await ea.sync();ea.dispose();
 const eb=S.createEngine({storage,key:'account-b',transport:b});eq(eb.data().notes.length,0);await eb.sync();
 eq(a.peek().data.notes.length,1);eq(b.peek().data.notes.length,0);
});
test('同步中的账号关闭后不会再切换界面或改写缓存', async () => {
 const storage=memory();let finish;const read=new Promise(r=>finish=r);
 let changed=0;const e=S.createEngine({storage,key:'account-a',transport:{read:()=>read},onChange:()=>changed++});
 const p=e.sync();e.dispose();finish({revision:0,data:doc(note('a'))});await p;
 eq(changed,0);eq(storage.getItem('account-a'),null);
});
test('存储空间不足时明确失败，不声称保存成功', () => {
 const storage={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
 const e=S.createEngine({storage,key:'account-a',transport:server()});
 assert.throws(()=>e.commit(doc(),doc(note('a'))));eq(e.data().notes.length,0);
});

test('同浏览器并发修改不会静默覆盖另一标签页的内容', () => {
 const a=note('a'), rows=new Map();
 const storage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};
 const base=doc(a);
 rows.set('account',JSON.stringify({version:1,revision:1,base,data:base,syncedAt:null}));
 const engine=S.createEngine({storage,key:'account',transport:{}});
 rows.set('account',JSON.stringify({version:1,revision:1,base,data:doc({...a,content:'另一标签页修改'})}));
 assert.throws(()=>engine.commit(base,doc({...a,content:'当前编辑'})),/另一标签页/);
 assert.equal(JSON.parse(rows.get('account')).data.notes[0].content,'另一标签页修改');
});
