import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const temporary=await mkdtemp(path.join(os.tmpdir(),'sceneforge-storage-'));
process.env.SCENEFORGE_DATA_DIR=temporary;
const s=await import('./storage.js');
await s.initStorage();
after(()=>rm(temporary,{recursive:true,force:true}));
test('projects persist atomically, stale concurrent commits conflict, and recoverable deletion keeps data',async()=>{
 const events:Array<import('./storage.js').ProjectEvent>=[];
 const observe=(event:import('./storage.js').ProjectEvent)=>events.push(event);s.projectEvents.on('project',observe);
 try{
 const p=await s.newProject('Validation project');
 assert.equal((await s.readProject(p.id)).name,p.name);
 assert.equal(events.length,1);assert.equal(events[0].revision,s.revision(await s.readProject(p.id)));assert.equal(events[0].action,'saved');
 const oldRevision=s.revision(p);
 const first={...p,name:'First edit'},second={...p,name:'Second edit'};
 const results=await Promise.allSettled([s.saveProject(first,{expectedRevision:oldRevision}),s.saveProject(second,{expectedRevision:oldRevision})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const read=await s.readProject(p.id);assert.equal(read.name,'First edit');
 assert.equal(events.length,2,'a rejected conflicting save must not broadcast');assert.equal(events[1].revision,s.revision(read));
 const versions=await s.history(p.id);assert.equal(versions.length,1);
 const restored=await s.restoreProject(p.id,versions[0].id,s.revision(read));assert.equal(restored.name,'Validation project');
 await s.trashProject(p.id);assert.equal((await s.listProjects()).some(x=>x?.id===p.id),false);assert.equal((await s.listTrash()).some(x=>x.projectId===p.id),true);
 assert.equal(events.length,4);assert.equal(events.at(-1)?.action,'trashed');assert.equal(events.at(-1)?.revision,s.revision(restored));
 assert.throws(()=>s.safeId('../secrets'));
 }finally{s.projectEvents.off('project',observe);}
});
test('trash restore preserves history/catalog and competing restores consume the item once',async()=>{
 const p=await s.newProject('Recover me'),media={id:'original-media',name:'Media',path:'/offline/take.wav',kind:'audio' as const,duration:2,width:0,height:0,hasAudio:true};
 await s.registerMedia(media);p.media=[media];const saved=await s.saveProject(p,{checkpoint:true});
 const historyBefore=await s.history(p.id),catalogBefore=await readFile(path.join(temporary,'catalog',media.id+'.json'),'utf8');
 await s.trashProject(p.id);const entry=(await s.listTrash()).find(x=>x.projectId===p.id)!;
 const results=await Promise.allSettled([s.restoreTrash(entry.id,entry.revision),s.restoreTrash(entry.id,entry.revision)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const restored=await s.readProject(p.id);assert.deepEqual({...restored,updatedAt:''},{...saved,updatedAt:''});
 assert.deepEqual(await s.history(p.id),historyBefore);assert.equal(await readFile(path.join(temporary,'catalog',media.id+'.json'),'utf8'),catalogBefore);
 assert.equal((await s.listTrash()).some(x=>x.id===entry.id),false);
});
test('collision restore creates a new identity and never overwrites the active project',async()=>{
 const p=await s.newProject('Earlier project');await s.trashProject(p.id);const entry=(await s.listTrash()).find(x=>x.projectId===p.id)!;
 const live=await s.saveProject({...p,name:'New active work',notes:'must survive'});const before=await readFile(path.join(temporary,'projects',p.id+'.json'),'utf8');
 await assert.rejects(s.restoreTrash(entry.id,entry.revision),/Restore as copy/);
 const restored=await s.restoreTrash(entry.id,entry.revision,{asCopy:true});assert.equal(restored.restoredAsCopy,true);assert.notEqual(restored.project.id,p.id);assert.match(restored.project.name,/recovered copy/);
 assert.equal(await readFile(path.join(temporary,'projects',p.id+'.json'),'utf8'),before);assert.deepEqual(await s.readProject(p.id),live);
});
test('legacy long trash names list and restore, with stale review and path traversal rejected',async()=>{
 const p=await s.newProject('Legacy trash');p.id='x'.repeat(100);await s.saveProject(p);const token=p.id+'-1700000000000';
 await writeFile(path.join(temporary,'trash',token+'.json'),JSON.stringify(p));await rm(path.join(temporary,'projects',p.id+'.json'));
 const entry=(await s.listTrash()).find(x=>x.id===token)!;assert.ok(entry);assert.equal(entry.trashedAt,'2023-11-14T22:13:20.000Z');
 await assert.rejects(s.restoreTrash(token,'stale'),/changed/);assert.ok((await s.listTrash()).find(x=>x.id===token));
 await assert.rejects(s.restoreTrash('../outside',entry.revision),/Invalid trash/);
 const restored=await s.restoreTrash(token,entry.revision);assert.equal(restored.project.id,p.id);
});
test('history restoration rejects missing/stale revisions and competes atomically with saves',async()=>{
 const p=await s.newProject('Before'),edit=await s.saveProject({...p,name:'After'},{checkpoint:true}),version=(await s.history(p.id))[0];
 await assert.rejects(s.restoreProject(p.id,version.id,''),/review/);
 await assert.rejects(s.restoreProject(p.id,version.id,s.revision(p)),/changed/);
 const outcomes=await Promise.allSettled([s.restoreProject(p.id,version.id,s.revision(edit)),s.saveProject({...edit,notes:'concurrent'},{expectedRevision:s.revision(edit)})]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 const winner=outcomes.find((x):x is PromiseFulfilledResult<Awaited<ReturnType<typeof s.saveProject>>>=>x.status==='fulfilled')!;
 assert.deepEqual(await s.readProject(p.id),winner.value);
});
test('separate trashed versions with the same project ID require explicit copy choice',async()=>{
 const p=await s.newProject('Version A');await s.trashProject(p.id);const first=(await s.listTrash()).find(x=>x.projectId===p.id)!;
 await s.saveProject({...p,name:'Version B'});await s.trashProject(p.id);const second=(await s.listTrash()).find(x=>x.projectId===p.id&&x.id!==first.id)!;
 const one=await s.restoreTrash(first.id,first.revision);await assert.rejects(s.restoreTrash(second.id,second.revision),/Restore as copy/);
 const two=await s.restoreTrash(second.id,second.revision,{asCopy:true});assert.equal(one.project.name,'Version A');assert.equal(two.project.name,'Version B (recovered copy)');assert.notEqual(one.project.id,two.project.id);
});
