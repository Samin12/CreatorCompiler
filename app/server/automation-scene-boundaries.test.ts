import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform,clipDuration,clipEffectTiming,type Project} from '../shared/types.js';
import {zoomScaleAt} from '../shared/zoom-timing.js';
import {sceneScope,scenePlanningProject,scopedCutProject} from './automation-scope.js';
import {applyOperations,planCuts} from './automation-plans.js';

function fixture():Project{
 const p=createProject('Scoped boundaries');
 p.scenes=[{id:'a',name:'A',script:'First',notes:'keep A',start:0,duration:10},{id:'b',name:'B',script:'Second',notes:'keep B',start:10,duration:10}];
 p.media=[{id:'media',name:'Source',path:'/fixture/source.mov',kind:'video',width:320,height:180,duration:40,hasAudio:true}];
 p.clips=(['screen','camera','audio'] as const).map((track,i)=>({id:track,name:track,track,mediaId:'media',recordingTakeId:'take',start:0,sourceIn:2,sourceOut:42,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),fadeIn:2,fadeOut:2},zIndex:i}));
 p.recordedTakes=[{id:'archived',createdAt:'2026-01-01',sceneId:'b',media:p.media,tracks:['screen'],offsets:[0],timeline:{duration:3,clips:[{...p.clips[0],id:'archived-clip',sourceOut:8}],captions:[{id:'old',start:0,end:1,text:'Archived'}]}}];
 return p;
}

test('scene cut planning protects boundary words while optional semantic context includes only complete words',()=>{
 const p=fixture();p.captions=[{id:'words',start:9,end:11,text:'complete crossing outside',words:[{text:'complete',start:9,end:9.2},{text:'crossing',start:9.6,end:10.3},{text:'outside',start:10.5,end:11}]}];
 const scope=sceneScope(p,'a'),protectedView=scenePlanningProject(p,scope),semanticView=scenePlanningProject(p,scope,true);
 assert.deepEqual(protectedView.captions[0].words,[{text:'complete',start:9,end:9.2},{text:'crossing',start:9.6,end:10}]);
 assert.deepEqual(semanticView.captions[0].words,[{text:'complete',start:9,end:9.2}]);
 assert.equal(protectedView.recordedTakes,undefined);
 assert.equal(planCuts(protectedView,[{id:'quiet',type:'silence',start:9.4,end:10,text:'',reason:''}]).changes.length,0,'boundary-crossing word still prevents cutting its inside portion');
 assert.equal(p.captions[0].words?.[1].end,10.3,'planning cannot mutate original timing');
});

test('scoped quiet cut keeps surviving words across a scene edge and retains outside caption formatting',()=>{
 const p=fixture();p.captions=[{id:'cross',start:8,end:11.2,text:'before after',words:[{text:'before',start:8,end:8.2},{text:'after',start:11,end:11.2}]},{id:'outside',start:13,end:14,text:'Keep, EXACT formatting!',words:[{text:'Keep',start:13,end:13.3},{text:'EXACT',start:13.4,end:14}]}];
 const before=structuredClone(p),scope=sceneScope(p,'a'),plan=planCuts(scenePlanningProject(p,scope),[{id:'quiet',type:'silence',start:8.8,end:9.8,text:'',reason:''}]);
 const ops=plan.operations.map(op=>({...op,sceneScope:scope})),out=applyOperations(p,ops,ops.map(op=>op.id));
 const removed=plan.changes[0].end!-plan.changes[0].start!;
 assert.deepEqual(out.captions[0].words?.map(w=>w.text),['before','after']);
 assert.equal(out.captions[0].id,'cross');assert.equal(out.captions[0].words?.[0].start,8);
 assert.equal(out.captions[0].words?.[1].start,11-removed);
 assert.equal(out.captions[1].text,before.captions[1].text);assert.equal(out.captions[1].start,13-removed);
 assert.deepEqual(out.scenes.map(s=>s.id),['a','b']);assert.equal(out.scenes[1].script,'Second');
 assert.ok(Math.abs(out.scenes[1].duration-10)<1e-10);assert.deepEqual(out.recordedTakes,before.recordedTakes);
 assert.deepEqual(p,before,'proposal/application leaves original immutable for guarded Undo');
});

test('scoped cuts preserve zoom phase outside the scene and through multiple split pieces',()=>{
 const p=fixture();p.zooms=[{id:'zoom',start:9.9,duration:1,scale:2,x:.5,y:.5,target:'camera',easing:'smooth'}];
 const out=scopedCutProject(p,[[9.5,10]]);
 assert.equal(zoomScaleAt(out.zooms[0],9.55),zoomScaleAt(p.zooms[0],10.05));
 assert.ok(Math.abs(out.zooms[0].effectTiming!.offset-.1)<1e-10);assert.equal(out.zooms[0].effectTiming?.duration,1);
 p.zooms[0]={...p.zooms[0],start:9.4,duration:1.5,effectTiming:{offset:.2,duration:1.7}};
 const ranges=[[9.9,10],[9.5,9.6]],pieces=scopedCutProject(p,ranges).zooms;
 assert.equal(pieces.length,3);assert.equal(new Set(pieces.map(z=>z.id)).size,3);
 let checked=0;
 for(let time=9.401;time<10.9;time+=.007){if(ranges.some(([a,b])=>time>=a&&time<b))continue;
  const mapped=time-ranges.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(time,b)-a),0),piece=pieces.find(z=>mapped>=z.start&&mapped<z.start+z.duration);
  assert.ok(piece);assert.ok(Math.abs(zoomScaleAt(piece,mapped)-zoomScaleAt(p.zooms[0],time))<1e-8);checked++;
 }
 assert.ok(checked>150);
});

test('merged scoped cuts keep synchronized source origins, scene groups, cursor and archive metadata',()=>{
 const p=fixture();p.elements=[{id:'label',type:'text',start:11,duration:1,text:'Second',x:0,y:0,width:1,height:1,color:'#fff',background:'#000',fontSize:12,opacity:1,rotation:0}];p.cursor.points=[{time:0,x:0,y:0},{time:9,x:.9,y:0},{time:12,x:1,y:0}];
 const out=scopedCutProject(p,[[8.5,9],[8,8.7]]);
 assert.deepEqual(out.scenes.map(s=>[s.id,s.start,s.duration]),[['a',0,9],['b',9,10]]);
 for(const role of ['screen','camera','audio']){const parts=out.clips.filter(c=>c.track===role);assert.deepEqual(parts.map(c=>[c.start,c.sourceIn,c.sourceOut]),[[0,2,18],[8,20,42]]);assert.equal(parts.reduce((n,c)=>n+clipDuration(c),0),19);assert.ok(parts.every(c=>clipEffectTiming(c).sourceIn===2&&clipEffectTiming(c).sourceOut===42&&c.recordingTakeId==='take'));}
 assert.equal(out.elements[0].start,10);assert.equal(out.cursor.points.at(-1)?.time,11);assert.deepEqual(out.recordedTakes,p.recordedTakes);
 assert.throws(()=>scopedCutProject(p,[[2,1]]),/positive/);assert.throws(()=>scopedCutProject(p,[[0,NaN]]),/finite/);
});
