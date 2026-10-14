import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform,clipEffectTiming,type Clip} from '../shared/types';
import {copySelection,deleteSelection,pasteSelection,splitAt,trimSelection} from './editing';
const clip=(id:string,start=0,out=10):Clip=>({id,mediaId:'source',name:id,track:'screen',start,sourceIn:0,sourceOut:out,speed:2,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()});
test('split respects a crossing selection and preserves source speed',()=>{const p=createProject();p.clips=[clip('a'),{...clip('b'),track:'camera'}];assert.equal(splitAt(p,2,new Set(['a'])),1);assert.equal(p.clips[0].sourceOut,4);assert.equal(p.clips[2].sourceIn,4);assert.equal(p.clips[2].start,2);assert.equal(p.clips[1].sourceOut,10);assert.equal(splitAt(p,3,new Set(['absent'])),2);});
test('ripple merges overlapping removed intervals instead of shifting twice',()=>{const p=createProject();p.clips=[clip('a'),clip('b',2),clip('c',8),{...clip('audio',8),track:'audio'}];deleteSelection(p,new Set(['a','b']),true);assert.equal(p.clips[0].start,1);assert.equal(p.clips[1].start,8);});
test('explicit trim and clipboard preserve timing and timed caption words',()=>{const p=createProject();p.clips=[clip('a')];assert.equal(trimSelection(p,new Set(['a']),2,'left'),true);assert.equal(p.clips[0].sourceIn,4);assert.equal(p.clips[0].start,2);p.captions=[{id:'caption',start:2,end:4,text:'Hello',words:[{text:'Hello',start:2,end:3}]}];const data=copySelection(p,new Set(['a','caption']))!;pasteSelection(p,data,10);assert.equal(p.clips[1].start,10);assert.equal(p.captions[1].end,12);assert.equal(p.captions[1].words?.[0].start,10);});
test('repeated non-unit splits preserve one original DSP interval on every piece',()=>{
 const p=createProject();p.clips=[{...clip('source',3,11),sourceIn:2,speed:1.5,effects:{...defaultEffects(),normalize:true,denoise:true,fadeIn:3,fadeOut:2}},clip('untouched',20)];
 assert.equal(splitAt(p,5,new Set(['source'])),1);const right=p.clips.find(c=>c.start===5)!;
 assert.equal(splitAt(p,7,new Set([right.id])),1);
 const pieces=p.clips.filter(c=>c.id!=='untouched').sort((a,b)=>a.start-b.start);
 assert.deepEqual(pieces.map(c=>[c.start,c.sourceIn,c.sourceOut]),[[3,2,5],[5,5,8],[7,8,11]]);
 assert.deepEqual(pieces.map(c=>c.effectTiming),Array.from({length:3},()=>({sourceIn:2,sourceOut:11})));
 assert.deepEqual(pieces.map(c=>{const timing=clipEffectTiming(c);return [timing.offset,timing.duration];}),[[0,6],[2,6],[4,6]]);
 assert.equal(p.clips.find(c=>c.id==='untouched')!.effectTiming,undefined);
 pieces[0].effectTiming!.sourceOut=99;assert.equal(pieces[1].effectTiming!.sourceOut,11,'Each piece owns its timing metadata');
});
test('splitting an already cut clip preserves its wider effect origin',()=>{
 const p=createProject();p.clips=[{...clip('cut',10,8),sourceIn:4,effectTiming:{sourceIn:1,sourceOut:13}}];splitAt(p,11,new Set(['cut']));
 assert.deepEqual(p.clips.map(c=>c.effectTiming),[{sourceIn:1,sourceOut:13},{sourceIn:1,sourceOut:13}]);
});
test('ordinary manual trim does not establish a split effect origin',()=>{
 const p=createProject();p.clips=[{...clip('manual'),effects:{...defaultEffects(),fadeIn:2,fadeOut:1,normalize:true}}];
 trimSelection(p,new Set(['manual']),1,'left');trimSelection(p,new Set(['manual']),4,'right');
 assert.equal(p.clips[0].effectTiming,undefined);assert.deepEqual([p.clips[0].sourceIn,p.clips[0].sourceOut],[2,8]);
});
