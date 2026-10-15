import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProject,defaultEffects,defaultTransform,type Project} from '../shared/types.js';
import {createAutomationEngine} from './automation.js';
import {revision} from './storage.js';
import {sceneScope,scenePlanningProject,splitClipForScene} from './automation-scope.js';
import {moveRecordingScene} from '../src/recording-scenes.js';

function fixture(){
 const p=createProject('Scene actions');p.scenes=[{id:'first',name:'First',start:0,duration:10,script:'First script',notes:''},{id:'second',name:'Second',start:10,duration:10,script:'Second script',notes:''}];
 p.media=[{id:'source',name:'Source',path:'/tmp/source.mp4',kind:'video',duration:20,width:1920,height:1080,hasAudio:true}];
 p.clips=[{id:'clip',name:'Camera',mediaId:'source',track:'camera',start:0,sourceIn:0,sourceOut:20,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 p.captions=[{id:'a',text:'First phrase',start:1,end:2,words:[{text:'First',start:1,end:1.4},{text:'phrase',start:1.4,end:2}]},{id:'b',text:'Second phrase',start:11,end:12,words:[{text:'Second',start:11,end:11.4},{text:'phrase',start:11.4,end:12}]},{id:'c',text:'Last word',start:18,end:19,words:[{text:'Last',start:18,end:18.4},{text:'word',start:18.4,end:19}]}];
 return p;
}
async function setup(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scene-actions-'));let p=fixture();p.media[0].path=path.join(dir,'source.mp4');await fs.writeFile(p.media[0].path,'synthetic');let analyzed:Project|undefined,semantic:Project|undefined;
 const engine=createAutomationEngine({root:dir,cache:path.join(dir,'cache'),read:async()=>structuredClone(p),save:async(next,options)=>{assert.equal(options?.expectedRevision,revision(p));p=structuredClone(next);return structuredClone(p);},settings:async()=>({provider:'local',model:'',baseUrl:'',language:'en'}),register:async media=>media,transcribe:async()=>({captions:fixture().captions,provider:'local test'}),analyze:async project=>{analyzed=structuredClone(project);return {suggestions:[{id:'outside',type:'silence',start:3,end:5,text:'',reason:''},{id:'inside',type:'silence',start:14,end:16,text:'',reason:''}]};},semantic:async project=>{semantic=structuredClone(project);return {changes:[],operations:[],warnings:[]};},inspect:async()=>[]});
 return {engine,get project(){return p;},set project(value:Project){p=value;},get analyzed(){return analyzed;},get semantic(){return semantic;},async close(){await engine.shutdown();await fs.rm(dir,{recursive:true,force:true});}};
}
async function ready(engine:ReturnType<typeof createAutomationEngine>,id:string){for(let i=0;i<100;i++){const job=await engine.get(id);if(job.status!=='queued'&&job.status!=='running')return job;await new Promise(r=>setTimeout(r,10));}throw Error('Job did not finish');}

test('scene planning excludes other scenes and retains absolute source timing',()=>{
 const p=fixture(),scope=sceneScope(p,'second'),q=scenePlanningProject(p,scope);
 assert.deepEqual(q.scenes.map(s=>s.id),['second']);assert.deepEqual(q.clips.map(c=>[c.start,c.sourceIn,c.sourceOut]),[[10,10,20]]);assert.deepEqual(q.captions.map(c=>c.id),['b','c']);
 assert.deepEqual(p.clips.map(c=>[c.start,c.sourceIn,c.sourceOut]),[[0,0,20]]);
 assert.throws(()=>sceneScope(p,'missing'),/no longer exists/);
 const parts=splitClipForScene(p.clips[0],{start:5,end:15});assert.deepEqual(parts.map(c=>[c.clip.start,c.clip.sourceIn,c.clip.sourceOut,c.inside]),[[0,0,5,false],[5,5,15,true],[15,15,20,false]]);
 assert.ok(parts.every(c=>c.clip.effectTiming?.sourceOut===20));assert.equal(new Set(parts.map(c=>c.clip.id)).size,3);
});

test('styling a video leaves exported chapter graphics optional until explicitly selected',async()=>{
 const s=await setup();try{
  const job=await s.engine.quickAction(s.project.id,{kind:'visualize'}),done=await ready(s.engine,job.id);
  const graphics=done.proposal!.changes.filter(change=>change.category==='chapter'||change.category==='proof');assert.ok(graphics.length>0);assert.ok(graphics.every(change=>!change.selected));
  const applied=await s.engine.apply(job.id,done.proposal!.changes.filter(change=>change.selected).map(change=>change.id));assert.equal(applied.project.elements.length,0);
 }finally{await s.close();}
});

test('cut review returns original and selected edited timelines with aligned join times without applying them',async()=>{
 const s=await setup();try{
  const before=structuredClone(s.project),job=await s.engine.quickAction(before.id,{kind:'auto-cut',sceneId:'second'}),done=await ready(s.engine,job.id),cut=done.proposal!.changes.find(change=>change.category==='silence')!;
  const review=await s.engine.review(job.id,[cut.id]);assert.deepEqual(review.before,before);assert.ok(Math.abs(review.after.scenes[1].duration-8.3333333333)<1e-6);assert.equal(review.joins.length,1);assert.ok(Math.abs(review.joins[0].originalStart-14.1666666667)<1e-6);assert.ok(Math.abs(review.joins[0].editedTime-14.1666666667)<1e-6);assert.deepEqual(s.project,before);
 }finally{await s.close();}
});

test('per-scene Auto-cut scopes analysis and cuts while retaining scene IDs and undo',async()=>{
 const s=await setup();try{
 const before=structuredClone(s.project),job=await s.engine.quickAction(before.id,{kind:'auto-cut',sceneId:'second',semantic:true}),done=await ready(s.engine,job.id);
 assert.equal(done.status,'ready',done.error);assert.equal(done.sceneId,'second');assert.equal(done.sceneName,'Second');
 assert.deepEqual(s.analyzed?.scenes.map(s=>s.id),['second']);assert.deepEqual(s.semantic?.captions.map(c=>c.id),['b','c']);
 assert.ok(done.proposal!.changes.length>0);assert.ok(done.proposal!.changes.every(c=>c.start!>=10&&c.end!<=20));
 const applied=await s.engine.apply(job.id,done.proposal!.changes.map(c=>c.id));assert.deepEqual(applied.project.scenes.map(s=>s.id),['first','second']);assert.deepEqual(applied.project.scenes[0],before.scenes[0]);assert.ok(applied.project.scenes[1].duration<10);
 assert.deepEqual(applied.project.captions.find(c=>c.id==='a'),before.captions[0]);
 const undone=await s.engine.undo(job.id);assert.deepEqual(undone.project,before);
 }finally{await s.close();}
});

test('per-scene Visualize splits spanning media and leaves the other scene unchanged',async()=>{
 const s=await setup();try{
 const before=structuredClone(s.project),job=await s.engine.quickAction(before.id,{kind:'visualize',sceneId:'second'}),done=await ready(s.engine,job.id);
 assert.equal(done.status,'ready',done.error);const applied=await s.engine.apply(job.id,done.proposal!.changes.map(c=>c.id));
 assert.deepEqual(applied.project.scenes,before.scenes);assert.deepEqual(applied.project.canvas,before.canvas);
 const first=applied.project.clips.find(c=>c.start===0)!,second=applied.project.clips.find(c=>c.start===10)!;
 assert.deepEqual(first.transform,before.clips[0].transform);assert.equal(first.sourceOut,10);assert.equal(second.sourceIn,10);assert.equal(second.transform.x,.7966);
 assert.ok(applied.project.elements.every(e=>e.start>=10));assert.equal(applied.project.clips.some(c=>c.id==='automation-dot-grid'),false);
 const reordered=structuredClone(applied.project);moveRecordingScene(reordered,'second','first');
 assert.deepEqual(reordered.scenes.map(s=>[s.id,s.start]),[['second',0],['first',10]]);
 assert.equal(reordered.clips.find(c=>c.sourceIn===10)?.start,0);
 assert.ok(reordered.elements.every(e=>e.start<10));
 assert.deepEqual((await s.engine.undo(job.id)).project,before);
 await assert.rejects(s.engine.quickAction(before.id,{kind:'visualize',sceneId:'missing'}),/no longer exists/);
 }finally{await s.close();}
});

test('scene transcription fallback preserves every outside caption and empty scene ID is rejected',async()=>{
 const s=await setup();try{
 const before=structuredClone(s.project);before.captions=[{...before.captions[0],text:'First phrase — keep my punctuation.'}];s.project=before;
 await assert.rejects(s.engine.quickAction(before.id,{kind:'auto-cut',sceneId:''}),/Choose auto-cut/);
 const job=await s.engine.quickAction(before.id,{kind:'auto-cut',sceneId:'second'}),done=await ready(s.engine,job.id);
 assert.equal(done.status,'ready',done.error);
 assert.deepEqual(s.project.captions.filter(c=>c.start<10),before.captions);
 assert.ok(s.project.captions.some(c=>c.start>=10));
 assert.deepEqual(s.project.scenes,before.scenes);assert.deepEqual(s.project.clips,before.clips);
 }finally{await s.close();}
});
