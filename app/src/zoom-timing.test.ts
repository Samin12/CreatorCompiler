import test from 'node:test';
import assert from 'node:assert/strict';
import {zoomScaleAt} from '../shared/zoom-timing';
import {createProject,type Zoom} from '../shared/types';
import {moveRecordingScene} from './recording-scenes';

test('split zoom pieces retain original ramp at every sampled time rather than restart easing',()=>{
 const original:Zoom={id:'z',start:1.8,duration:1,scale:2,x:.5,y:.5,target:'screen',easing:'smooth'};
 const first={...original,start:3.8,duration:.2,effectTiming:{offset:0,duration:1}},second={...original,start:0,duration:.8,effectTiming:{offset:.2,duration:1}};
 for(let i=1;i<200;i++){const elapsed=i/200,old=original.start+elapsed,piece=old<2?first:second,time=old<2?old+2:old-2;assert.ok(Math.abs(zoomScaleAt(original,old)-zoomScaleAt(piece,time))<1e-10);}
 assert.equal(zoomScaleAt(second,.1),2);assert.equal(zoomScaleAt(second,.8),1);
});
test('repeated real scene reorder keeps zoom phase and applying inverse order restores sampled scales',()=>{
 const p=createProject();p.scenes=['a','b','c'].map((id,i)=>({id,name:id,start:i*2,duration:2,script:'',notes:''}));p.zooms=[{id:'z',start:1.8,duration:1,scale:2,x:.5,y:.5,target:'screen',easing:'smooth'}];const original=structuredClone(p.zooms[0]);
 moveRecordingScene(p,'b','a');assert.equal(p.zooms.length,2);moveRecordingScene(p,'a','b');
 for(let i=1;i<180;i++){const time=i/30,zoom=p.zooms.find(z=>time>=z.start&&time<z.start+z.duration),actual=zoom?zoomScaleAt(zoom,time):1;assert.ok(Math.abs(actual-zoomScaleAt(original,time))<1e-10);}
});
