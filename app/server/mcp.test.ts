import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolHandler,splitClip,trimProject,toolDefinitions} from './mcp.js';
import {createHash} from 'node:crypto';
import {createProject,defaultEffects,defaultTransform,type Clip} from '../shared/types.js';
const clip=():Clip=>({id:'clip',mediaId:'asset',name:'clip',track:'screen',start:2,sourceIn:10,sourceOut:30,speed:2,gain:1,muted:true,transform:defaultTransform(),effects:defaultEffects()});
test('Split preserves source coordinates at non-unit speed',()=>{const pieces=splitClip(clip(),5);assert.equal(pieces[0].sourceOut,16);assert.equal(pieces[1].sourceIn,16);assert.equal(pieces[1].start,5);assert.throws(()=>splitClip(clip(),2),/inside/)});
test('Ripple cuts merge overlapping ranges and shift clips exactly once',()=>{const p=createProject();p.clips=[clip()];const q=trimProject(p,[[3,5],[4,6]],true);assert.equal(q.clips.length,2);assert.equal(q.clips[0].sourceOut,12);assert.equal(q.clips[1].sourceIn,18);assert.equal(q.clips[1].start,3);assert.equal(p.clips.length,1);assert.throws(()=>trimProject(p,[[2,1]]),/Ranges/)});
test('Staged MCP edits are isolated and conditional commit conflicts close the transaction',async()=>{
 const p=createProject();let committed=structuredClone(p),conflict=false;let conditional='';
 const mock:typeof fetch=async(_url,init)=>{if(init?.method==='PUT'){conditional=(init.headers as Record<string,string>)['If-Match'];if(conflict)return new Response(JSON.stringify({error:'Project changed'}),{status:409});committed=JSON.parse(init.body as string);return Response.json(committed)}return new Response(JSON.stringify(committed),{headers:{etag:'"revision-one"'}})};
 const handle=createToolHandler('http://127.0.0.1:4174/api',mock);const tx:any=await handle('begin_project_edit',{project_id:p.id});await handle('rename_project',{tx_id:tx.tx_id,name:'Staged'});assert.equal(committed.name,p.name);conflict=true;await assert.rejects(handle('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Rename the project.'}),/changed/);assert.equal(conditional,'"revision-one"');await assert.rejects(handle('get_project',{tx_id:tx.tx_id}),/closed/);
});
test('Timeline inspection returns actual image blocks and rejects other image origins',async()=>{
 const bytes=Buffer.from('89504e470d0a1a0a','hex');let malicious=false;const requests:string[]=[];
 const mock:typeof fetch=async(input,init)=>{requests.push(String(input));if(init?.method==='POST')return Response.json({frames:[{time:1.2,width:320,height:180,url:malicious?'https://example.com/frame.png':'/api/inspection-images/synthetic'}]});return new Response(bytes,{headers:{'Content-Type':'image/png'}})};
 const handle=createToolHandler('http://127.0.0.1:4174/api',mock);const result:any=await handle('inspect_timeline',{project_id:'demo',times:[1.2],width:320});
 assert.equal(result.content[1].type,'image');assert.equal(result.content[1].mimeType,'image/png');assert.deepEqual(Buffer.from(result.content[1].data,'base64'),bytes);assert.equal(JSON.parse(result.content[0].text).frames[0].time,1.2);
 malicious=true;await assert.rejects(handle('inspect_timeline',{project_id:'demo',times:[1.2]}),/loopback/);assert.ok(requests.every(r=>!r.startsWith('https:')));
 await assert.rejects(handle('inspect_timeline',{project_id:'demo',times:[]}),/1–6/);
});
test('Compact overview includes counts and orientation without full clip objects or source paths',async()=>{
 const p=createProject('Overview');p.clips=[clip()];p.media=[{id:'asset',name:'Test',path:'/private/source.mov',kind:'video',duration:30,width:1920,height:1080}];const handle=createToolHandler('http://127.0.0.1:4174/api',async()=>Response.json(p));
 const value:any=await handle('get_project_overview',{project_id:p.id});assert.equal(value.duration,12);assert.equal(value.counts.clips,1);assert.equal(value.media[0].name,'Test');assert.equal(value.clips,undefined);assert.equal(value.media[0].path,undefined);
});

const recoveryNames=['get_media_status','plan_media_relink','apply_media_relink','undo_media_relink','list_trashed_projects','restore_trashed_project'];
const reviewedRevision='a'.repeat(64);
const recoveryCalls:Array<[string,Record<string,unknown>,string,string,unknown]>=[
 ['get_media_status',{project_id:'project_1'},'/projects/project_1/media-recovery','GET',undefined],
 ['plan_media_relink',{project_id:'project_1',media_id:'media-1',replacement_path:'/local/My take.mp4',expected_revision:reviewedRevision},'/projects/project_1/media-recovery/plan','POST',{mediaId:'media-1',replacementPath:'/local/My take.mp4'}],
 ['apply_media_relink',{project_id:'project_1',plan_id:'plan-1',expected_revision:reviewedRevision,acknowledgements:['original-fps-unknown']},'/projects/project_1/media-recovery/apply','POST',{planId:'plan-1',acknowledgements:['original-fps-unknown']}],
 ['undo_media_relink',{project_id:'project_1',plan_id:'plan-1',expected_revision:reviewedRevision},'/projects/project_1/media-recovery/undo','POST',{planId:'plan-1'}],
 ['list_trashed_projects',{},'/trash','GET',undefined],
 ['restore_trashed_project',{trash_id:'old-project-1700000000000',expected_revision:reviewedRevision,as_copy:true},'/trash/old-project-1700000000000/restore','POST',{asCopy:true}],
];
test('external MCP has exactly 39 unique tools and explicit recovery review schemas',()=>{
 assert.equal(toolDefinitions.length,39);assert.equal(new Set(toolDefinitions.map(t=>t.name)).size,39);
 for(const name of recoveryNames){const tool=toolDefinitions.find(t=>t.name===name)!;assert.ok(tool);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal('tx_id' in tool.inputSchema.properties,false);if(!['get_media_status','list_trashed_projects'].includes(name)){assert.ok(tool.inputSchema.required.includes('expected_revision'));assert.equal((tool.inputSchema.properties.expected_revision as any).pattern,'^[0-9a-f]{64}$');}}
});
test('recovery tools preserve exact HTTP payloads and reviewed If-Match without extra reads',async()=>{
 const calls:Array<{url:string;method:string|undefined;headers:Headers;body:unknown}>=[];
 const handle=createToolHandler('http://127.0.0.1:45678/api',async(url,init)=>{calls.push({url:String(url),method:init?.method,headers:new Headers(init?.headers),body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json({ok:true});});
 for(const [name,args,route,method,body] of recoveryCalls){const before=calls.length;assert.deepEqual(await handle(name,args),{ok:true});assert.equal(calls.length,before+1);const actual=calls.at(-1)!;assert.equal(actual.url,'http://127.0.0.1:45678/api'+route);assert.equal(actual.method,method);assert.deepEqual(actual.body,body);assert.equal(actual.headers.get('If-Match'),args.expected_revision?`"${reviewedRevision}"`:null);}
 await handle('apply_media_relink',{project_id:'project_1',plan_id:'plan-1',expected_revision:reviewedRevision});assert.deepEqual(calls.at(-1)!.body,{planId:'plan-1',acknowledgements:[]});
 await handle('restore_trashed_project',{trash_id:'x'.repeat(100)+'-1700000000000',expected_revision:reviewedRevision});assert.deepEqual(calls.at(-1)!.body,{asCopy:false});
});
test('recovery runtime rejects transactions, malformed fields and implicit choices before HTTP',async()=>{
 let requests=0;const handle=createToolHandler('http://127.0.0.1:45678/api',async()=>{requests++;return Response.json({});});
 for(const [name,args] of recoveryCalls){for(const invalid of [null,[],1,'bad',{...args,tx_id:'staged'},{...args,tx_id:null},{...args,unexpected:true}])await assert.rejects(handle(name,invalid));}
 const base={project_id:'project',plan_id:'plan',expected_revision:reviewedRevision};
 for(const expected_revision of [undefined,'*','a'.repeat(63),'A'.repeat(64),`"${reviewedRevision}"`,[reviewedRevision],{},' '+reviewedRevision])await assert.rejects(handle('undo_media_relink',{...base,expected_revision}));
 for(const project_id of ['',123,'../other','p/q','p%2fq','x'.repeat(101)])await assert.rejects(handle('get_media_status',{project_id}));
 for(const replacement_path of ['relative.mp4',null,'/local/a\0b'])await assert.rejects(handle('plan_media_relink',{project_id:'project',media_id:'media',replacement_path,expected_revision:reviewedRevision}));
 for(const acknowledgements of [true,'yes',[true],['same','same'],['invalid/id']])await assert.rejects(handle('apply_media_relink',{...base,acknowledgements}));
 for(const as_copy of ['true',1,null])await assert.rejects(handle('restore_trashed_project',{trash_id:'trash',expected_revision:reviewedRevision,as_copy}));
 await assert.rejects(handle('plan_media_relink',{project_id:'project',expected_revision:reviewedRevision}));assert.equal(requests,0);
});
test('recovery propagates 409 and 410 without refreshing revision or retrying as a copy',async()=>{
 for(const status of [409,410]){let calls=0;const handle=createToolHandler('http://127.0.0.1:45678/api',async()=>{calls++;return Response.json({error:status===409?'Project changed':'Review expired'},{status});});
  await assert.rejects(handle('restore_trashed_project',{trash_id:'trash',expected_revision:reviewedRevision}),(error:Error&{status?:number})=>error.status===status&&/changed|expired/.test(error.message));assert.equal(calls,1);
 }
});
test('a committed recovery makes an earlier staged transaction stale and failure closes it',async()=>{
 let current=createProject('Original');const digest=()=>createHash('sha256').update(JSON.stringify(current)).digest('hex');const old=digest();
 const handle=createToolHandler('http://127.0.0.1:45678/api',async(url,init)=>{
  if(String(url).endsWith('/media-recovery/apply')){assert.equal(new Headers(init?.headers).get('If-Match'),`"${old}"`);current={...current,notes:'Committed recovery'};return Response.json({project:current,revision:digest()});}
  if(init?.method==='PUT'){assert.equal(new Headers(init.headers).get('If-Match'),`"${old}"`);return Response.json({error:'Project changed after recovery'},{status:409});}
  return Response.json(current,{headers:{ETag:`"${digest()}"`}});
 });
 const tx:any=await handle('begin_project_edit',{project_id:current.id});await handle('rename_project',{tx_id:tx.tx_id,name:'Stale edit'});
 await handle('apply_media_relink',{project_id:current.id,plan_id:'review',expected_revision:old});await assert.rejects(handle('commit_project_edit',{tx_id:tx.tx_id,change_summary:'Do not overwrite recovery'}),(error:Error&{status?:number})=>error.status===409);
 assert.equal(current.name,'Original');assert.equal(current.notes,'Committed recovery');await assert.rejects(handle('get_project',{tx_id:tx.tx_id}),/closed/);
});

test('MCP export pins the committed revision and does not retry a changed project',async()=>{
 const project=createProject('Export revision');const calls:Array<{url:string;headers:Headers}>=[];let changed=false;
 const handle=createToolHandler('http://127.0.0.1:45678/api',async(url,init)=>{calls.push({url:String(url),headers:new Headers(init?.headers)});if(String(url).endsWith('/export'))return Response.json(changed?{error:'Project changed'}:{id:'durable-export'},{status:changed?409:200});return Response.json(project,{headers:{ETag:'"'+ 'b'.repeat(64)+'"'}});});
 assert.deepEqual(await handle('export_video',{project_id:project.id,options:{format:'mp4'}}),{id:'durable-export'});assert.equal(calls[1].headers.get('If-Match'),'"'+'b'.repeat(64)+'"');changed=true;await assert.rejects(handle('export_video',{project_id:project.id}),/Project changed/);assert.equal(calls.length,4);
});

test('export history and restart schemas enforce bounded, explicit requests without retry',async()=>{
 const calls:Array<{url:string;method:string;body:any}>=[];let conflict=false;
 const handle=createToolHandler('http://127.0.0.1:45678/api',async(url,init)=>{calls.push({url:String(url),method:init?.method||'GET',body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json(conflict?{error:'Renderer runtime changed'}:{jobs:[]},{status:conflict?409:200});});
 for(const name of ['list_export_jobs','restart_export']){const schema=toolDefinitions.find(t=>t.name===name)!.inputSchema;assert.equal(schema.additionalProperties,false);assert.equal('tx_id'in schema.properties,false);}
 await handle('list_export_jobs',{project_id:'project',offset:200,limit:25});assert.equal(calls[0].url,'http://127.0.0.1:45678/api/exports?projectId=project&offset=200&limit=25');
 await handle('restart_export',{job_id:'saved-job',acknowledge_runtime_change:false});assert.deepEqual(calls[1].body,{acknowledgeRuntimeChange:false});
 const before=calls.length;for(const args of [{limit:201},{limit:0},{limit:1.5},{offset:-1},{offset:1000001},{project_id:'../other'},{tx_id:'staged'},null,[]])await assert.rejects(handle('list_export_jobs',args));
 for(const args of [{job_id:'job'},{job_id:'job',acknowledge_runtime_change:'true'},{job_id:'../job',acknowledge_runtime_change:true},{job_id:'job',acknowledge_runtime_change:false,tx_id:'staged'}])await assert.rejects(handle('restart_export',args));assert.equal(calls.length,before);
 conflict=true;await assert.rejects(handle('restart_export',{job_id:'job',acknowledge_runtime_change:false}),/runtime changed/);assert.equal(calls.length,before+1);
});

import {gateToolHandler,MCP_DISABLED_MESSAGE} from './mcp.js';
import {readMCPSettings,saveMCPSettings,AI_WORKSPACE_NAME} from './mcp-settings.js';
import {mkdir,mkdtemp,rm as removeDir,stat as statPath,writeFile as writeText} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('external MCP calls honor the Enable MCP setting on every call, and older services stay enabled',async()=>{
 let enabled=true,calls=0;const inner=async()=>{calls++;return {ok:true};};
 const handle=gateToolHandler(inner,'http://127.0.0.1:45678/api',async url=>{assert.equal(String(url),'http://127.0.0.1:45678/api/mcp/settings');return Response.json({enabled});});
 assert.deepEqual(await handle('get_guides'),{ok:true});enabled=false;await assert.rejects(handle('get_guides'),new RegExp(MCP_DISABLED_MESSAGE.slice(0,20)));assert.equal(calls,1);enabled=true;await handle('get_guides');assert.equal(calls,2);
 const legacy=gateToolHandler(inner,'http://127.0.0.1:45678/api',async()=>Response.json({error:'missing'},{status:404}));await legacy('get_guides');assert.equal(calls,3);
});
test('MCP settings default on, persist, create the named workspace folder and reject unsafe locations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sceneforge-mcp-settings-'));try{
  const initial=await readMCPSettings(dir);assert.equal(initial.enabled,true);assert.ok(initial.workspacePath.endsWith(AI_WORKSPACE_NAME));
  const chosen=join(dir,'chosen');await mkdir(chosen);
  const saved=await saveMCPSettings(dir,{enabled:false,workspaceLocation:chosen});assert.deepEqual(saved,{enabled:false,workspaceLocation:chosen,workspacePath:join(chosen,AI_WORKSPACE_NAME)});assert.deepEqual(await readMCPSettings(dir),saved);
  await assert.rejects(statPath(saved.workspacePath),/ENOENT/,'a disabled MCP does not create the workspace folder');
  assert.ok((await statPath((await saveMCPSettings(dir,{enabled:true})).workspacePath)).isDirectory());
  for(const bad of [{enabled:'yes'},{workspaceLocation:'relative/folder'},{workspaceLocation:join(dir,'missing')},{other:true},[]])await assert.rejects(saveMCPSettings(dir,bad),/MCP|enabled|folder|Unexpected/);
  const file=join(dir,'file.txt');await writeText(file,'x');await assert.rejects(saveMCPSettings(dir,{workspaceLocation:file}),/not an existing folder/);
  assert.equal((await readMCPSettings(dir)).workspaceLocation,chosen);
 }finally{await removeDir(dir,{recursive:true,force:true});}
});
