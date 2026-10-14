import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,type ExportOptions} from '../shared/types';
import type {ExportRecord} from '../shared/export-history';
import {ExportSession,exportCurrentVersion,mergeExportRecords,refreshActiveExportRecords,resolveExportOptions,type ExportRange} from './export-session';
const options:ExportOptions={format:'mp4'};
const range:ExportRange={mode:'full',sceneId:'',start:0,end:0};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const record=(id:string,revision=1,status:ExportRecord['status']='running'):ExportRecord=>({id,type:'export',status,progress:.3,message:'Rendering',startedAt:'2026-10-13T10:00:00Z',projectId:'one',projectName:'One',projectRevision:'abc',snapshotCreatedAt:'2026-10-13T09:00:00Z',options,updatedAt:'2026-10-13T10:01:00Z',revision,output:{status:'pending'},recovery:{status:'available',runtimeChanged:false}});

test('late initial history and stale polls preserve new jobs and terminal revisions',()=>{
 const complete=record('a',4,'complete'),newer=record('b',1,'queued');
 assert.deepEqual(mergeExportRecords([complete,newer],[record('a',2)],'one').map(item=>[item.id,item.status]),[['b','queued'],['a','complete']]);
 assert.equal(mergeExportRecords([complete],[record('a',4,'running')],'one')[0].status,'complete');
 assert.equal(mergeExportRecords([complete],[{...complete,revision:5,output:{status:'missing'}}],'one')[0].output.status,'missing');
 assert.equal(mergeExportRecords([complete],[{...complete,output:{status:'missing'}}],'one')[0].output.status,'missing');
 assert.equal(mergeExportRecords([complete],[{...record('x'),projectId:'other'}],'one').length,1);
});
test('closing during save prevents creating an export after the dialog disappeared',async()=>{
 const project=createProject(),session=new ExportSession();session.reset(project.id);const save=deferred<typeof project>();let calls=0;
 const promise=exportCurrentVersion(session.request(),()=>save.promise,options,range,async()=>'',async()=>{calls++;return record('a');});session.close();save.resolve(project);
 assert.equal(await promise,undefined);assert.equal(calls,0);
});
test('switching projects while a revision resolves prevents exporting the old project',async()=>{
 const project=createProject(),session=new ExportSession();session.reset(project.id);const revision=deferred<string>();let calls=0;
 const promise=exportCurrentVersion(session.request(),async()=>project,options,range,()=>revision.promise,async()=>{calls++;return record('a');});await Promise.resolve();session.reset('other');revision.resolve('saved');
 assert.equal(await promise,undefined);assert.equal(calls,0);
});
test('response from accepted export is ignored after close; a reopened session remains usable',async()=>{
 const project=createProject(),session=new ExportSession();session.reset(project.id);const response=deferred<ExportRecord>();let started=false;
 const promise=exportCurrentVersion(session.request(),async()=>project,options,range,async()=>'revision',async()=>{started=true;return response.promise;});
 await Promise.resolve();await Promise.resolve();assert.equal(started,true);session.close();session.reset(project.id);response.resolve(record('a'));
 assert.equal(await promise,undefined);assert.equal(session.request().active(),true);
});
test('new export uses the saved snapshot and scene bounds, not stale render props',async()=>{
 const saved=createProject();saved.scenes=[{id:'later',name:'Later',script:'',notes:'',start:8,duration:2},{id:'chosen',name:'Chosen',script:'',notes:'',start:3,duration:0},{id:'middle',name:'Middle',script:'',notes:'',start:5,duration:3}];
 const session=new ExportSession();session.reset(saved.id);let actual:any;
 const result=await exportCurrentVersion(session.request(),async()=>saved,options,{...range,mode:'scene',sceneId:'chosen'},async value=>{assert.equal(value,saved);return 'saved-revision';},async(...args)=>{actual=args;return record('a');});
 assert.equal(result?.id,'a');assert.equal(actual[0],saved);assert.deepEqual(actual[1].range,{start:3,end:5});assert.equal(actual[2],'saved-revision');assert.equal(actual[3].aborted,false);
});
test('project mismatch and stale scene or custom bounds fail without an export request',async()=>{
 const saved=createProject();saved.scenes[0].duration=4;const session=new ExportSession();session.reset('different');let calls=0;
 await assert.rejects(exportCurrentVersion(session.request(),async()=>saved,options,range,async()=>'',async()=>{calls++;}),/active project changed/);assert.equal(calls,0);
 assert.throws(()=>resolveExportOptions(saved,options,{...range,mode:'scene',sceneId:'removed'}),/scene changed/);
 for(const [start,end] of [[1,6],[3,2],[-1,1],[0,NaN]])assert.throws(()=>resolveExportOptions(saved,options,{...range,mode:'custom',start,end}),/within the saved timeline/);
 assert.equal(resolveExportOptions(saved,{...options,range:{start:1,end:2}},range).range,undefined);
});

 test('paged polling refreshes an older active receipt absent from the newest page',async()=>{
  const listed=record('recent',4,'complete'),older=record('old',7,'complete'),calls:string[]=[];
  const result=await refreshActiveExportRecords([listed],['recent','old','old'],async id=>{calls.push(id);return older;});
  assert.deepEqual(calls,['old']);
  assert.equal(mergeExportRecords([record('old',2)],result,'one').find(item=>item.id==='old')?.status,'complete');
 });
