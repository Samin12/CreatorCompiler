import assert from 'node:assert/strict';
import test from 'node:test';
import {AUTO_CURSOR_SMOOTHING,cursorDrawSize,cursorMotionSmoothing,cursorPoseAt,LARGE_CURSOR_SIZE,LEGACY_CURSOR_SIZE} from '../shared/cursor-motion';

test('legacy 24px cursor draws large and eases; an explicit other size stays put',()=>{
 assert.equal(cursorDrawSize(LEGACY_CURSOR_SIZE),LARGE_CURSOR_SIZE);
 assert.equal(cursorDrawSize(10),10);
 assert.equal(cursorDrawSize(96),96);
 assert.equal(cursorDrawSize(LARGE_CURSOR_SIZE),LARGE_CURSOR_SIZE);
 assert.equal(cursorMotionSmoothing(LEGACY_CURSOR_SIZE,0),AUTO_CURSOR_SMOOTHING);
 assert.equal(cursorMotionSmoothing(10,0),0);
 assert.equal(cursorMotionSmoothing(LARGE_CURSOR_SIZE,0),0);
});

test('short samples glide and a long pause holds instead of drifting',()=>{
 const points=[{time:0,x:0,y:0},{time:.04,x:1,y:0}];
 const mid=cursorPoseAt(points,.02,0);
 assert.ok(mid);assert.equal(mid!.visible,true);assert.ok(Math.abs(mid!.x-.5)<1e-9);
 const paused=cursorPoseAt([{time:0,x:.2,y:.3},{time:4,x:.9,y:.8}],2,0);
 assert.ok(paused);assert.ok(Math.abs(paused!.x-.2)<1e-9);assert.ok(Math.abs(paused!.y-.3)<1e-9);
 assert.equal(cursorPoseAt(points,-.01,0),null);
});

test('hidden samples stay hidden and a follow lags a fast move before catching up',()=>{
 const hidden=cursorPoseAt([{time:0,x:.1,y:.5},{time:2,x:.1,y:.5,visible:false},{time:12,x:.8,y:.4}],10.5,1);
 assert.ok(hidden);assert.equal(hidden!.visible,false);assert.ok(Math.abs(hidden!.x-.1)<1e-9);
 const back=cursorPoseAt([{time:0,x:.1,y:.5,visible:false},{time:1,x:.4,y:.2}],1.2,0);
 assert.ok(back);assert.equal(back!.visible,true);assert.ok(Math.abs(back!.x-.4)<1e-9);
 const moving=[{time:0,x:0,y:0},{time:.04,x:1,y:0},{time:.5,x:1,y:0}];
 const early=cursorPoseAt(moving,.04,1),late=cursorPoseAt(moving,.5,1);
 assert.ok(early&&late);
 assert.ok(early!.x<.85,`expected lag, got ${early!.x}`);
 assert.ok(late!.x>early!.x&&late!.x>.9,`expected catch-up, got ${late!.x}`);
 assert.deepEqual(cursorPoseAt(moving,.2,1),cursorPoseAt(moving,.2,1));
});
