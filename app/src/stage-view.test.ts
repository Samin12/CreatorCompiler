import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {clipDuration,createProject,defaultEffects,defaultTransform,type Clip,type CursorPoint,type Media,type TrackKind} from '../shared/types';
import {clipCompositeOrder} from '../shared/timeline-layers';
import {clipShadowCss} from '../shared/clip-shadow';
import {creatorScreenTransform} from '../shared/camera-style';
import {clipFilterCss,cursorPointLookup,stageIndex,stageSlots} from './stage-view';
import {Stage} from './Stage';
import {createPlayhead} from './playhead';

const media=(id:string,kind:Media['kind']='video'):Media=>({id,name:id,path:`/${id}`,kind,duration:120,width:1920,height:1080});
const clip=(id:string,mediaId:string,track:TrackKind,start:number,sourceIn:number,length:number,patch:Partial<Clip>={}):Clip=>({id,mediaId,name:id,track,start,sourceIn,sourceOut:sourceIn+length,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects(),...patch});
function project(){
 const p=createProject();p.media=[media('screen'),media('camera'),media('mic','audio')];
 // Screen: a split (a→b continues the same source), then a cut to another source; camera and mic have a cut each.
 p.clips=[clip('a','screen','screen',0,0,5),clip('d','camera','camera',0,0,10),clip('f','mic','audio',0,0,10),clip('b','screen','screen',5,5,5),clip('c','screen','screen',10,20,5),clip('e','camera','camera',10,30,2),clip('g','mic','audio',11,11,2),clip('h','screen','screen',11.5,40,1)];
 return p;
}
const summary=(slots:ReturnType<typeof stageSlots>)=>slots.map(s=>`${s.clip.id}:${s.key}:${s.visible?'on':'pre'}`).sort();

test('contiguous same-source cuts on one row share a playback key; gaps, other sources and other speeds do not',()=>{
 const p=project(),index=stageIndex(p),key=(id:string)=>index.key.get(p.clips.find(c=>c.id===id)!);
 assert.equal(key('a'),'a');assert.equal(key('b'),'a');assert.equal(key('c'),'c');assert.equal(key('e'),'e');assert.equal(key('g'),'g');
 p.clips.find(c=>c.id==='b')!.speed=2;assert.equal(stageIndex(p).key.get(p.clips.find(c=>c.id==='b')!),'b');
 const q=project();q.clips.find(c=>c.id==='b')!.layerId='custom';q.timelineLayers=[{id:'custom',name:'Video layer 1',kind:'video',order:3}];
 assert.equal(stageIndex(q).key.get(q.clips.find(c=>c.id==='b')!),'b','another row never shares an element');
});

test('slots hold the clips under the playhead plus at most one upcoming clip per row, and never while scrubbing',()=>{
 const index=stageIndex(project());
 assert.deepEqual(summary(stageSlots(index,4,2)),['a:a:on','d:d:on','f:f:on'],'the split continuation reuses the active element');
 assert.deepEqual(summary(stageSlots(index,5,2)),['b:a:on','d:d:on','f:f:on']);
 assert.deepEqual(summary(stageSlots(index,9,2)),['b:a:on','c:c:pre','d:d:on','e:e:pre','f:f:on','g:g:pre']);
 assert.deepEqual(summary(stageSlots(index,9.6,2)),['b:a:on','c:c:pre','d:d:on','e:e:pre','f:f:on','g:g:pre'],'one upcoming clip per row');
 assert.deepEqual(summary(stageSlots(index,9,0)),['b:a:on','d:d:on','f:f:on']);
 assert.deepEqual(summary(stageSlots(index,10.5,2)),['c:c:on','e:e:on','g:g:pre','h:h:pre']);
 const p=project();p.clips.push(clip('empty','screen','overlay',4.5,3,0));assert.ok(!stageSlots(stageIndex(p),4,2).some(s=>s.clip.id==='empty'));
});

test('playback keeps one element per lane: pre-rolled clips keep their key at the cut, and splits continue the same element',()=>{
 const index=stageIndex(project()),keys=new Map<string,Set<string>>();let mounted=new Map<string,string>();
 for(let frame=0;frame<=14*60;frame++){
  const slots=stageSlots(index,frame/60,2,mounted);assert.equal(new Set(slots.map(s=>s.key)).size,slots.length,'keys are unique');
  for(const s of slots){if(mounted.has(s.clip.id))assert.equal(s.key,mounted.get(s.clip.id),`${s.clip.id} keeps its element`);const seen=keys.get(s.clip.id)??new Set();seen.add(s.key);keys.set(s.clip.id,seen);}
  mounted=new Map(slots.map(s=>[s.clip.id,s.key]));
 }
 assert.deepEqual([...keys.get('b')!],['a']);for(const id of ['c','e','g','h'])assert.deepEqual([...keys.get(id)!],[id]);
});

test('an edit never reloads a clip that is already on stage, and a split at the playhead continues its element',()=>{
 const p=project(),b=p.clips.find(c=>c.id==='b')!;
 const before=stageSlots(stageIndex(p),6,0,new Map([['b','a']]));b.sourceIn=5.5;
 assert.deepEqual(summary(stageSlots(stageIndex(p),6,0,new Map(before.map(s=>[s.clip.id,s.key])))),['b:a:on','d:d:on','f:f:on'],'the trimmed clip keeps its element');
 const q=project(),d=q.clips.find(c=>c.id==='d')!,shown=new Map(stageSlots(stageIndex(q),4,0).map(s=>[s.clip.id,s.key]));
 q.clips.push({...d,id:'d2',start:4,sourceIn:4});d.sourceOut=4;
 assert.deepEqual(summary(stageSlots(stageIndex(q),4,0,shown)),['a:a:on','d2:d:on','f:f:on']);
});

test('visible clips keep the exact composite order of the previous stable sort',()=>{
 let seed=7;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let round=0;round<40;round++){
  const p=createProject(),tracks:TrackKind[]=['screen','camera','overlay'];p.timelineLayers=[{id:'x',name:'Video layer 1',kind:'video',order:1}];
  p.clips=Array.from({length:24},(_,i)=>clip(`c${i}`,'m','screen',Math.floor(random()*8),0,1+Math.floor(random()*4),{track:tracks[Math.floor(random()*3)],...(random()<.3?{zIndex:Math.floor(random()*4)-1}:{}),...(random()<.2?{layerId:'x'}:{})}));
  const index=stageIndex(p);
  for(let time=0;time<12;time+=.5){
   const expected=p.clips.filter(c=>time>=c.start&&time<c.start+clipDuration(c)).sort((a,b)=>clipCompositeOrder(a,p)-clipCompositeOrder(b,p)).map(c=>c.id);
   const actual=stageSlots(index,time,2).filter(s=>s.visible).sort((a,b)=>index.rank.get(a.clip)!-index.rank.get(b.clip)!).map(s=>s.clip.id);
   assert.deepEqual(actual,expected);
  }
 }
});

test('cursor lookup matches the last point at or before the time, sorted or not',()=>{
 const reference=(points:CursorPoint[],time:number)=>[...points].reverse().find(point=>point.time<=time);
 const sorted:CursorPoint[]=[0,0,.5,1,1,1,2.25,3].map((time,i)=>({time,x:i/10,y:0}));
 const unsorted:CursorPoint[]=[2,0,1,1,3].map((time,i)=>({time,x:i/10,y:0}));
 for(const points of [sorted,unsorted,[],[{time:1,x:0,y:0}]]){const lookup=cursorPointLookup(points);for(const time of [-1,0,.25,.5,1,1.5,2.25,2.9,3,9,Number.NaN])assert.equal(lookup(time),reference(points,time),`t=${time}`);}
});

test('stage filters omit identity functions and keep order and the drop-shadow',()=>{
 const effects=defaultEffects(),transform=defaultTransform();
 assert.equal(clipFilterCss(effects,transform,.5),'none');
 assert.equal(clipFilterCss({...effects,brightness:.2},transform,.5),'brightness(1.2)');
 assert.equal(clipFilterCss({...effects,blur:4,grayscale:true},transform,.5),'blur(2px) grayscale(1)');
 const creator=creatorScreenTransform({width:1920,height:1080});
 assert.equal(clipFilterCss(effects,creator,.5),clipShadowCss(creator,.5).trim());assert.match(clipFilterCss(effects,creator,.5),/^drop-shadow\(/);
 const all={...effects,brightness:-.1,contrast:1.2,saturation:0,blur:2,grayscale:true};
 assert.equal(clipFilterCss(all,creator,.5),`brightness(${1+all.brightness}) contrast(1.2) saturate(0) blur(1px) grayscale(1)${clipShadowCss(creator,.5)}`);
});

test('Stage pre-rolls upcoming clips transparent, inert and hidden from assistive technology, below elements',()=>{
 const p=project();p.cursor={...p.cursor,enabled:true,points:[{time:0,x:.1,y:.1},{time:8,x:.5,y:.25}]};
 const html=renderToStaticMarkup(React.createElement(Stage,{project:p,playhead:createPlayhead(9),playing:false,onSelect:()=>{},onImport:()=>{}}));
 assert.equal(html.match(/<video/g)?.length,4);assert.equal(html.match(/<audio/g)?.length,2);
 assert.equal(html.match(/opacity:0;pointer-events:none/g)?.length,2);assert.equal(html.match(/aria-hidden="true"/g)?.length,2);
 assert.equal(html.match(/<audio[^>]*preload="auto"/g)?.length,1);assert.equal(html.match(/<video[^>]*preload="auto"/g)?.length,2);
 assert.ok(!/brightness\(/.test(html));assert.match(html,/filter:none/);
 for(const [,z] of html.matchAll(/class="stage-layer" style="z-index:(-?\d+)"/g))assert.ok(Number(z)<0);
 assert.match(html,/left:0;top:0;transform:translate\(320px,90px\)/);
});
