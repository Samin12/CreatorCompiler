import test from 'node:test';
import assert from 'node:assert/strict';
import {clipDuration,defaultEffects,defaultTransform,type Clip} from '../shared/types';
import {trimClipLeft} from './timeline-trim';

const makeClip=(patch:Partial<Clip>={}):Clip=>({id:'clip',mediaId:'media',name:'Video',track:'screen',start:0,sourceIn:1,sourceOut:8,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects(),...patch});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('left trim at timeline zero leaves source interval and right edge unchanged',()=>{
 const clip=makeClip();assert.deepEqual(trimClipLeft(clip,-.5),{start:0,sourceIn:1,sourceOut:8});
});
test('left trim clamps effective movement at both timeline and source boundaries with nonunit speed',()=>{
 for(const clip of [makeClip({start:.25,speed:2}),makeClip({start:3,sourceIn:.2,speed:.5})]){
  const trimmed={...clip,...trimClipLeft(clip,-10)};
  assert.ok(trimmed.start>=0&&trimmed.sourceIn>=0);
  assert.ok(trimmed.start===0||trimmed.sourceIn===0);
  near(trimmed.start+clipDuration(trimmed),clip.start+clipDuration(clip));
 }
});
test('inward trim preserves minimum timeline duration and does not extend an already short clip',()=>{
 const clip=makeClip({speed:2}),trimmed={...clip,...trimClipLeft(clip,20)};
 near(clipDuration(trimmed),.1);near(trimmed.start+clipDuration(trimmed),3.5);
 const tiny=makeClip({sourceIn:0,sourceOut:.05});assert.deepEqual(trimClipLeft(tiny,0),{start:0,sourceIn:0,sourceOut:.05});
});
