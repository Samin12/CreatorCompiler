import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigateScript,scrollAdvance} from './teleprompter-navigation';
test('word and sentence shortcuts stay inside script and preserve punctuation boundaries',()=>{
 const script="First two words. Here's another sentence!\nNext scene here.";
 assert.equal(navigateScript(script,1,'nextWord'),2);assert.equal(navigateScript(script,1,'previousWord'),1);
 assert.equal(navigateScript(script,2,'nextSentence'),4);assert.equal(navigateScript(script,5,'previousSentence'),4);
 assert.equal(navigateScript(script,4,'previousSentence'),1);assert.equal(navigateScript(script,4,'nextSentence'),7);
 assert.equal(navigateScript(script,999,'nextWord'),9);assert.equal(navigateScript('',0,'nextWord'),0);
});
test('auto-scroll advances slow speeds at the true rate on Retina and resyncs after manual scrolling',()=>{
 // Chromium stores scroll offsets snapped to device pixels.
 const run=(speed:number,dpr:number,frames:number,start=0)=>{let scrollTop=start;const state={pos:start,set:start};for(let i=0;i<frames;i++){const next=scrollAdvance(state,scrollTop,speed/60,dpr);if(next!==null)scrollTop=Math.round(next*dpr)/dpr;}return scrollTop;};
 for(const dpr of [1,2])for(const speed of [5,12,30,40,140]){const travelled=run(speed,dpr,120);assert.ok(Math.abs(travelled-speed*2)<=1/dpr,`${speed}px/s at ${dpr}x moved ${travelled}`);}
 const state={pos:10,set:10};assert.equal(scrollAdvance(state,10,.1,2),null);assert.equal(state.pos,10.1);assert.equal(scrollAdvance(state,300,.25,2),300.5);assert.equal(state.pos,300.25);assert.equal(scrollAdvance(state,300.5,.1,2),null);assert.equal(state.pos,300.35);
});
