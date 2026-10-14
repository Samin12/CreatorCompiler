import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedWork} from './shared-work.js';
const controlled=()=>{let release!:(value:string)=>void;const signals:AbortSignal[]=[];const work=(signal:AbortSignal)=>{signals.push(signal);return new Promise<string>((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};return {work,signals,release:(v:string)=>release(v)};};
test('one aborted requester releases only its interest in shared work',async()=>{
 const run=sharedWork<string>(),c=controlled(),preview=new AbortController(),png=new AbortController();
 const first=run('mask',c.work,preview.signal),second=run('mask',c.work,png.signal);await Promise.resolve();
 assert.equal(c.signals.length,1);assert.equal(run.pending('mask'),2);
 preview.abort();await assert.rejects(first,/abort/i);assert.equal(c.signals[0].aborted,false,'the PNG request still needs the mask');
 c.release('done');assert.equal(await second,'done');assert.equal(run.pending('mask'),0);
});
test('shared work stops when every requester aborted and a later request starts fresh',async()=>{
 const run=sharedWork<string>(),c=controlled(),a=new AbortController(),b=new AbortController();
 const one=run('mask',c.work,a.signal),two=run('mask',c.work,b.signal);await Promise.resolve();a.abort();b.abort();
 await assert.rejects(one,/abort/i);await assert.rejects(two,/abort/i);assert.equal(c.signals[0].aborted,true);
 const fresh=run('mask',c.work);await Promise.resolve();assert.equal(c.signals.length,2);assert.equal(c.signals[1].aborted,false);c.release('again');assert.equal(await fresh,'again');
 const aborted=new AbortController();aborted.abort();await assert.rejects(run('mask',c.work,aborted.signal),/abort/i);assert.equal(c.signals.length,2);
});
