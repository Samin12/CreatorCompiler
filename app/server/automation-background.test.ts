import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,defaultEffects,defaultTransform,type Media} from '../shared/types.js';
import {planVisuals,applyOperations} from './automation-plans.js';

const background:Media={id:'grid',name:'Legacy grid',path:'/tmp/grid.bmp',kind:'image',duration:0,width:1920,height:1080};
function fixture(){
 const p=createProject('Moving canvas');p.scenes[0].duration=20;
 p.media=[{id:'screen',name:'Screen',path:'/tmp/screen.mp4',kind:'video',duration:20,width:1920,height:1080}];
 p.clips=[{id:'screen',mediaId:'screen',name:'Screen',track:'screen',start:0,sourceIn:0,sourceOut:20,speed:1,gain:1,muted:true,transform:defaultTransform(),effects:defaultEffects()}];
 return p;
}
test('Visualize retains the moving canvas instead of covering it with a still',()=>{
 const p=fixture();p.canvas.backgroundPattern='moving-dots';
 const plan=planVisuals(p,background),after=applyOperations(p,plan.operations,['proof-layout']);
 assert.equal(after.canvas.backgroundPattern,'moving-dots');
 assert.equal(after.clips.some(c=>c.id==='automation-dot-grid'),false);
 assert.equal(after.media.some(m=>m.id==='grid'),false);
 assert.equal(plan.warnings.some(w=>w.includes('grid is static')),false);
 assert.deepEqual([after.clips[0].start,after.clips[0].sourceIn,after.clips[0].sourceOut],[0,0,20]);
 assert.equal(p.clips[0].transform.width,1);
});
test('legacy solid projects retain the reviewed static grid treatment',()=>{
 const p=fixture();delete p.canvas.backgroundPattern;
 const plan=planVisuals(p,background),after=applyOperations(p,plan.operations,['proof-layout']);
 assert.equal(after.clips.find(c=>c.id==='automation-dot-grid')?.zIndex,-1000);
 assert.equal(after.media.some(m=>m.id==='grid'),true);
 assert.equal(after.canvas.backgroundPattern,undefined);
 assert.equal(plan.warnings.some(w=>w.includes('grid is static')),true);
});
