import test from 'node:test';import assert from 'node:assert/strict';
import {sameTimelineWindow,timelineWindow} from './timeline-viewport';
test('window always covers the visible viewport with overscan on both sides',()=>{
 for(const width of [0,300,1000,1400,2400])for(let left=0;left<20000;left+=37){const view=timelineWindow(left,width),step=Math.max(64,Math.round(width/4));assert.ok(view.left<=Math.max(0,left-step)&&view.left>=0);assert.ok(view.right>=left+width+step);assert.equal(view.width,width);}
});
test('scrolling within a step keeps the same window and crossing a step moves it once',()=>{
 const first=timelineWindow(0,1400);assert.deepEqual(first,{left:0,right:2100,width:1400});
 for(let left=0;left<350;left++)assert.ok(sameTimelineWindow(timelineWindow(left,1400),first));
 const next=timelineWindow(350,1400);assert.ok(!sameTimelineWindow(next,first));assert.deepEqual(next,{left:0,right:2450,width:1400});
 for(let left=350;left<700;left+=7)assert.ok(sameTimelineWindow(timelineWindow(left,1400),next));
 assert.deepEqual(timelineWindow(1050.5,1400),{left:700,right:3150,width:1400});
});
test('only a width change updates the window and invalid input stays finite',()=>{
 assert.ok(sameTimelineWindow(timelineWindow(500,1000),timelineWindow(500,1000)));assert.ok(!sameTimelineWindow(timelineWindow(500,1000),timelineWindow(500,1001)));
 for(const view of [timelineWindow(NaN,NaN),timelineWindow(-50,Infinity),timelineWindow(Infinity,800)])assert.ok(Number.isFinite(view.left)&&Number.isFinite(view.right)&&view.right>view.left);
});
