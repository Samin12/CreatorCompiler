import {test} from 'node:test';import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import type {AutomationJob} from '../shared/automation';
// A minimal host for rendering the hook without a browser: the probe component renders nothing.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const noop=()=>{};(globalThis as {window?:unknown}).window??=globalThis;
const doc:Record<string,unknown>={addEventListener:noop,removeEventListener:noop,nodeType:9,activeElement:null,body:null};doc.defaultView={document:doc,HTMLIFrameElement:class{}};
const container={nodeType:1,tagName:'DIV',nodeName:'DIV',namespaceURI:'http://www.w3.org/1999/xhtml',ownerDocument:doc,addEventListener:noop,removeEventListener:noop,textContent:''};
class FakeSource extends EventTarget{readyState=1;constructor(readonly url:string){super();}close(){this.readyState=2;}}
globalThis.EventSource=FakeSource as unknown as typeof EventSource;
const wait=(ms:number)=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});
const job=(id:string,status:AutomationJob['status'],createdAt:string):AutomationJob=>({id,projectId:'project',kind:'transcription',status,progress:0,message:'',createdAt,updatedAt:createdAt,automatic:true,applied:false,undone:false});

test('with the event stream open, a job queued behind a running one still shows up after a save',async()=>{
 let jobs=[job('running','running','2026-10-14T10:00:00.000Z')];const requests:string[]=[];
 globalThis.fetch=(async(url:string)=>{requests.push(url);return new Response(JSON.stringify({jobs}),{headers:{'Content-Type':'application/json'}});}) as typeof fetch;
 const [{createRoot},{useProjectAutomation}]=await Promise.all([import('react-dom/client'),import('./useAutomation')]);
 let state!:ReturnType<typeof useProjectAutomation>;function Probe({revision}:{revision:string}){state=useProjectAutomation('project',revision);return null;}
 const root=createRoot(container as unknown as Element),render=(revision:string)=>act(async()=>{root.render(createElement(Probe,{revision}));});
 try{
  await render('opened');await wait(50);assert.deepEqual(state.jobs.map(j=>j.id),['running']);
  await render('saved');await wait(1300);
  // The server queues the automatic job after the first refetch, and sends no event until it starts.
  jobs=[...jobs,job('queued','queued','2026-10-14T10:00:01.000Z')];const seen=requests.length;await wait(50);assert.deepEqual(state.jobs.map(j=>j.id),['running']);
  await wait(1250);assert.deepEqual(state.jobs.map(j=>j.id),['queued','running']);assert.equal(requests.length,seen+1);
  // Once nothing is running, an edit refetches only once.
  jobs=jobs.map(j=>({...j,status:'complete',updatedAt:'2026-10-14T10:00:02.000Z'}));await render('edited');await wait(1300);const after=requests.length;
  assert.ok(state.jobs.every(j=>j.status==='complete'));await wait(1300);assert.equal(requests.length,after);
 }finally{await act(async()=>{root.unmount();});}
});
