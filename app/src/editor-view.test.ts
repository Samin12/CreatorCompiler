import test from 'node:test';
import assert from 'node:assert/strict';
import type {AutomationJob} from '../shared/automation';
import type {Clip,Project} from '../shared/types';
import {createPlayhead} from './playhead';
import type {TranscriptWord} from './transcript-editing';
import {currentWordIndices,derivedSnapshot,firstAtOrAfter,frameThrottle,keyframeWindowStart,KEYFRAME_WINDOW,partitionPoint,sameIndices,sameStatusJobs,sameTranscriptTiming,wordEndCeilings} from './editor-view';

const word=(start:number,end:number,i:number):TranscriptWord=>({id:`w${i}`,captionId:'c',text:`w${i}`,start,end,timed:true});

test('binary searches agree with a linear scan',()=>{
 const points=[0,.5,.5,1,2,4].map(time=>({time}));
 for(const t of [-1,0,.25,.5,.75,1,3,4,9])assert.equal(firstAtOrAfter(points,t),points.findIndex(p=>p.time>=t)===-1?points.length:points.findIndex(p=>p.time>=t));
 assert.equal(partitionPoint(0,()=>true),0);assert.equal(partitionPoint(5,i=>i<3),3);
});

test('current word indices match the per-word check, including overlapping and gapped words',()=>{
 const words=[word(0,10,0),word(1,2,1),word(3,4,2),word(4,5,3),word(4.5,4.8,4),word(12,13,5)];const ceilings=wordEndCeilings(words);
 for(let t=-1;t<=14;t+=.05)assert.deepEqual(currentWordIndices(words,ceilings,t),words.flatMap((w,i)=>t>=w.start&&t<w.end?[i]:[]),`time ${t}`);
 assert.deepEqual(currentWordIndices(words,ceilings,3.5),[0,2]);assert.deepEqual(currentWordIndices(words,ceilings,11),[]);assert.deepEqual(currentWordIndices(words,ceilings,Number.NaN),[]);
 assert.deepEqual(currentWordIndices([],wordEndCeilings([]),1),[]);
});

test('derived snapshots keep their identity until the selected value changes',()=>{
 const playhead=createPlayhead(1),snapshot=derivedSnapshot(playhead.get,time=>[Math.floor(time)],sameIndices);
 const first=snapshot();assert.deepEqual(first,[1]);playhead.set(1.5);assert.equal(snapshot(),first);playhead.set(2.1);const second=snapshot();assert.deepEqual(second,[2]);assert.notEqual(second,first);assert.equal(snapshot(),second);
 let calls=0;const counted=derivedSnapshot(playhead.get,time=>{calls++;return time;});counted();counted();assert.equal(calls,1);
});

test('keyframe windows show short lists whole and keep the playhead well inside long ones',()=>{
 assert.equal(keyframeWindowStart(KEYFRAME_WINDOW,90),0);assert.equal(keyframeWindowStart(10,9),0);
 for(const count of [151,600,36000])for(let index=0;index<=count;index+=7){const start=keyframeWindowStart(count,index),end=Math.min(count,start+KEYFRAME_WINDOW);assert.ok(start>=0&&end<=count&&end-start===KEYFRAME_WINDOW);if(index<count)assert.ok(index>=start&&index<end,`${count}:${index}`);}
 assert.equal(keyframeWindowStart(1000,120),50);assert.equal(keyframeWindowStart(1000,149),50);assert.equal(keyframeWindowStart(1000,150),100);assert.equal(keyframeWindowStart(1000,1000),850);
});

test('transcript timing comparison ignores visual edits but catches timing and text changes',()=>{
 const clip={id:'a',start:0,sourceIn:0,sourceOut:5,speed:1,name:'A',gain:1,transform:{x:0}} as unknown as Clip;
 const base={id:'p',clips:[clip],captions:[{id:'c',start:0,end:1,text:'hi there',words:[{text:'hi',start:0,end:.5},{text:'there',start:.5,end:1}]}]} as unknown as Project;
 const copy=()=>structuredClone(base);
 assert.ok(sameTranscriptTiming(base,base));assert.ok(sameTranscriptTiming(base,copy()));
 const visual=copy();visual.clips[0].gain=.5;visual.clips[0].name='B';assert.ok(sameTranscriptTiming(base,visual));
 for(const edit of [(p:Project)=>{p.clips[0].start=1;},(p:Project)=>{p.clips[0].sourceOut=4;},(p:Project)=>{p.clips[0].speed=2;},(p:Project)=>{p.clips.push({...p.clips[0],id:'b'});},(p:Project)=>{p.captions[0].text='hello there';},(p:Project)=>{p.captions[0].words![1].start=.6;},(p:Project)=>{delete p.captions[0].words;},(p:Project)=>{p.id='q';}]){const next=copy();edit(next);assert.equal(sameTranscriptTiming(base,next),false);}
});

test('status job lists compare by the fields the status chips render',()=>{
 const job={id:'j',projectId:'p',kind:'transcription',status:'running',progress:.2,message:'Working',updatedAt:'1',createdAt:'0',automatic:true,applied:false,undone:false} as AutomationJob;
 assert.ok(sameStatusJobs([job],[{...job}]));assert.ok(sameStatusJobs([],[]));
 assert.equal(sameStatusJobs([job],[{...job,progress:.3}]),false);assert.equal(sameStatusJobs([job],[{...job,status:'complete'}]),false);assert.equal(sameStatusJobs([job],[]),false);
});

test('frame throttle applies the first value at once, then the latest value once per frame',()=>{
 const frames:Array<()=>void>=[],applied:number[]=[];let cancelled=0;
 const throttle=frameThrottle<number>(value=>applied.push(value),callback=>frames.push(callback),()=>{cancelled++;});
 const flush=()=>frames.splice(0).forEach(callback=>callback());
 throttle.run(1);throttle.run(2);throttle.run(3);assert.deepEqual(applied,[1]);
 flush();assert.deepEqual(applied,[1,3]);flush();assert.deepEqual(applied,[1,3]);assert.equal(frames.length,0);
 throttle.run(4);assert.deepEqual(applied,[1,3,4]);throttle.run(5);throttle.cancel();assert.equal(cancelled,1);flush();assert.deepEqual(applied,[1,3,4]);
 throttle.run(6);assert.deepEqual(applied,[1,3,4,6]);
});
