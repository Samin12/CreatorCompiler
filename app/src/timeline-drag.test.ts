import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupMove,hitLayerDrop,isVerticalLayerDrag,sceneDragFingerprint,snapDistancePixels,snapTargets,snapTimelineDelta,timelinePointerDelta} from './timeline-drag';

test('magnet threshold follows native viewport ratio independent of time zoom, not a tenth-second grid',()=>{
 for(const viewport of [600,1200])for(const scale of [8,40,200]){const thresholdPx=snapDistancePixels(viewport),target=[{time:12,kind:'edge' as const}];assert.equal(snapTimelineDelta({delta:12-(thresholdPx-.1)/scale,anchors:[0],targets:target,scale,thresholdPx}).delta,12);const raw=12-(thresholdPx+.1)/scale;assert.equal(snapTimelineDelta({delta:raw,anchors:[0],targets:target,scale,thresholdPx}).delta,raw);}
 assert.equal(snapTimelineDelta({delta:1.234567,anchors:[0],targets:[],scale:60}).delta,1.234567);
});
test('twelve-pixel dominant vertical intent preserves timeline time but diagonal drags do not lock',()=>{assert.equal(isVerticalLayerDrag(2,11),false);assert.equal(isVerticalLayerDrag(3,12),true);assert.equal(isVerticalLayerDrag(10,12),false);assert.equal(isVerticalLayerDrag(-8,-20),true);});
test('group clamps once at earliest selected clip and preserves all offsets',()=>{
 const spans=[{id:'camera',start:3,duration:4},{id:'audio',start:1,duration:5}];const {delta}=groupMove(spans,-9,[],100);assert.equal(delta,-1);assert.deepEqual(spans.map(s=>s.start+delta),[2,0]);
});
test('either edge of any selected clip can snap, selected clips never snap to themselves',()=>{
 const spans=[{id:'a',start:1,duration:2},{id:'b',start:5,duration:1},{id:'fixed',start:10,duration:2}];const ids=new Set(['a','b']);const targets=snapTargets(spans,ids,30);assert.equal(targets.some(t=>t.id==='a'||t.id==='b'),false);const result=groupMove(spans.slice(0,2),4.06,targets,100);assert.equal(result.delta,4);assert.equal(result.guide?.time,10);
});
test('playhead wins exact ties and impossible negative snaps are rejected',()=>{
 const targets=snapTargets([{id:'x',start:5,duration:2}],new Set(),5);const result=snapTimelineDelta({delta:4.95,anchors:[0],targets,scale:100});assert.equal(result.guide?.kind,'playhead');assert.equal(snapTimelineDelta({delta:0,anchors:[2],targets:[{time:1.95,kind:'edge'}],scale:100,minDelta:0}).delta,0);
});
test('group movement gives start anchors the observed two-pixel near-tie preference',()=>{
 const result=groupMove([{id:'a',start:1,duration:2}],4,[{time:5.09,kind:'edge'},{time:7.08,kind:'edge'}],100);assert.equal(result.guide?.time,5.09);
});
test('disabled magnets keep continuous timing and pointer scroll is included',()=>{
 assert.deepEqual(snapTimelineDelta({delta:1.97,anchors:[0],targets:[{time:2,kind:'playhead'}],scale:100,enabled:false}),{delta:1.97,guide:null});assert.equal(timelinePointerDelta(100,120,40,140,60),2);
});
test('layer interiors and insertion edges use actual row coordinates and reject incompatible rows',()=>{
 const rows=[{id:'top',kind:'video' as const,top:53,bottom:121},{id:'bottom',kind:'video' as const,top:124,bottom:192},{id:'audio',kind:'audio' as const,top:195,bottom:263}];
 assert.deepEqual(hitLayerDrop(80,'video',rows),{kind:'existing',rowId:'top'});assert.deepEqual(hitLayerDrop(122,'video',rows),{kind:'new',afterId:'top',beforeId:'bottom'});assert.deepEqual(hitLayerDrop(54,'video',rows),{kind:'new',afterId:null,beforeId:'top'});assert.equal(hitLayerDrop(230,'video',rows),null);assert.deepEqual(hitLayerDrop(250,'audio',rows),{kind:'existing',rowId:'audio'});
});
test('scene drag fingerprint ignores autosave stamps and names but catches scene or clip timing edits',()=>{
 const scene={id:'s1',name:'Intro',script:'',notes:'',start:0,duration:5},clip={id:'c1',start:1,sourceIn:0,sourceOut:4,speed:1};
 const base={scenes:[scene,{...scene,id:'s2',start:5}],clips:[clip],updatedAt:'a',name:'Project'} as never as Parameters<typeof sceneDragFingerprint>[0],key=sceneDragFingerprint(base);
 assert.equal(sceneDragFingerprint({...base,updatedAt:'b',name:'Renamed',scenes:base.scenes.map(s=>({...s,name:'Other',script:'x'}))} as typeof base),key);
 for(const changed of [{scenes:[base.scenes[1],base.scenes[0]]},{scenes:[{...scene,duration:6},base.scenes[1]]},{clips:[{...clip,start:2}]},{clips:[{...clip,sourceIn:.5}]},{clips:[{...clip,sourceOut:3}]},{clips:[{...clip,speed:2}]},{clips:[]}])assert.notEqual(sceneDragFingerprint({...base,...changed} as typeof base),key);
});
