import test from 'node:test';
import assert from 'node:assert/strict';
import {clampTimelineHeight,parseTimelineHeight,timelineHeightBounds} from './timeline-resize';
test('timeline height reserves preview and transport in normal windows and fits short windows',()=>{
 assert.deepEqual(timelineHeightBounds(700),{min:120,max:542});
 for(const height of [0,30,100,180,240,360,700,1000]){const bounds=timelineHeightBounds(height);assert.ok(bounds.min>=0&&bounds.min<=bounds.max);assert.ok(bounds.max<=Math.max(0,height-38));assert.equal(clampTimelineHeight(1e6,bounds),bounds.max);assert.equal(clampTimelineHeight(-100,bounds),bounds.min);}
});
test('preference parsing rejects invalid data without losing valid saved sizes',()=>{
 for(const value of [null,'',' ','NaN','Infinity','-1','20001','corrupt'])assert.equal(parseTimelineHeight(value),200);
 assert.equal(parseTimelineHeight('345'),345);assert.equal(parseTimelineHeight('0'),0);
 assert.equal(clampTimelineHeight(NaN,{min:120,max:300}),200);
});
