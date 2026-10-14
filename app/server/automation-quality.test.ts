import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform,type Caption} from '../shared/types.js';
import {applyOperations,planCuts,planVisuals,spokenWord,wordFreeIntervals} from './automation-plans.js';
import {sceneScope,scenePlanningProject} from './automation-scope.js';
const words=(...items:Array<[string,number,number]>)=>items.map(([text,start,end])=>({text,start,end}));
function fixture(captions:Caption[],duration=40){const p=createProject('Quality fixture');p.canvas={...p.canvas,width:320,height:180,fps:30};p.scenes[0].duration=duration;p.media=[{id:'speech',path:'/tmp/synthetic.wav',name:'Speech',kind:'audio',duration,width:0,height:0}];p.clips=[{id:'voice',mediaId:'speech',name:'Voice',track:'audio',start:0,sourceIn:0,sourceOut:duration,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];p.captions=captions;return p;}
const quiet=(start:number,end:number)=>({id:`q${start}`,type:'silence' as const,start,end,text:'',reason:''});

test('a word timed early into a quiet gap trims the cut instead of discarding it',()=>{
 const p=fixture([{id:'c',start:0,end:12,text:'',words:words(['first',0,1],['thought',1,2],['next',8.4,9],['idea',9,9.6])}]);
 const plan=planCuts(p,[quiet(2,8.9)]);
 assert.deepEqual(plan.changes.map(c=>[c.category,+c.start!.toFixed(2),+c.end!.toFixed(2),c.selected]),[['silence',2.17,8.23,true]]);
 assert.deepEqual(wordFreeIntervals(0,10,[[2,3],[1,2.5],[9,12]]),[[0,1],[3,9]]);
});

test('punctuation and bracketed non-speech tokens never protect a silence',()=>{
 assert.deepEqual(['[','--','......','[BLANK_AUDIO]','(music)','okay','24/7'].map(text=>spokenWord({text,start:0,end:1})),[false,false,false,false,false,true,true]);
 const p=fixture([{id:'c',start:0,end:30,text:'',words:words(['we',0,.5],['stop',.5,1],['--',1,1.1],['[',20,20.7])}],30);
 const plan=planCuts(p,[quiet(1.2,30)]);
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].category,'silence');assert.ok(plan.changes[0].end!-plan.changes[0].start!>28);
});

test('an abandoned sentence that restarts is proposed for review and the later attempt survives',()=>{
 const p=fixture([{id:'c',start:0,end:30,text:'',words:words(['Welcome',0,.4],['back.',.4,.8],['This',1,1.2],['tool',1.2,1.5],['makes',1.5,1.8],['editing',1.8,2.3],['quick',2.3,2.6],['and......',2.6,3.4],['This',6,6.2],['tool',6.2,6.5],['makes',6.5,6.8],['editing',6.8,7.3],['simple',7.3,7.8],['for',7.8,8],['everyone.',8,8.6])}],30);
 const plan=planCuts(p,[]),restart=plan.changes.find(c=>c.id.startsWith('restart-'))!;
 assert.ok(restart,'restart proposed');assert.equal(restart.selected,false);assert.equal(restart.category,'repeat');
 assert.deepEqual([+restart.start!.toFixed(2),+restart.end!.toFixed(2)],[1,6]);
 const out=applyOperations(p,plan.operations,[restart.id]);
 assert.equal(out.captions.flatMap(c=>c.words??[]).map(w=>w.text).join(' '),'Welcome back. This tool makes editing simple for everyone.');
});

test('a phrase repeated in flowing speech without a trail-off or pause is not a restart',()=>{
 const p=fixture([{id:'c',start:0,end:20,text:'',words:words(['you',0,.2],['can',.2,.4],['see',.4,.6],['right',.6,.8],['here',.8,1],['the',1,1.2],['menu',1.2,1.6],['and',1.6,1.8],['you',1.8,2],['can',2,2.2],['see',2.2,2.4],['right',2.4,2.6],['here',2.6,2.8],['the',2.8,3],['button',3,3.4])}],20);
 assert.equal(planCuts(p,[]).changes.filter(c=>c.id.startsWith('restart-')).length,0);
});

test('a scene-only visualize pass numbers its chapter like the whole project and keeps labels clear of captions',()=>{
 const p=fixture([],30);p.scenes=[{id:'a',name:'Intro',script:'',notes:'',start:0,duration:10},{id:'b',name:'Setup',script:'',notes:'',start:10,duration:10},{id:'c',name:'Demo',script:'',notes:'',start:20,duration:10}];
 p.media.push({id:'screen',path:'/tmp/screen.mov',name:'Screen',kind:'video',duration:30,width:1920,height:1080});p.clips.push({...p.clips[0],id:'screen-clip',mediaId:'screen',track:'screen'});
 const scope=sceneScope(p,'b');assert.deepEqual(scope.position,{index:1,total:3});
 const grid={id:'grid',name:'Grid',path:'/tmp/grid.bmp',kind:'image' as const,duration:0,width:320,height:180};
 const plan=planVisuals(scenePlanningProject(p,scope),grid,scope),elements=plan.operations.flatMap(o=>o.kind==='elements'?o.elements:[]);
 assert.ok(plan.changes.some(c=>c.label==='Chapter 2: Setup'));
 assert.equal(elements.find(e=>e.id.endsWith('-badge'))?.text,'2/3\nSetup');
 assert.ok(elements.find(e=>e.id.startsWith('proof-'))!.y<.1,'bottom captions keep the band below the panel');
 p.captionStyle={...p.captionStyle,position:'top'};
 assert.ok(planVisuals(scenePlanningProject(p,scope),grid,scope).operations.flatMap(o=>o.kind==='elements'?o.elements:[]).find(e=>e.id.startsWith('proof-'))!.y>.8);
});
