/** Browser regression against built Vue2 (:5178) and Vue3 (:5179).
 * Serve each dist first. Uses mocked API responses, never a live backend/model.
 * EASY_PLAYWRIGHT_MODULE may point at a bundled playwright installation.
 */
const { chromium } = require(process.env.EASY_PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
mkdirSync('e2e/context-compact', { recursive: true });
const assert = require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
for (const port of (process.argv[2] ? [Number(process.argv[2])] : [5178,5179])) {
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});const page=await ctx.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('mini_agent_token','test-token');localStorage.setItem('mini_agent_username','tester');localStorage.setItem('easy_agent_active_session','s1');});
 const posts=[]; let release, outcome='compacted', skillsFail=false, supported=true, chatPosts=0;
 const sessions=['s1','s2'].map(id=>({session_id:id,title:'会话 '+id,created_at:'2026-10-27T00:00:00',updated_at:'2026-10-27T00:00:00',messages:[{id:id+'-user',role:'user',content:'历史问题'},{id:id+'-answer',role:'assistant',content:'历史回答'}]}));
 await page.route('**/agent/**',async route=>{
  const req=route.request(), u=new URL(req.url()), path=u.pathname;let data={};
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
  if(path.endsWith('/auth/config'))data={context_length:20000,preset_questions:[],context_compaction_enabled:supported,app_welcome_title:'测试'};
  else if(path.endsWith('/auth/profile'))data={username:'tester',organization_id:'test'};
  else if(path.endsWith('/settings/models'))data={models:[{name:'chosen-model',model:'test'}],active_model:'chosen-model'};
  else if(path.endsWith('/upload'))data={id:'file-1',filename:'notes.txt',file_path:'/uploads/notes.txt',size:9};
  else if(path.endsWith('/context/compact')){
    posts.push({path,body:req.postDataJSON()});await new Promise(r=>release=r);
    if(outcome==='error')return route.fulfill({status:500,json:{detail:'摘要服务暂时失败，请重试'},headers:{'Access-Control-Allow-Origin':'*'}});
    const sessionId=path.split('/')[3];
    const current=sessions.find(s=>s.session_id===sessionId);
    const compaction={id:'compact-'+posts.length,after_message_index:current.messages.length-1,model:'chosen-model',before_tokens:999,context_tokens:outcome==='compacted'?200:400,context_length:20000,estimated:true,status:outcome,message:outcome==='compacted'?'已压缩':'当前无需压缩'};
    const message=current.messages.at(-1);message.context_compactions=[...(message.context_compactions||[]),compaction];
    data={session_id:sessionId,status:outcome,message:outcome==='compacted'?'已压缩':'当前无需压缩',compaction};
  }
  else if(path==='/agent/chat/stream' && req.method()==='POST'){
    const body=req.postDataJSON(),current=sessions.find(s=>s.session_id===body.session_id);
    chatPosts++;
    const answer='压缩后的新回复 '+chatPosts;
    current.messages.push({id:'sent-'+chatPosts,role:'user',content:body.message},{id:'reply-'+chatPosts,role:'assistant',content:answer});
    const events=[{type:'start',session_id:body.session_id},{type:'assistant_start'},{type:'content',content:answer,step:1},{type:'done',content:answer,usage:{input_tokens:123,output_tokens:56,context_tokens:999,context_length:20000}}];
    return route.fulfill({status:200,contentType:'text/event-stream',body:events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),headers:{'Access-Control-Allow-Origin':'*'}});
  }
  else if(path.endsWith('/user-skills')) { if(skillsFail)return route.fulfill({status:500,json:{detail:'skills failed'}});data={skills:[{dir_name:'pdf',name:'pdf',description:'阅读 PDF',enabled:true}]}; }
  else if(path==='/agent/sessions')data=sessions;
  else if(/^\/agent\/sessions\/s[12]$/.test(path))data={...sessions.find(x=>path.endsWith(x.session_id)),usage:{context_tokens:999,input_tokens:123,output_tokens:56},context_length:20000};
  else if(path.endsWith('/stream/status'))data={streaming:false};
  else if(path.includes('/files/'))data=[];
  else if(path.includes('web-search'))data={enabled:true};
  return route.fulfill({status:200,json:data,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto(`http://127.0.0.1:${port}`);await page.waitForLoadState('networkidle');
 await page.screenshot({path:`e2e/context-compact/initial-${port}.png`});
 const input=page.locator('.chat-container:not(.is-sidebar) textarea').first();await input.waitFor({state:'visible'});
 await input.fill('/');await page.getByRole('listbox',{name:'指令与技能'}).waitFor();
 assert.match(await page.getByRole('listbox',{name:'指令与技能'}).innerText(), /指令[\s\S]*压缩 compact[\s\S]*技能[\s\S]*pdf/);
 await page.screenshot({path:`e2e/context-compact/menu-${port}.png`});
 // Keyboard selection continues to choose skills after the command row.
 await input.press('ArrowDown');await input.press('Enter');
 await page.waitForTimeout(80);assert.match(await input.inputValue(), /pdf/);assert.equal(posts.length,0);
 await page.locator('.chat-container:not(.is-sidebar) input[type=file][multiple]').first().setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('important')});
 await page.locator('.chat-container:not(.is-sidebar) .upload-status.completed').waitFor();
 // Preserve surrounding draft and attachments; update the context estimate after compression.
 await input.fill('草稿 /com 后续');await input.evaluate(el=>{el.setSelectionRange(7,7);el.dispatchEvent(new Event('input',{bubbles:true}));});
 const compact=()=>page.getByRole('option').filter({hasText:'压缩 compact'}).first();
 await compact().click();await page.waitForFunction(()=>document.querySelector('.compaction-status')?.textContent.includes('正在压缩...'));
 await page.waitForTimeout(80);assert.equal(posts.length,1);assert.equal(posts[0].body.model,'chosen-model');
 assert.equal(await input.inputValue(),'草稿  后续');assert.ok(await page.locator('.chat-container:not(.is-sidebar) .send-btn').first().isDisabled());
 release();await page.getByRole('status').filter({hasText:'compact · 已压缩'}).last().waitFor();
 assert.equal(await input.inputValue(),'草稿  后续');assert.equal(await page.locator('.chat-container:not(.is-sidebar) .uploaded-file').count(),1);
 assert.equal(await page.locator('.chat-container:not(.is-sidebar) .context-ring-text').innerText(),'1%');
 const geometry=await page.locator('.chat-container:not(.is-sidebar)').evaluate(el=>{
   const notice=el.querySelector('.compaction-status'), message=el.querySelector('.message.assistant');
   return {inTimeline:!!notice.closest('.chat-messages'),noticeLeft:notice.getBoundingClientRect().left,messageLeft:message.getBoundingClientRect().left};
 });
 assert.ok(geometry.inTimeline);assert.ok(Math.abs(geometry.noticeLeft-geometry.messageLeft)<2,JSON.stringify(geometry));
 await page.locator('.chat-container:not(.is-sidebar) .context-ring-wrapper').click();
 assert.match(await page.locator('.token-popup').innerText(),/当前上下文占用（估算）/);
 await page.screenshot({path:`e2e/context-compact/compacted-${port}.png`});
 await input.click();
 for(const width of [768,390]){
   await page.setViewportSize({width,height:1000});
   const aligned=await page.locator('.chat-container:not(.is-sidebar)').evaluate(el=>{
     const a=el.querySelector('.compaction-status').getBoundingClientRect(),b=el.querySelector('.message.assistant').getBoundingClientRect();
     return Math.abs(a.left-b.left)<2 && a.width<=el.getBoundingClientRect().width;
   });assert.ok(aligned,`compact alignment at ${width}px`);
 }
 await page.setViewportSize({width:1440,height:1000});
 // IME composition must not confirm either the menu command or send.
 await input.fill('/压缩');await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
 await page.waitForTimeout(80);assert.equal(posts.length,1);await compact().waitFor();
 outcome='skipped';await input.press('Enter');await page.waitForTimeout(80);assert.equal(posts.length,2);release();
 await page.getByRole('status').filter({hasText:'当前无需压缩'}).waitFor();
 // Failed compaction restores send and allows a fresh request.
 outcome='error';await input.fill('/com');await input.press('Enter');await page.waitForTimeout(80);assert.equal(posts.length,3);release();
 await page.getByRole('status').filter({hasText:'摘要服务暂时失败'}).waitFor();
 outcome='compacted';await input.fill('/com');await compact().click();await page.waitForTimeout(80);assert.equal(posts.length,4);release();
 await page.getByRole('status').filter({hasText:'compact · 已压缩'}).last().waitFor();
 if(port===5178){
   // Open the real sidebar and choose the same session via its history menu.
   await page.evaluate(()=>window.EasyAgentAI.open());await page.locator('.ais-panel').waitFor();
   await page.locator('.ais-title').click();await page.locator('.ais-history-item').filter({hasText:'会话 s1'}).first().click();
   const sidebarInput=page.locator('.is-sidebar textarea');await page.locator('.is-sidebar .message-wrapper.assistant').waitFor();await sidebarInput.fill('/com');await compact().waitFor();await sidebarInput.press('Enter');
   await page.waitForTimeout(100);assert.equal(posts.length,5);assert.equal(posts[4].path,'/agent/sessions/s1/context/compact');
   assert.ok(await input.isDisabled());assert.ok(await sidebarInput.isDisabled());
   await page.evaluate(()=>window.EasyAgentAI.close());
   await page.locator('.session-item').filter({hasText:'会话 s2'}).click();
   await page.waitForFunction(()=>!document.querySelector('.chat-container:not(.is-sidebar) textarea').disabled);
   assert.ok(!await input.isDisabled());
   await page.locator('.session-item').filter({hasText:'会话 s1'}).click();
   await page.waitForFunction(()=>document.querySelector('.chat-container:not(.is-sidebar) textarea').disabled);
   await page.evaluate(()=>window.EasyAgentAI.open());
   release();await page.locator('.is-sidebar [role=status]').filter({hasText:'compact · 已压缩'}).last().waitFor();
   // Returning to the main session from another session keeps the request scoped.
   await page.evaluate(()=>window.EasyAgentAI.close());
 
 }
 // A fresh page with unavailable skills still exposes the command.
 skillsFail=true;await page.reload();await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('.chat-container:not(.is-sidebar) .context-ring-text').innerText(),'1%');
 assert.ok(await page.locator('.chat-messages .compaction-status').count()>0);
 // The saved record stays between turns, while a subsequent real usage wins.
 sessions[0].messages.push({id:'s1-next-user',role:'user',content:'继续'},{id:'s1-next-answer',role:'assistant',content:'下一轮回复'});
 await page.reload();await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('.chat-container:not(.is-sidebar) .context-ring-text').innerText(),'5%');
 assert.equal(await page.locator('.chat-container:not(.is-sidebar) .message-wrapper').nth(1).locator('.compaction-status').count(),sessions[0].messages[1].context_compactions.length);
 assert.equal(await page.locator('.chat-container:not(.is-sidebar) .message-wrapper').nth(3).locator('.compaction-status').count(),0);
 // Reproduce the user's sequence without a reload: skipped/error -> send -> next reply.
 // Every status must stay at the operation's original turn, never follow the next reply.
 for(const status of ['skipped','error']){
   outcome=status;
   const anchoredIndex=sessions[0].messages.length-1;
   const beforePosts=posts.length;
   await input.fill('/com');await compact().waitFor();await input.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.chat-container:not(.is-sidebar) [aria-busy=true].compaction-status'));
   assert.equal(posts.length,beforePosts+1);release();
   const label=status==='skipped'?'当前无需压缩':'摘要服务暂时失败';
   const notice=page.locator('.chat-container:not(.is-sidebar) .compaction-status').filter({hasText:label}).last();
   await notice.waitFor();
   if(status==='skipped')assert.equal(await page.locator('.chat-container:not(.is-sidebar) .context-ring-text').innerText(),'2%');
   await input.fill('继续检查提示位置 '+status);await page.locator('.chat-container:not(.is-sidebar) .send-btn').first().click();
   await page.getByText('压缩后的新回复 '+chatPosts,{exact:true}).first().waitFor();
   await page.waitForFunction(()=>!document.querySelector('.chat-container:not(.is-sidebar) textarea').disabled);
   const wrappers=page.locator('.chat-container:not(.is-sidebar) .message-wrapper');
   assert.ok(await wrappers.nth(anchoredIndex).locator('.compaction-status').filter({hasText:label}).count()>0);
   assert.equal(await wrappers.last().locator('.compaction-status').count(),0);
   assert.equal(await page.locator('.chat-container:not(.is-sidebar) .context-ring-text').innerText(),'5%');
 }
 assert.equal(chatPosts,2);
 await page.waitForTimeout(350); // Let existing message entrance animations settle for evidence.
 await page.screenshot({path:`e2e/context-compact/anchored-after-send-${port}.png`});
 await input.fill('/com');await compact().waitFor();
 assert.equal(await compact().getAttribute('aria-disabled'),'false');await input.press('Escape');
 // Legacy capability is disabled with an explanation.
 supported=false;await page.reload();await page.waitForLoadState('networkidle');await input.fill('/com');
 await compact().waitFor();assert.equal(await compact().getAttribute('aria-disabled'),'true');assert.match(await compact().innerText(),/未启用会话级/);
 const count=posts.length;await input.press('Enter');await page.waitForTimeout(80);assert.equal(posts.length,count);
 await input.press('Escape');await page.locator('.new-chat').first().click();
 await input.fill('/com');await compact().waitFor();assert.equal(await compact().getAttribute('aria-disabled'),'true');
 assert.match(await compact().innerText(),/暂无可压缩/);
 assert.deepEqual(errors,[]);console.log('PASS main browser flow, attachments, failure retry, skills failure, disabled capability',port);
 await ctx.close();
}
await browser.close();
})();
