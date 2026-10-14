import {test} from 'node:test';import assert from 'node:assert/strict';
import {COALESCE_MS,EditHistory} from './edit-history';
const limit=()=>80;
test('edits without a key each add one undo step and clear redo',()=>{const h=new EditHistory<string>();assert.equal(h.record('a',limit,undefined,0),true);assert.equal(h.record('b',limit,undefined,10),true);assert.deepEqual(h.past,['a','b']);assert.equal(h.undo('c'),'b');assert.deepEqual(h.future,['c']);h.record('b',limit,undefined,20);assert.deepEqual(h.future,[]);});
test('a coalesced gesture keeps only its starting state and still clears redo',()=>{
 const h=new EditHistory<number>();h.record(0,limit);assert.equal(h.undo(1),0);assert.deepEqual(h.future,[1]);
 assert.equal(h.record(0,limit,'padding',1000),true);assert.equal(h.record(1,limit,'padding',1400),false);assert.equal(h.record(2,limit,'padding',2300),false,'the window slides with each edit');
 assert.deepEqual(h.past,[0]);assert.deepEqual(h.future,[]);assert.equal(h.undo(3),0,'one undo returns to the state before the gesture');
});
test('the window closes after a pause, another key, an unkeyed edit, undo or redo',()=>{
 const h=new EditHistory<string>();h.record('a',limit,'name',0);assert.equal(h.record('b',limit,'name',COALESCE_MS+1),true,'pause');
 assert.equal(h.record('c',limit,'notes',COALESCE_MS+2),true,'other key');assert.equal(h.record('d',limit,undefined,COALESCE_MS+3),true,'unkeyed edit');assert.equal(h.record('e',limit,'notes',COALESCE_MS+4),true,'after an unkeyed edit');
 // Undo, type, undo must not lose a step.
 assert.equal(h.undo('f'),'e');assert.equal(h.record('e',limit,'notes',COALESCE_MS+5),true,'after undo');assert.equal(h.undo('g'),'e');
 h.record('e',limit,'notes',COALESCE_MS+6);assert.equal(h.undo('h'),'e');assert.equal(h.redo('e'),'h');assert.equal(h.record('h',limit,'notes',COALESCE_MS+7),true,'after redo');
});
test('the step limit is read only when a step is added and drops the oldest steps',()=>{
 const h=new EditHistory<number>();let reads=0;const small=()=>{reads++;return 3;};
 for(let i=0;i<5;i++)h.record(i,small);assert.deepEqual(h.past,[2,3,4]);assert.equal(reads,5);
 h.record(5,small,'drag',0);h.record(6,small,'drag',10);assert.equal(reads,6,'a continued gesture does not measure the project');
 h.reset();assert.deepEqual([h.past,h.future],[[],[]]);assert.equal(h.record(7,small,'drag',20),true,'reset closes the window');
 assert.equal(h.undo(8),7);assert.equal(h.undo(7),undefined);assert.equal(h.redo(7),8);assert.equal(h.redo(8),undefined);
});
