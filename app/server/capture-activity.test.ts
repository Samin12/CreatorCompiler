import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureActivity} from './capture-activity.js';
test('capture leases defer work until closed or stale, then settle before background work resumes',()=>{
 let t=1000;const a=createCaptureActivity({staleMs:100,settleMs:10,now:()=>t});assert.equal(a.remaining(),0);
 a.open('camera');a.open('mic');assert.equal(a.remaining(),100);t+=60;a.open('mic');assert.equal(a.remaining(),40,'the oldest lease bounds the wait');
 a.close('camera');assert.equal(a.remaining(),100);a.close('mic');assert.equal(a.remaining(),10);t+=10;assert.equal(a.remaining(),0);a.close('unknown');assert.equal(a.remaining(),0);
 a.open('crashed');t+=100;assert.equal(a.remaining(),10,'a lease without chunk activity expires');t+=10;assert.equal(a.remaining(),0);
});
test('idle waits for the last capture to end, changed wakes on capture activity, and both are abortable',async()=>{
 const a=createCaptureActivity({staleMs:5000,settleMs:20});await a.idle();a.open('screen');let resolved=false;const waiting=a.idle().then(()=>{resolved=true;});
 await new Promise(r=>setTimeout(r,30));assert.equal(resolved,false);const began=Date.now();a.close('screen');await waiting;assert.ok(Date.now()-began>=15,'settles after close');
 a.open('again');const abort=new AbortController(),pending=a.idle(abort.signal);abort.abort();await assert.rejects(pending,/abort/i);
 const next=a.changed();a.open('another');await next;const quit=new AbortController(),change=a.changed(quit.signal);quit.abort();await assert.rejects(change,/abort/i);
});
