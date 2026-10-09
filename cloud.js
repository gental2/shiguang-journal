(function (root) {
  'use strict';
  const C = root.JournalCore, S = root.JournalSync, config = root.JOURNAL_CLOUD_CONFIG || {};
  const LEGACY = 'shiguang-journal-v1', $ = s => document.querySelector(s);
  let client, engine, user = null, callbacks, workspaceKey = LEGACY, epoch = 0, timer, ready = false, recovery = false, blockedRaw = null;
  let currentStatus = {kind:'local',message:'未登录 · 记录保存在此浏览器'};
  const project = config.url ? new URL(config.url).hostname.split('.')[0] : 'unconfigured';
  function accountMessage(text, bad = false) {
    $('#account-message').textContent = text; $('#account-message').classList.toggle('form-error', bad);
  }
  function status(value) {
    currentStatus = value;
    $('#cloud-status').textContent = value.message;
    $('#cloud-strip').dataset.state = value.kind;
    $('#account-sync-status').textContent = value.message + (value.syncedAt ? ' · ' + new Date(value.syncedAt).toLocaleString('zh-CN') : '');
    const conflicts = value.conflicts || [];
    $('#cloud-conflicts').hidden = !conflicts.length;
    $('#conflict-list').replaceChildren();
    for (const x of conflicts) {
      const row = document.createElement('li');
      row.textContent = (x.local || x.remote).title + '：本机' + (x.local ? '已修改' : '已删除') + ' / 云端' + (x.remote ? '已修改' : '已删除');
      $('#conflict-list').append(row);
    }
    $('#cloud-recover').hidden = blockedRaw === null;
  }
  function accountUI() {
    $('#account-guest').hidden = !!user && !recovery;
    $('#account-member').hidden = !user || recovery;
    $('#account-email').textContent = user ? user.email || '已登录账号' : '';
    $('#account-btn').textContent = user ? '我的账号' : '登录同步';
    $('#auth-submit').textContent = recovery ? '设置新密码' : '登录';
    $('#auth-email-field').hidden = recovery;
    $('#auth-password').autocomplete = recovery ? 'new-password' : 'current-password';
    $('#auth-extra').hidden = recovery;
    $('#account-local-hint').textContent = user ? '感悟与清单保存在你的云端账号；草稿和界面偏好保存在此设备。' : '登录后，可在不同设备查看同一份感悟和人生清单。';
    $('#footer-backup').textContent = user ? '云端账号 · 导出备份 ↗' : '保存在此浏览器 · 导出备份 ↗';
    $('#backup-info-text').textContent = user
      ? '感悟与人生清单保存在 Supabase 私有账号中。只有显示「已同步到云端」的内容已上传成功；网络断开时先保存在本机，恢复联网后自动重试。网站升级不会清空云端记录。'
      : '未登录时，数据保存在当前浏览器。登录后可以将这些记录导入云端账号；换设备请登录同一账号。';
    $('#backup-storage-label').textContent = user ? '私有账号 · 云同步 + 本机缓存' : '未登录 · 本机保存';
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { if (engine) engine.sync(); }, 650); }
  async function assertAccount(id) {
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (!data.session || data.session.user.id !== id) throw new Error('登录状态已变化，请重新登录。');
  }
  async function activate(nextUser) {
    if (nextUser && user && nextUser.id === user.id && workspaceKey !== LEGACY) { user = nextUser; accountUI(); return; }
    const generation = ++epoch;
    clearTimeout(timer); if (engine) engine.dispose();
    engine = null; user = nextUser; blockedRaw = null;
    workspaceKey = user ? 'shiguang-journal-cloud-v1:' + project + ':' + user.id : LEGACY;
    accountUI();
    if (!user) { callbacks.onWorkspace(null,LEGACY); status({kind:'local',message:'未登录 · 记录保存在此浏览器'}); return; }
    const id = user.id, key = workspaceKey;
    try {
      engine = S.createEngine({
        storage:localStorage,key,
        transport:{
          async read() {
            await assertAccount(id);
            const {data,error} = await client.rpc('journal_read_v1');
            if (error) throw error; return data;
          },
          async write(revision,recordData) {
            await assertAccount(id);
            const {data,error} = await client.rpc('journal_write_v1',{p_revision:revision,p_data:recordData});
            if (error) throw error; return data;
          }
        },
        onChange:recordData => { if (generation === epoch) callbacks.onWorkspace(recordData,key); },
        onStatus:value => { if (generation === epoch) status(value); }
      });
      callbacks.onWorkspace(engine.data(),key);
      status({kind:'pending',message:'正在读取云端记录…'});
      await engine.sync();
    } catch (error) {
      try { blockedRaw = localStorage.getItem(key); } catch (_) {}
      callbacks.onWorkspace(C.empty(),key);
      status({kind:'error',message:'账号缓存无法读取，暂时停止保存：' + error.message});
      accountMessage('请先下载原始缓存保留记录，再联系处理；不会自动覆盖缓存。',true);
    }
  }
  function download(value,name) {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url),10000);
  }
  async function importLegacy() {
    if (!engine) throw new Error('请先登录可用账号。');
    const activeEngine = engine, id = user.id;
    if (!await activeEngine.sync()) throw new Error('请先完成云同步或处理冲突，再导入原有记录。');
    const raw = localStorage.getItem(LEGACY);
    if (!raw) return accountMessage('此浏览器没有旧版手账记录。你也可以从「数据与备份」导入 JSON 文件。');
    const old = C.parseData(JSON.parse(raw));
    if (!old.notes.length && !old.goals.length) return accountMessage('此浏览器没有旧版手账记录。');
    if (!await callbacks.confirm('将此浏览器原有的 ' + old.notes.length + ' 篇感悟、' + old.goals.length + ' 件人生事项合并到 ' + (user.email || '当前账号') + '？原本的浏览器记录会保留。','导入旧记录')) return;
    if (id !== user?.id || activeEngine !== engine) throw new Error('账号已变化，请重新导入。');
    activeEngine.commit(activeEngine.data(),C.mergeData(activeEngine.data(),old));
    const success = await activeEngine.sync();
    accountMessage(success ? '原有记录已导入并同步到此账号，浏览器旧记录仍然保留。' : '原有记录已导入本机账号缓存，正在等待上传。请留意同步状态。', !success);
  }
  async function history() {
    if (!user || !engine) throw new Error('请先登录。');
    const id = user.id; await assertAccount(id);
    const {data,error} = await client.from('journal_versions').select('revision,data,saved_at').eq('user_id',id).order('revision',{ascending:false}).limit(50);
    if (error) throw error;
    if (user?.id !== id) return;
    const list = $('#cloud-history'); list.replaceChildren();
    for (const x of data) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'backup-card';
      b.textContent = '↓ 版本 ' + x.revision + ' · ' + new Date(x.saved_at).toLocaleString('zh-CN');
      b.addEventListener('click',() => {
        if (user?.id !== id) return;
        download(C.parseData(x.data),'拾光-云端历史-v' + x.revision + '.json');
      });
      list.append(b);
    }
    accountMessage(data.length ? '保留最近 50 次变更前的快照。下载后可从「数据与备份」导入合并；下载不会修改当前记录。' : '目前还没有历史快照。首次保存后会开始保留。');
  }
  function translate(error) {
    const text = error?.message || String(error || '请求失败');
    if (/Invalid login credentials/i.test(text)) return '邮箱或密码不正确。';
    if (/Email not confirmed/i.test(text)) return '请先点击邮件里的验证链接，再登录。';
    if (/rate limit|too many requests/i.test(text)) return '请求太频繁，请稍后再试；邮件服务也可能达到发送限制。';
    if (/Email address.*invalid|email.*not.*authorized/i.test(text)) return '邮件服务没有接受此邮箱。请先使用注册 Supabase 时的邮箱，或配置自己的邮件服务。';
    if (/fetch|network/i.test(text)) return '网络连接失败，请检查网络后重试。';
    return text;
  }
  async function perform(action) {
    if (!ready || !client) throw new Error('登录服务尚未加载，请稍后重试或刷新页面。');
    accountMessage('正在处理…');
    const email = $('#auth-email').value.trim(), password = $('#auth-password').value;
    const redirectTo = config.siteUrl || new URL('.',location.href).href;
    if (action === 'sign-in') {
      if (!recovery && !$('#auth-form').reportValidity()) return;
      if (recovery) {
        if (password.length < 8) throw new Error('新密码至少 8 位。');
        const {error} = await client.auth.updateUser({password}); if (error) throw error;
        recovery = false; accountUI(); accountMessage('密码已更新。'); $('#auth-password').value = ''; return;
      }
      const {error} = await client.auth.signInWithPassword({email,password}); if (error) throw error;
      $('#auth-password').value = ''; accountMessage('已登录，正在读取你的云端记录。');
    } else if (action === 'sign-up') {
      if (!$('#auth-form').reportValidity()) return;
      if (password.length < 8) throw new Error('注册密码至少 8 位，请使用自己能妥善保存的密码。');
      const {data,error} = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}}); if (error) throw error;
      $('#auth-password').value = '';
      accountMessage(data.session ? '账号已创建，正在读取记录。' : '请检查邮箱并点击验证链接，然后回到此页登录。默认邮件服务有限制，建议先使用注册 Supabase 时的邮箱。');
    } else if (action === 'forgot') {
      if (!email || !$('#auth-email').checkValidity()) throw new Error('先填写有效的邮箱地址，再重置密码。');
      const {error} = await client.auth.resetPasswordForEmail(email,{redirectTo}); if (error) throw error;
      accountMessage('如果该邮箱已注册，会收到重置密码邮件。请打开邮件链接设置新密码。');
    } else if (action === 'sign-out') {
      if (!await callbacks.confirm('退出此账号？本机缓存和已上传的云端记录都会保留；等待上传的记录下次登录会继续同步。','退出账号')) return;
      const {error} = await client.auth.signOut({scope:'local'}); if (error) throw error;
      recovery = false; await activate(null); accountMessage('已退出账号。');
    } else if (action === 'sync') {
      if (!engine) throw new Error('当前账号无法同步。');
      await engine.sync();
    } else if (action === 'legacy') await importLegacy();
    else if (action === 'history') await history();
    else if (action === 'recover' && blockedRaw !== null) download(blockedRaw,'拾光-原始账号缓存.json');
    else if (action === 'resolve-local' || action === 'resolve-remote') {
      if (!engine) return;
      if (!await callbacks.confirm('将冲突的记录统一采用' + (action === 'resolve-local' ? '本机' : '云端') + '内容？建议先从「数据与备份」导出当前记录。非冲突记录会自动合并。','处理同步冲突')) return;
      engine.resolve(action === 'resolve-local' ? 'local' : 'remote'); await engine.sync();
    }
  }
  function sdk(url) {
    return new Promise((resolve,reject) => {
      const tag = document.createElement('script'); tag.src = url; tag.crossOrigin = 'anonymous';
      let finished = false;
      const timeout = setTimeout(() => { finished = true; tag.remove(); reject(new Error('登录服务加载超时')); },15000);
      tag.onload = () => { if (!finished) { clearTimeout(timeout); resolve(); } };
      tag.onerror = () => { if (!finished) { clearTimeout(timeout); tag.remove(); reject(new Error('登录服务加载失败')); } };
      document.head.append(tag);
    });
  }
  async function init(hooks) {
    callbacks = hooks; accountUI(); status(currentStatus);
    $('#account-btn').addEventListener('click',() => { const d = $('#account'); if (!d.open) d.showModal(); });
    async function action(name) { try { await perform(name); } catch (e) { accountMessage(translate(e),true); } }
    $('#auth-form').addEventListener('submit',e => { e.preventDefault(); action('sign-in'); });
    $('#account').addEventListener('click',e => { const b = e.target.closest('[data-cloud-action]'); if (b) action(b.dataset.cloudAction); });
    if (!config.url || !config.publishableKey) return accountMessage('此版本尚未配置云同步，原有本机记录仍可使用。');
    try {
      if (!root.supabase?.createClient) {
        try { await sdk('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js'); }
        catch (_) { await sdk('https://unpkg.com/@supabase/supabase-js@2.117.3/dist/umd/supabase.js'); }
      }
      client = root.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event,session) => {
        // Supabase callbacks must finish before any further asynchronous Auth calls.
        setTimeout(() => {
          if (event === 'PASSWORD_RECOVERY') recovery = true;
          activate(session?.user || null).then(() => { if (recovery && !$('#account').open) $('#account').showModal(); }).catch(e => accountMessage(translate(e),true));
        },0);
      });
      const {data,error} = await client.auth.getSession(); if (error) throw error;
      ready = true; await activate(data.session?.user || null);
      setInterval(() => { if (!document.hidden && engine) engine.sync(); },15000);
      window.addEventListener('online',schedule);
      window.addEventListener('focus',schedule);
      document.addEventListener('visibilitychange',() => { if (!document.hidden) schedule(); });
      window.addEventListener('storage',e => {
        if (engine && e.key === workspaceKey) { try { engine.reload(); schedule(); } catch (x) { status({kind:'error',message:'另一标签页的缓存无法读取：' + x.message}); } }
      });
    } catch (e) { accountMessage(translate(e),true); status({kind:'error',message:'云同步暂时不可用 · 未登录的本机记录仍可使用'}); }
  }
  root.JournalCloud = {
    init, active:() => !!user,
    save(before,next) { if (!engine) throw new Error('账号缓存尚未就绪，请先保留备份再检查同步状态。'); const data = engine.commit(before,next); schedule(); return data; }
  };
})(globalThis);
