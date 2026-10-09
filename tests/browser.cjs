const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.JOURNAL_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname,'..');
const documents = new Map(), histories = new Map(), errors=[];
const empty = () => ({version:1,notes:[],goals:[]});
const server = http.createServer(async (req,res) => {
 try {
  if(req.url==='/__test/rpc'){
   let body='';for await(const c of req)body+=c;
   const {id,name,args}=JSON.parse(body), current=documents.get(id)||{revision:0,data:empty()};
   let reply;
   if(name==='journal_read_v1')reply=current;
   else if(current.revision!==args.p_revision)reply={ok:false,...current};
   else if(JSON.stringify(current.data)===JSON.stringify(args.p_data))reply={ok:true,...current};
   else{
    histories.set(id,[{revision:current.revision,data:current.data,saved_at:new Date().toISOString()},...(histories.get(id)||[])].slice(0,50));
    const next={revision:current.revision+1,data:args.p_data};documents.set(id,next);reply={ok:true,...next};
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return;
  }
  if(req.url.startsWith('/__test/history')){
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(histories.get(new URL(req.url,'http://localhost').searchParams.get('id'))||[]));return;
  }
  const pathname=new URL(req.url,'http://localhost').pathname;
  const target=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');
  res.end(await fs.readFile(target));
 }catch(e){res.writeHead(404).end(e.message);}
});
function mockSdk(){
 window.supabase={createClient(){
  let current=JSON.parse(localStorage.getItem('test-session')||'null'),listeners=[];
  function emit(event){for(const f of listeners)f(event,current?{user:current}:null);}
  return {
   auth:{
    onAuthStateChange(f){listeners.push(f);return {data:{subscription:{unsubscribe(){}}}};},
    async getSession(){return {data:{session:current?{user:current}:null},error:null};},
    async signInWithPassword({email}){current={id:email.startsWith('a@')?'user-a':'user-b',email};localStorage.setItem('test-session',JSON.stringify(current));emit('SIGNED_IN');return {data:{},error:null};},
    async signOut(){current=null;localStorage.removeItem('test-session');emit('SIGNED_OUT');return {error:null};},
    async signUp(){return {data:{session:null},error:null};},
    async updateUser(){return {error:null};},
    async resetPasswordForEmail(){return {error:null};}
   },
   async rpc(name,args){try{return {data:await(await fetch('/__test/rpc',{method:'POST',body:JSON.stringify({id:current.id,name,args})})).json(),error:null};}catch(e){return {data:null,error:e};}},
   from(){const q={select(){return q;},eq(){return q;},order(){return q;},async limit(){return {data:await(await fetch('/__test/history?id='+current.id)).json(),error:null};}};return q;}
  };
 }};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
async function synced(p){await until(()=>p.locator('#cloud-strip').getAttribute('data-state').then(x=>x==='synced'),'synced');}
async function openAccount(p){if(!await p.locator('#account').evaluate(x=>x.open))await p.locator('#account-btn').click();}
async function closeAccount(p){if(await p.locator('#account').evaluate(x=>x.open))await p.locator('[data-close="account"]').click();}
async function login(p,email){await openAccount(p);await p.locator('#auth-email').fill(email);await p.locator('#auth-password').fill('test-password-only');await p.locator('#auth-submit').click();await synced(p);await closeAccount(p);}
async function sync(p){await openAccount(p);await p.locator('[data-cloud-action="sync"]').click();await synced(p);await closeAccount(p);}
async function writeNote(p,title,body=title){await p.locator('[data-view="notes"]').click();await p.locator('#create-btn').click();await p.locator('#edit-title').fill(title);await p.locator('#edit-content').fill(body);await p.locator('#editor-form [type="submit"]').click();}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 const first=await browser.newContext(),second=await browser.newContext({viewport:{width:390,height:844}});
 try{
  for(const c of [first,second])await c.addInitScript(mockSdk);
  const p=await first.newPage(),q=await second.newPage();
  for(const page of [p,q])page.on('pageerror',e=>errors.push(e.message));
  await p.goto(url);await q.goto(url);
  await writeNote(p,'旧浏览器感悟','这篇记录需要迁移。');
  assert.equal(await p.locator('#stat-notes').textContent(),'1');
  await login(p,'a@example.invalid');
  assert.equal(await p.locator('#stat-notes').textContent(),'0','login cannot silently upload guest records');
  await openAccount(p);await p.locator('[data-cloud-action="legacy"]').click();await p.locator('#confirm-yes').click();await synced(p);await closeAccount(p);
  await until(()=>Promise.resolve(documents.get('user-a')?.data.notes.length===1),'legacy upload');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('shiguang-journal-v1')).notes.length),1,'guest copy retained');
  await login(q,'a@example.invalid');
  assert.equal(await q.locator('#stat-notes').textContent(),'1','second device reads same account');
  await writeNote(p,'新感悟','<img src=x onerror="window.bad=true"> 内容作为文字显示');
  await synced(p);await sync(q);
  assert.equal(await q.locator('#stat-notes').textContent(),'2');
  assert.equal(await q.evaluate(()=>window.bad),undefined,'stored HTML must not execute');
  await p.locator('[data-view="goals"]').click();await p.locator('#create-btn').click();await p.locator('#edit-title').fill('看一次日出');
  await p.locator('#editor-form [type="submit"]').click();await synced(p);
  await p.locator('[data-view="goals"]').click();await p.locator('[data-action="toggle-goal"]').first().click();await synced(p);
  await sync(q);await q.locator('#preview-btn').click();
  assert.match(await q.locator('#snapshot-counter').textContent(),/1 \/ 1/);
  await q.locator('[data-palette="pink"]').click();
  assert.equal(await q.locator('.life-chip.completed').count(),1);
  await q.locator('#image-export').click();
  await until(()=>q.locator('#image-results img').count().then(n=>n===1),'PNG preview');
  assert.match(await q.locator('#image-results img').getAttribute('src'),/^blob:/);
  await q.locator('[data-close="preview"]').click();
  assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile page must fit viewport');
  await first.setOffline(true);await writeNote(p,'离线感悟');
  assert.equal(await p.locator('#stat-notes').textContent(),'3','offline save retained');
  await until(()=>p.locator('#cloud-strip').getAttribute('data-state').then(x=>x==='error'),'offline error visible');
  assert.equal(documents.get('user-a').data.notes.length,2,'offline cannot claim uploaded');
  await first.setOffline(false);await p.reload();await synced(p);await sync(q);
  assert.equal(await q.locator('#stat-notes').textContent(),'3','pending edit uploads after reload');
  await q.locator('[data-view="notes"]').click();
  const id=documents.get('user-a').data.notes.find(x=>x.title==='新感悟').id;
  await q.locator('[data-action="edit-note"][data-id="'+id+'"]').click();
  await p.locator('[data-view="notes"]').click();await p.locator('[data-action="edit-note"][data-id="'+id+'"]').click();
  await p.locator('#edit-content').fill('另一设备刚更新');await p.locator('#editor-form [type="submit"]').click();await synced(p);
  await q.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await until(()=>q.evaluate(id=>JSON.parse(localStorage.getItem('shiguang-journal-cloud-v1:eoouvltklfzfmgoyhfyd:user-a')).data.notes.find(x=>x.id===id).content,id).then(x=>x==='另一设备刚更新'),'foreground sync');
  await q.locator('#edit-content').fill('过期编辑框的内容');await q.locator('#editor-form [type="submit"]').click();
  assert.match(await q.locator('#editor-error').textContent(),/另一设备/);
  assert.equal(documents.get('user-a').data.notes.find(x=>x.id===id).content,'另一设备刚更新');
  await q.locator('[data-close="editor"]').first().click();
  await openAccount(q);await q.locator('[data-cloud-action="history"]').click();
  await until(()=>q.locator('#cloud-history button').count().then(n=>n>0),'history snapshots');
  await q.locator('[data-cloud-action="sign-out"]').click();await q.locator('#confirm-yes').click();
  await until(()=>q.locator('#account-guest').isVisible(),'signed out');await closeAccount(q);
  await login(q,'b@example.invalid');
  assert.equal(await q.locator('#stat-notes').textContent(),'0','other account isolated');
  assert.equal(await q.locator('#stat-total').textContent(),'0');
  assert.equal(documents.get('user-a').data.notes.length,3,'logout must retain records');
  assert.deepEqual(errors,[]);
  console.log('PASS: real Chromium UI, guest migration, two devices, mobile, literal HTML, completion/PNG, offline reload, stale edit protection, history, account isolation.');
  const vm=require('node:vm'),ctx={};vm.runInNewContext(await fs.readFile(path.join(root,'cloud-config.js'),'utf8'),ctx);
  const cfg=ctx.JOURNAL_CLOUD_CONFIG;
  const response=await fetch(cfg.url+'/rest/v1/rpc/journal_read_v1',{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:'{}'});
  assert.ok([401,403,404].includes(response.status),'anonymous RPC must be denied, got '+response.status);
  console.log('PASS: live Supabase anonymous access denied, HTTP '+response.status);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
