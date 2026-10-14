import {test} from 'node:test';import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createProject,defaultEffects,defaultTransform,type Project} from '../shared/types';
// A minimal host for rendering the hook without a browser: the probe component renders nothing.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const noop=()=>{};(globalThis as {window?:unknown}).window??=globalThis;
const doc:Record<string,unknown>={addEventListener:noop,removeEventListener:noop,nodeType:9,activeElement:null,body:null};doc.defaultView={document:doc,HTMLIFrameElement:class{}};
const container={nodeType:1,tagName:'DIV',nodeName:'DIV',namespaceURI:'http://www.w3.org/1999/xhtml',ownerDocument:doc,addEventListener:noop,removeEventListener:noop,textContent:''};
class FakeSource extends EventTarget{static last:FakeSource|null=null;readyState=1;constructor(readonly url:string){super();FakeSource.last=this;}close(){this.readyState=2;}}
globalThis.EventSource=FakeSource as unknown as typeof EventSource;
type Sent={method:string;path:string;headers:Record<string,string>;body?:string};
function backend(initial:Project,minimal=true){
 let stored:Project=JSON.parse(JSON.stringify(initial)),revision=1;const requests:Sent[]=[],etag=()=>`"rev-${revision}"`;
 const reply=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
 const fetch=async(url:string,init:RequestInit={})=>{const path=url.replace(/^\/api/,''),method=init.method??'GET',headers=(init.headers??{}) as Record<string,string>,body=init.body as string|undefined;requests.push({method,path,headers,body});
  if(path==='/projects'&&method==='GET')return reply([]);
  if(path==='/health')return reply({ffmpeg:true,ffprobe:true,hardwareEncode:false,transcription:{local:false,providers:[]},version:'0.1.0'});
  if(path===`/projects/${initial.id}`&&method==='GET')return reply(stored,200,{ETag:etag()});
  if(path===`/projects/${initial.id}`&&method==='PUT'){if(headers['If-Match']!==etag())return reply({error:'This project changed.'},409);const sent=JSON.parse(body!) as Project,updatedAt=`2026-10-13T12:00:${String(revision).padStart(2,'0')}.000Z`;stored={...sent,updatedAt};revision++;return minimal&&headers.Prefer==='return=minimal'?reply({minimal:true,id:sent.id,updatedAt},200,{ETag:etag()}):reply(stored,200,{ETag:etag()});}
  return reply({error:'Not found'},404);};
 return {fetch,requests,puts:()=>requests.filter(r=>r.method==='PUT'),get stored(){return stored;},external(change:(p:Project)=>void){stored=JSON.parse(JSON.stringify(stored));change(stored);revision++;return etag();}};
}
async function mount(initial:Project,minimal=true){
 const server=backend(initial,minimal);globalThis.fetch=server.fetch as typeof fetch;
 const [{createRoot},{useStudio}]=await Promise.all([import('react-dom/client'),import('./useStudio')]);
 let studio!:ReturnType<typeof useStudio>;function Probe(){studio=useStudio();return null;}
 const root=createRoot(container as unknown as Element);await act(async()=>{root.render(createElement(Probe));});await act(async()=>{await studio.open(initial.id);});
 return {server,get studio(){return studio;},unmount:()=>act(async()=>{root.unmount();})};
}
const wait=(ms:number)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});
const project=()=>{const p=createProject('Studio');p.clips=[{id:'clip',mediaId:'media',name:'Clip',track:'screen',start:0,sourceIn:0,sourceOut:5,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];return p;};

test('autosave serializes once, adopts a minimal reply and keeps nested objects',async()=>{
 const app=await mount(project()),opened=app.studio.project!;
 assert.equal(app.studio.saveState,'Saved locally');assert.equal(app.server.requests.filter(r=>r.method==='GET'&&r.path.startsWith('/projects/')).length,1);
 await act(async()=>{app.studio.change(p=>{p.canvas.padding=10;});});
 const edited=app.studio.project!;assert.equal(app.studio.saveState,'Saving…');assert.equal(edited.clips,opened.clips);assert.notEqual(edited.canvas,opened.canvas);
 await wait(800);
 const [put]=app.server.puts();assert.equal(app.server.puts().length,1);assert.equal(put.headers.Prefer,'return=minimal');assert.equal(put.headers['If-Match'],'"rev-1"');assert.equal(put.body,JSON.stringify(edited));
 const saved=app.studio.project!;assert.equal(saved.clips,edited.clips);assert.equal(saved.updatedAt,app.server.stored.updatedAt);assert.equal(JSON.stringify(saved),JSON.stringify(app.server.stored),'the local copy matches the saved file byte for byte');assert.equal(app.studio.saveState,'Saved locally');
 let flushed:Project|undefined;await act(async()=>{flushed=await app.studio.flush();});assert.equal(flushed,saved);assert.equal(app.server.puts().length,1,'a clean flush sends nothing');
 await act(async()=>{app.studio.change(p=>{p.name='Again';});});await wait(800);assert.equal(app.server.puts()[1].headers['If-Match'],'"rev-2"','the next save uses the returned ETag');
 await app.unmount();
});

test('a gesture is one undo step, and undoing to the saved state needs no save',async()=>{
 const app=await mount(project()),opened=app.studio.project!;
 await act(async()=>{for(const value of [10,20,30])app.studio.change(p=>{p.canvas.padding=value;},{coalesce:'padding'});});
 assert.equal(app.studio.project!.canvas.padding,30);assert.equal(app.studio.canUndo,true);
 await act(async()=>{app.studio.undo();});assert.equal(app.studio.project,opened);assert.equal(app.studio.canUndo,false);assert.equal(app.studio.canRedo,true);assert.equal(app.studio.saveState,'Saved locally');
 await wait(800);assert.equal(app.server.puts().length,0);
 await act(async()=>{app.studio.redo();});assert.equal(app.studio.project!.canvas.padding,30);await act(async()=>{app.studio.change(p=>{p.canvas.padding=40;},{coalesce:'padding'});});
 await act(async()=>{app.studio.undo();});assert.equal(app.studio.project!.canvas.padding,30,'redo closed the gesture');
 await app.unmount();
});

test('a full save reply is adopted as before',async()=>{
 const app=await mount(project(),false);await act(async()=>{app.studio.change(p=>{p.notes='Full reply';});});await wait(800);
 assert.equal(app.studio.project!.notes,'Full reply');assert.notEqual(app.studio.project!.clips,project().clips);assert.deepEqual(app.studio.project,app.server.stored);assert.equal(app.studio.saveState,'Saved locally');
 await app.unmount();
});

test('external saves refresh a clean project and pause autosave for local edits',async()=>{
 const app=await mount(project()),source=FakeSource.last!;
 const send=(revision:string)=>act(async()=>{source.dispatchEvent(new MessageEvent('project',{data:JSON.stringify({id:app.studio.project!.id,revision,action:'saved'})}));});
 await send(app.server.external(p=>{p.name='Changed by the assistant';}));await wait(50);
 assert.equal(app.studio.project!.name,'Changed by the assistant');assert.equal(app.studio.conflicted,false);
 await act(async()=>{app.studio.change(p=>{p.notes='Local edit';});});
 await send(app.server.external(p=>{p.name='Changed again';}));await wait(50);
 assert.equal(app.studio.conflicted,true);assert.equal(app.studio.project!.notes,'Local edit');assert.equal(app.studio.saveState,'Autosave paused');
 await app.unmount();
});

test('deferred text commits before saves and history steps',async()=>{
 const app=await mount(project()),{registerPendingEdit}=await import('./useStudio');
 let text:string|null='Typed but not committed';const stop=registerPendingEdit(()=>{if(text===null)return;const value=text;text=null;app.studio.change(p=>{p.notes=value;});});
 let flushed:Project|undefined;await act(async()=>{flushed=await app.studio.flush();});
 assert.equal(flushed!.notes,'Typed but not committed');assert.equal(app.server.puts().length,1);assert.equal(JSON.parse(app.server.puts()[0].body!).notes,'Typed but not committed');
 text='More typing';await act(async()=>{app.studio.undo();});assert.equal(app.studio.project!.notes,'Typed but not committed','undo reverts the text that was still pending');
 stop();await app.unmount();
});

test('our own save echo leaves text being typed alone; other changes commit it first',async()=>{
 const app=await mount(project()),source=FakeSource.last!,{registerPendingEdit}=await import('./useStudio');
 await act(async()=>{app.studio.change(p=>{p.notes='Saved';});});await wait(800);assert.equal(app.server.puts().length,1);
 let commits=0,text:string|null='Typed';const stop=registerPendingEdit(()=>{commits++;if(text===null)return;const value=text;text=null;app.studio.change(p=>{p.name=value;});});
 const send=(revision:string)=>act(async()=>{source.dispatchEvent(new MessageEvent('project',{data:JSON.stringify({id:app.studio.project!.id,revision,action:'saved'})}));});
 await send('"rev-2"');await wait(50);assert.equal(commits,0,'the echo of our save does not commit pending text');assert.equal(app.studio.saveState,'Saved locally');
 await send(app.server.external(p=>{p.notes='Changed by the assistant';}));await wait(50);
 assert.ok(commits>0);assert.equal(app.studio.project!.name,'Typed');assert.equal(app.studio.conflicted,true,'pending text counts as an unsaved edit');
 stop();await app.unmount();
});
