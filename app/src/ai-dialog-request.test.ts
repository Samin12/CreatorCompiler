import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from './api';
import {AIDialogRequestScope,preciseAITime} from './ai-dialog-request';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('closing a dialog aborts its actual API signal and discards a late response even if transport ignores abort',async()=>{
 const originalFetch=globalThis.fetch,response=deferred<Response>();let signal:AbortSignal|undefined;const updates:string[]=[];
 globalThis.fetch=async(_url,init)=>{signal=init?.signal as AbortSignal;return response.promise;};
 try{const scope=new AIDialogRequestScope();const pending=scope.run(s=>api<string>('/ai/transcribe',{},'POST',s),{relevant:()=>true,success:v=>updates.push(v),error:()=>updates.push('error'),finish:()=>updates.push('finish')});
  assert.equal(signal?.aborted,false);scope.cancel();assert.equal(signal?.aborted,true);response.resolve(new Response(JSON.stringify('late result')));await pending;assert.deepEqual(updates,[]);
 }finally{globalThis.fetch=originalFetch;}
});
test('project switch discards old transcription and proposal completions without clearing a newer request',async()=>{
 const scope=new AIDialogRequestScope(),old=deferred<string>(),fresh=deferred<string>();let project='old';const updates:string[]=[];
 const callbacks=(id:string)=>({relevant:()=>project===id,success:(v:string)=>updates.push(`${id}:${v}`),error:()=>updates.push(`${id}:error`),finish:()=>updates.push(`${id}:finish`)});
 const first=scope.run(()=>old.promise,callbacks('old'));project='new';const next=scope.run(()=>fresh.promise,callbacks('new'));
 old.resolve('captions');await first;assert.deepEqual(updates,[]);fresh.resolve('proposal');await next;assert.deepEqual(updates,['new:proposal','new:finish']);
});
test('project identity guard discards completion before unmount cleanup can run',async()=>{
 const scope=new AIDialogRequestScope(),response=deferred<string>();let project='old';const updates:string[]=[];
 const pending=scope.run(()=>response.promise,{relevant:()=>project==='old',success:v=>updates.push(v),error:()=>updates.push('error'),finish:()=>updates.push('finish')});project='new';response.resolve('captions');await pending;assert.deepEqual(updates,[]);
});
test('normal success and failure finish once; cancelled rejection does not report an error',async()=>{
 const scope=new AIDialogRequestScope(),updates:string[]=[];const callbacks={relevant:()=>true,success:(v:string)=>updates.push(v),error:(e:unknown)=>updates.push((e as Error).message),finish:()=>updates.push('finish')};
 await scope.run(async()=> 'captions',callbacks);assert.deepEqual(updates,['captions','finish']);updates.length=0;
 await scope.run(async()=>{throw Error('network failure');},callbacks);assert.deepEqual(updates,['network failure','finish']);updates.length=0;
 const response=deferred<string>(),pending=scope.run(()=>response.promise,callbacks);scope.cancel();response.reject(Error('late error'));await pending;assert.deepEqual(updates,[]);
});
test('AI range labels preserve milliseconds including minute rollover',()=>{
 assert.equal(preciseAITime(1),'00:01.000');assert.equal(preciseAITime(1.3),'00:01.300');assert.equal(preciseAITime(59.9996),'01:00.000');assert.equal(preciseAITime(3600.125),'60:00.125');assert.equal(preciseAITime(NaN),'00:00.000');
});
