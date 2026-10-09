(function (root) {
  'use strict';
  const C = root.JournalCore;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function equal(left, right) {
    return ['notes', 'goals'].every(key => {
      const a = left[key].slice().sort((x,y) => x.id.localeCompare(y.id));
      const b = right[key].slice().sort((x,y) => x.id.localeCompare(y.id));
      return same(a,b);
    });
  }
  // Three-way merge: unchanged cached records never resurrect remote deletions.
  function reconcile(base, local, remote, choice) {
    base = C.parseData(base); local = C.parseData(local); remote = C.parseData(remote);
    const result = C.empty(), conflicts = [];
    for (const key of ['notes', 'goals']) {
      const before = new Map(base[key].map(x => [x.id,x]));
      const mine = new Map(local[key].map(x => [x.id,x]));
      const theirs = new Map(remote[key].map(x => [x.id,x]));
      const ids = new Set([...mine.keys(), ...theirs.keys(), ...before.keys()]);
      for (const id of ids) {
        const b = before.get(id), l = mine.get(id), r = theirs.get(id);
        const lc = !same(b,l), rc = !same(b,r);
        let selected;
        if (lc && rc && !same(l,r)) {
          conflicts.push({collection:key,id,local:l || null,remote:r || null});
          selected = choice === 'remote' ? r : l;
        } else selected = lc ? l : r;
        if (selected) result[key].push(selected);
      }
    }
    return {data:C.parseData(result),conflicts};
  }
  function snapshot(value) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('云端版本信息无效，请先保留本机备份。');
    return {revision:value.revision,data:C.parseData(value.data)};
  }
  function envelope(value) {
    if (!value || value.version !== 1) throw new Error('本机同步缓存版本无法读取，已保留原始内容。');
    const revision = snapshot({revision:value.revision,data:value.base}).revision;
    return {version:1,revision,base:C.parseData(value.base),data:C.parseData(value.data),syncedAt:typeof value.syncedAt === 'string' ? value.syncedAt : null};
  }
  function createEngine({storage,key,transport,onChange = () => {},onStatus = () => {},now = () => new Date().toISOString()}) {
    let state = {version:1,revision:0,base:C.empty(),data:C.empty(),syncedAt:null};
    let currentStatus = {kind:'pending',message:'正在读取云端记录…'}, disposed = false, inFlight = null, conflictRemote = null;
    function read() {
      const raw = storage.getItem(key);
      return raw ? envelope(JSON.parse(raw)) : envelope(state);
    }
    state = read();
    function status(kind,message,extra={}) { currentStatus={kind,message,...extra}; if(!disposed) onStatus(currentStatus); }
    function persist(next) {
      if (disposed) return;
      const checked = envelope(next);
      storage.setItem(key,JSON.stringify(checked));
      state=checked; onChange(C.parseData(state.data));
    }
    function commit(before,desired) {
      if (disposed) throw new Error('账号已退出，请重新登录后保存。');
      const latest=read();
      const collision=reconcile(before,desired,latest.data);
      if(collision.conflicts.length)throw new Error('另一标签页修改了同一条记录。请先复制当前修改，再重新打开最新记录。');
      const next=collision.data;
      persist({...latest,data:next});
      status('pending','已保存在本机，等待云同步');
      return C.parseData(state.data);
    }
    async function run() {
      try {
        for (let attempt=0;attempt<5 && !disposed;attempt++) {
          status('syncing','正在同步…');
          const remote=snapshot(await transport.read());
          if(disposed)return false;
          const latest=read();
          if(remote.revision<latest.revision)continue;
          const merged=reconcile(latest.base,latest.data,remote.data);
          if(merged.conflicts.length) {
            conflictRemote=remote;
            status('conflict','有 '+merged.conflicts.length+' 条记录需要处理同步冲突',{conflicts:merged.conflicts});
            return false;
          }
          const clean=equal(merged.data,remote.data);
          persist({...latest,base:remote.data,data:merged.data,revision:remote.revision,syncedAt:clean?now():latest.syncedAt});
          if(clean) {conflictRemote=null;status('synced','已同步到云端',{syncedAt:state.syncedAt});return true;}
          const reply=await transport.write(remote.revision,C.parseData(merged.data));
          if(disposed)return false;
          const ack=snapshot(reply);
          if(reply.ok!==true)continue;
          // The merged data was cached before upload. Edits made during upload stay pending.
          const after=read();
          if(after.revision>ack.revision)continue;
          persist({...after,base:ack.data,revision:ack.revision,syncedAt:now()});
          if(equal(state.data,ack.data)) {conflictRemote=null;status('synced','已同步到云端',{syncedAt:state.syncedAt});return true;}
        }
        if(!disposed)status('pending','仍有记录等待同步，稍后自动重试');
      } catch(error) {
        if(!disposed)status('error','尚未同步：'+(error.message||'网络不可用')+'。本机记录已保留。');
      }
      return false;
    }
    function sync() {
      if(disposed)return Promise.resolve(false);
      if(inFlight)return inFlight;
      inFlight=run().finally(()=>{inFlight=null;});
      return inFlight;
    }
    function resolve(choice) {
      if(!['local','remote'].includes(choice) || !conflictRemote)throw new Error('请先读取同步冲突。');
      const latest=read(), r=reconcile(latest.base,latest.data,conflictRemote.data,choice);
      persist({...latest,base:conflictRemote.data,data:r.data,revision:conflictRemote.revision});
      conflictRemote=null;status('pending','冲突已处理，等待上传');
    }
    return {commit,sync,resolve,data:()=>C.parseData(state.data),status:()=>({...currentStatus}),reload:()=>{state=read();onChange(C.parseData(state.data));},dispose:()=>{disposed=true;},key};
  }
  root.JournalSync={equal,reconcile,snapshot,envelope,createEngine};
})(globalThis);
