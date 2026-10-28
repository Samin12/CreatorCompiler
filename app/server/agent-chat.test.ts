import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {createProject,defaultEffects,defaultTransform,type Project} from '../shared/types';
import {assertAgentScope,validateAgentRequest,makeAgentTools,claudeArguments,scopedToolDefinitions} from './agent-chat';
import {revision} from './storage';

function fixture(){const p=createProject('Synthetic selection test');p.media=[{id:'media',name:'tone',kind:'audio',path:'/private/synthetic-only.wav',duration:10,width:0,height:0}];p.clips=['selected','other'].map((id,i)=>({id,mediaId:'media',name:id,track:'audio',start:i*10,sourceIn:0,sourceOut:10,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}));return p;}
const request={message:'Set selected clip gain to0.5',selectedClipIds:['selected'],playhead:1};
function store(initial=fixture()){
 let current=structuredClone(initial),gets=0,afterPut:((p:Project)=>void)|undefined,beforeGet:((count:number)=>void)|undefined;
 const fetcher:typeof fetch=async(_input,init)=>{if(init?.method==='PUT'){const expected=new Headers(init.headers).get('If-Match')?.replaceAll('"','');if(expected!==revision(current))return Response.json({error:'Project changed'},{status:409});current=JSON.parse(String(init.body));current.updatedAt=new Date().toISOString();const response=Response.json(current,{headers:{ETag:'"'+revision(current)+'"'}});afterPut?.(current);return response;}gets++;beforeGet?.(gets);return Response.json(current,{headers:{ETag:'"'+revision(current)+'"'}});};
 return {fetcher,get current(){return current;},set current(p:Project){current=p;},set beforeGet(fn:(count:number)=>void){beforeGet=fn;},set afterPut(fn:(p:Project)=>void){afterPut=fn;}};
}

test('chat validates frozen selected IDs/range and rejects stale or malformed context',()=>{
 const p=fixture();assert.deepEqual(validateAgentRequest(p,{...request,selectedClipIds:['selected','selected']}),request);
 assert.throws(()=>validateAgentRequest(p,{...request,selectedClipIds:['missing']}),/Selection/);
 assert.throws(()=>validateAgentRequest(p,{...request,range:{start:5,end:2}}),/range/);
 assert.throws(()=>validateAgentRequest(p,{...request,playhead:NaN}),/Playhead/);
 assert.throws(()=>validateAgentRequest(p,{...request,message:' '}),/Message/);
});
test('selected scope protects unselected clips and project-wide metadata independently of prompt',()=>{
 const p=fixture(),next=structuredClone(p);next.clips[0].gain=.5;assert.doesNotThrow(()=>assertAgentScope(p,next,request));
 next.clips[1].gain=2;assert.throws(()=>assertAgentScope(p,next,request),/unselected/);next.clips[1].gain=1;
 next.canvas.background='#ff0000';assert.throws(()=>assertAgentScope(p,next,request),/project-wide/);
 assert.doesNotThrow(()=>assertAgentScope(p,next,{...request,selectedClipIds:[]}));
 next.media[0].path='/private/another.wav';assert.throws(()=>assertAgentScope(p,next,{...request,selectedClipIds:[]}),/import arbitrary/);
});
test('scoped tools hide source paths/other projects and reject forbidden tools or transactions',async()=>{
 const p=fixture(),s=store(p),handle=makeAgentTools(p,request,'http://127.0.0.1:45678/api',()=>true,async()=>{},s.fetcher);
 const view=await handle('get_project',{project_id:p.id}) as any;
 assert.equal(view.project.clips.length,1);assert.ok(!JSON.stringify(view).includes('/private'));assert.ok(!JSON.stringify(view).includes('"other"'));
 await assert.rejects(handle('get_project',{project_id:'other-project'}),/selected project/);
 await assert.rejects(handle('import_media',{paths:['/private/a']}),/not available/);
 await assert.rejects(handle('update_clip',{tx_id:'stolen',clip_id:'selected',changes:{gain:2}}),/does not belong/);
 assert.ok(!scopedToolDefinitions(request).some(t=>t.name==='update_canvas'));
});
test('all eight external recovery tools are absent and rejected in project, clip and range chat scopes',async()=>{
 const names=['get_media_status','plan_media_relink','apply_media_relink','undo_media_relink','list_trashed_projects','restore_trashed_project','list_export_jobs','restart_export'];
 for(const selection of [{...request,selectedClipIds:[]},request,{...request,range:{start:1,end:2}}]){
  const p=fixture();let calls=0;const handler=makeAgentTools(p,selection,'http://127.0.0.1:45678/api',()=>true,async()=>{},async()=>{calls++;return Response.json(p);});
  for(const name of names){assert.equal(scopedToolDefinitions(selection).some(tool=>tool.name===name),false);await assert.rejects(handler(name,{project_id:p.id,media_id:'media',plan_id:'plan',trash_id:'trash',replacement_path:'/local/file',expected_revision:'a'.repeat(64)}),/not available/);}
  assert.equal(calls,0,'rejected recovery requests must not reach any HTTP route');
 }
});
test('range editing can split boundaries and modify inside while preserving everything outside',async()=>{
 const p=fixture(),r={...request,range:{start:3,end:7}},s=store(p);let committed:Project|undefined;
 const h=makeAgentTools(p,r,'http://127.0.0.1:45678/api',()=>true,async p=>{committed=p;},s.fetcher),tx=await h('begin_project_edit',{project_id:p.id}) as any;
 await h('split_clip',{tx_id:tx.tx_id,clip_id:'selected',time:3});let staged=(await h('get_project',{tx_id:tx.tx_id}) as any).project;
 const inside=staged.clips.find((c:any)=>c.start===3);assert.ok(inside);
 await h('split_clip',{tx_id:tx.tx_id,clip_id:inside.id,time:7});await h('update_clip',{tx_id:tx.tx_id,clip_id:inside.id,changes:{gain:.5}});
 await h('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Lower only3–7 seconds'});
 assert.equal(committed?.clips.find(c=>c.start===3)?.gain,.5);assert.equal(committed?.clips.find(c=>c.start===0)?.gain,1);assert.equal(committed?.clips.find(c=>c.start===7)?.gain,1);
 const changed=structuredClone(p);changed.clips[0].gain=.5;assert.throws(()=>assertAgentScope(p,changed,r),/outside/);
});
test('scoped replacement preserves hidden timed items outside selection',async()=>{
 const p=fixture();p.captions=[{id:'outside',start:12,end:14,text:'Unselected words'}];const s=store(p),h=makeAgentTools(p,request,'http://127.0.0.1:45678/api',()=>true,async()=>{},s.fetcher),tx=await h('begin_project_edit',{project_id:p.id}) as any;
 await h('set_captions',{tx_id:tx.tx_id,captions:[{id:'inside',start:1,end:2,text:'Selected words'}]});await h('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Add selected caption'});
 assert.deepEqual(s.current.captions.map(c=>c.id),['inside','outside']);
});
test('range comparison normalizes effect origins without ignoring changes or dropped retained intervals',()=>{
 const p=fixture(),r={...request,range:{start:3,end:7}},explicit=structuredClone(p);
 explicit.clips[0].effectTiming={sourceIn:0,sourceOut:10};assert.doesNotThrow(()=>assertAgentScope(p,explicit,r));
 const widened=structuredClone(explicit);widened.clips[0].effectTiming={sourceIn:0,sourceOut:12};assert.throws(()=>assertAgentScope(p,widened,r),/outside/);
 const retained=structuredClone(p);retained.clips[0].sourceIn=2;retained.clips[0].sourceOut=8;retained.clips[0].effectTiming={sourceIn:0,sourceOut:10};
 const dropped=structuredClone(retained);delete dropped.clips[0].effectTiming;assert.throws(()=>assertAgentScope(retained,dropped,{...r,range:{start:2,end:4}}),/outside/);
 for(const effect of ['normalize','denoise'] as const){const changed=structuredClone(explicit);changed.clips[0].effects[effect]=true;assert.throws(()=>assertAgentScope(p,changed,r),/outside/);}
 const gain=structuredClone(explicit);gain.clips[0].gain=.5;assert.throws(()=>assertAgentScope(p,gain,r),/outside/);
});
test('selected scope cannot stage or reveal another asset by swapping media or adding a new clip',async()=>{
 const p=fixture();p.media.push({...p.media[0],id:'hidden',name:'Private other source',path:'/private/hidden.wav'});p.clips[1].mediaId='hidden';
 const s=store(p),h=makeAgentTools(p,request,'http://127.0.0.1:45678/api',()=>true,async()=>{},s.fetcher),tx=await h('begin_project_edit',{project_id:p.id}) as any;
 await assert.rejects(h('update_clip',{tx_id:tx.tx_id,clip_id:'selected',changes:{mediaId:'hidden'}}),/another source/);
 await assert.rejects(h('add_clips',{tx_id:tx.tx_id,clips:[{...p.clips[0],id:'new',mediaId:'hidden'}]}),/another source/);
 const view=await h('get_project',{tx_id:tx.tx_id});assert.ok(!JSON.stringify(view).includes('Private other source'));
 const next=structuredClone(p);next.clips[0].mediaId='hidden';assert.throws(()=>assertAgentScope(p,next,request),/selected clip/);
});
test('hard range rejects splitting a faded or processed clip when it would reset effects outside range',async()=>{
 for(const effect of ['fadeIn','fadeOut','normalize','denoise','faceCenter','speed']){
  const p=fixture();if(effect==='speed')p.clips[0].speed=.5;else if(effect==='fadeIn'||effect==='fadeOut')p.clips[0].effects[effect]=5;else p.clips[0].effects[effect as 'normalize'|'denoise'|'faceCenter']=true;
  const r={...request,range:{start:3,end:7}},s=store(p),h=makeAgentTools(p,r,'http://127.0.0.1:45678/api',()=>true,async()=>{},s.fetcher),tx=await h('begin_project_edit',{project_id:p.id}) as any;
  await h('split_clip',{tx_id:tx.tx_id,clip_id:'selected',time:3});
  await assert.rejects(h('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Split boundary'}),/outside the selected time range/);
  assert.deepEqual(s.current,p);
 }
});
test('begin race and concurrent commit fail; undo snapshot uses exact PUT response instead of a later GET',async()=>{
 const p=fixture(),s=store(p);s.beforeGet=count=>{if(count===2)s.current={...s.current,name:'External save'};};let h=makeAgentTools(p,{...request,selectedClipIds:[]},'http://127.0.0.1:45678/api',()=>true,async()=>{},s.fetcher);
 await assert.rejects(h('begin_project_edit',{project_id:p.id}),/changed while/);
 const fresh=fixture(),t=store(fresh);let actual:Project|undefined;h=makeAgentTools(fresh,request,'http://127.0.0.1:45678/api',()=>true,async p=>{actual=p;},t.fetcher);
 const tx=await h('begin_project_edit',{project_id:fresh.id}) as any;await h('update_clip',{tx_id:tx.tx_id,clip_id:'selected',changes:{gain:.5}});
 t.afterPut=()=>{t.current={...t.current,name:'Newer external save'};};await h('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Gain'});
 assert.equal(actual?.name,fresh.name);assert.equal(t.current.name,'Newer external save');assert.notEqual(revision(actual!),revision(t.current));
 const u=store(fresh),handle=makeAgentTools(fresh,request,'http://127.0.0.1:45678/api',()=>true,async()=>{},u.fetcher),id=await handle('begin_project_edit',{project_id:fresh.id}) as any;u.current={...u.current,name:'Changed'};await assert.rejects(handle('commit_project_edit',{tx_id:id.tx_id,change_summary:'No overwrite'}),/Project changed/);
});
test('cancelled capability cannot run late tools and flags expose only explicit MCP tools',async()=>{
 const p=fixture(),s=store(p);let active=true;const h=makeAgentTools(p,request,'http://127.0.0.1:45678/api',()=>active,async()=>{},s.fetcher),tx=await h('begin_project_edit',{project_id:p.id}) as any;active=false;
 await assert.rejects(h('update_clip',{tx_id:tx.tx_id,clip_id:'selected',changes:{gain:3}}),/no longer active/);assert.equal(s.current.clips[0].gain,1);
 const args=claudeArguments('/tmp/owned/mcp.json');assert.equal(args[args.indexOf('--tools')+1],'');assert.ok(args.includes('--restricted')&&args.includes('--strict-mcp-config'));assert.ok(!args.includes('--dangerously-skip-permissions'));assert.equal(args[args.indexOf('--setting-sources')+1],'');
 const system=args[args.indexOf('--system-prompt')+1];assert.match(system,/filtered partial views: omitted clips and layers may exist/);assert.match(system,/Never infer the whole-project clip count/);
});

const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=net.createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}

test('real subprocess fake CLI drives scoped stdio MCP, persists reply/edit/undo, and cancels without commit',{timeout:30000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-chat-test-')),port=await freePort(),exe=path.join(dir,'claude'),data=path.join(dir,'data');
 const fake=`#!/usr/bin/env node
 const fs=require('node:fs'),cp=require('node:child_process'),rl=require('node:readline');
 const args=process.argv.slice(2);if(args.includes('--version')){console.log('2.1.295 (Claude Code)');process.exit();}if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,apiKey:'MUST_NOT_RETURN'}));process.exit();}
 let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',async()=>{const p=JSON.parse(input),config=JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config')+1])),m=config.mcpServers['creator-compiler'],child=cp.spawn(m.command,m.args,{env:{...process.env,...m.env}}),lines=rl.createInterface({input:child.stdout});let count=0;const pending=new Map();lines.on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r.result);});const rpc=(method,params)=>new Promise(resolve=>{const id=++count;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});const call=async(name,arguments)=>{const r=await rpc('tools/call',{name,arguments});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
 try{await rpc('initialize',{protocolVersion:'2024-11-05'});await rpc('tools/list',{});const tx=await call('begin_project_edit',{project_id:p.selection.projectId});await call('update_clip',{tx_id:tx.tx_id,clip_id:p.selection.selectedClipIds[0],changes:{gain:.5}});console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'Updating selected gain.'}}}));if(p.request.includes('cancel')){setInterval(()=>{},1000);return;}await call('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Set selected gain to0.5'});console.log(JSON.stringify({type:'result',is_error:false,result:'Set selected gain to0.5.'}));child.kill();process.exit(0);}catch(e){console.error(e.message);child.kill();process.exit(1);}});
 `;
 await fs.writeFile(exe,fake,{mode:0o700});const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SCENEFORGE_PORT:String(port),SCENEFORGE_DATA_DIR:data,SCENEFORGE_CLAUDE_PATH:exe},stdio:'pipe'});let stderr='';child.stderr?.on('data',b=>stderr+=b);child.stdout?.resume();
 const http=async(route:string,body?:unknown,method=body===undefined?'GET':'POST')=>{const r=await fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error);return value as any;};
 try{
  let ready=false;for(let i=0;i<100;i++){try{await http('/projects');ready=true;break;}catch{await delay(50);}}assert.ok(ready,stderr);
  const status=await http('/agent/status');assert.ok(status.authenticated&&status.installed&&status.supported);assert.ok(!JSON.stringify(status).includes('MUST_NOT_RETURN'));
  const p=fixture();await http('/projects/'+p.id,p,'PUT');
  let job=await http('/projects/'+p.id+'/agent-chat',request);
  const abort=new AbortController(),events=await fetch(`http://127.0.0.1:${port}/api/agent-chat/${job.id}/events`,{signal:abort.signal}),reader=events.body!.getReader();let streamed='';
  while(!streamed.includes('"status":"complete"')&&!streamed.includes('"status":"failed"')){const {value,done}=await reader.read();if(done)break;streamed+=new TextDecoder().decode(value);}abort.abort();
  assert.ok(streamed.includes('event: job')&&streamed.includes(job.id));
  for(let i=0;i<150&&!['complete','failed'].includes(job.status);i++){await delay(50);job=await http('/agent-chat/'+job.id);}assert.equal(job.status,'complete',JSON.stringify(job)+stderr);assert.equal(job.changed,true);assert.equal(job.text,'Set selected gain to0.5.');assert.equal((await http('/projects/'+p.id)).clips[0].gain,.5);assert.equal((await http('/projects/'+p.id)).clips[1].gain,1);
  assert.ok((await http('/projects/'+p.id+'/history')).length>=1);assert.equal((await http('/projects/'+p.id+'/agent-chat')).jobs.length,1);
  const restored=await http('/projects/'+p.id+'/agent-chat/'+job.id+'/undo',{});assert.equal(restored.clips[0].gain,1);
  job=await http('/projects/'+p.id+'/agent-chat',{...request,message:'Prepare then cancel'});for(let i=0;i<100&&!job.text;i++){await delay(50);job=await http('/agent-chat/'+job.id);}assert.ok(job.text);job=await http('/agent-chat/'+job.id,undefined,'DELETE');assert.equal(job.status,'cancelled');await delay(150);assert.equal((await http('/projects/'+p.id)).clips[0].gain,1);
  const r=await fetch(`http://127.0.0.1:${port}/api/agent-chat/${job.id}/tools`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'tools/list'})});assert.equal(r.status,403);
 }finally{await stop(child);await fs.rm(dir,{recursive:true,force:true});}
});
