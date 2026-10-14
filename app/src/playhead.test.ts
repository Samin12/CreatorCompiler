import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayhead} from './playhead';

test('playhead notifies subscribers only for real time changes and stops after unsubscribe',()=>{
 const playhead=createPlayhead(2);let calls=0;const stop=playhead.subscribe(()=>{calls++;});
 assert.equal(playhead.get(),2);
 playhead.set(2);playhead.set(Number.NaN);assert.equal(calls,0);
 playhead.set(3.5);assert.equal(playhead.get(),3.5);assert.equal(calls,1);
 stop();playhead.set(4);assert.equal(calls,1);assert.equal(playhead.get(),4);
});

test('a listener that unsubscribes during notification does not skip the others',()=>{
 const playhead=createPlayhead();const seen:string[]=[];
 const stopA=playhead.subscribe(()=>{seen.push('a');stopA();});playhead.subscribe(()=>{seen.push('b');});
 playhead.set(1);playhead.set(2);
 assert.deepEqual(seen,['a','b','b']);
});
