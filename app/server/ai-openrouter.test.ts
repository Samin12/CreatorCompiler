import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {transcribe,providerUrl,describeProviderFailure,OPENROUTER_STT_MODEL} from './ai.js';
import type {AISettings} from '../shared/types.js';

const settings=(over:Partial<AISettings>={}):AISettings=>({provider:'openrouter',baseUrl:'',model:'',language:'auto',apiKey:'sk-or-test-key',...over});

/** Runs transcribe() against a stand-in network: nothing leaves the machine and no real key is used. */
async function withFakeProvider<T>(reply:(request:{url:string;headers:Record<string,string>;form:FormData})=>Response,run:(seen:Array<{url:string;headers:Record<string,string>;form:FormData}>)=>Promise<T>){
 const real=globalThis.fetch,seen:Array<{url:string;headers:Record<string,string>;form:FormData}>=[];
 globalThis.fetch=(async(input:any,init:any)=>{const request={url:String(input),headers:init.headers as Record<string,string>,form:init.body as FormData};seen.push(request);return reply(request);}) as typeof fetch;
 try{return await run(seen);}finally{globalThis.fetch=real;}
}
async function tone(){
 const dir=await mkdtemp(path.join(tmpdir(),'sceneforge-openrouter-')),file=path.join(dir,'tone.wav');
 await promisify(execFile)(process.env.SCENEFORGE_FFMPEG||'ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1',file]);
 await writeFile(path.join(dir,'.keep'),'');
 return {dir,media:{id:'tone',name:'tone',path:file,kind:'audio' as const,duration:1,width:0,height:0}};
}

test('OpenRouter is a preset endpoint: empty or another preset\'s URL resolves to OpenRouter, a custom URL is kept',()=>{
 assert.equal(providerUrl(settings(),'/audio/transcriptions'),'https://openrouter.ai/api/v1/audio/transcriptions');
 assert.equal(providerUrl(settings({baseUrl:'https://api.openai.com/v1'}),'/audio/transcriptions'),'https://openrouter.ai/api/v1/audio/transcriptions');
 assert.equal(providerUrl(settings({baseUrl:'https://openrouter.ai/api/v1/'}),'/audio/transcriptions'),'https://openrouter.ai/api/v1/audio/transcriptions');
 assert.equal(providerUrl(settings({baseUrl:'https://gateway.example.com/v1'}),'/audio/transcriptions'),'https://gateway.example.com/v1/audio/transcriptions');
 assert.equal(providerUrl(settings({provider:'openai',baseUrl:'https://openrouter.ai/api/v1'}),'/audio/transcriptions'),'https://api.openai.com/v1/audio/transcriptions');
 assert.equal(providerUrl(settings({provider:'openai-compatible',baseUrl:'https://openrouter.ai/api/v1'}),'/audio/transcriptions'),'https://openrouter.ai/api/v1/audio/transcriptions');
 assert.throws(()=>providerUrl(settings({baseUrl:'http://openrouter.example.com/v1'}),'/x'),/HTTPS/);
});

test('OpenRouter transcription sends the key, the default Gemini model and word plus segment timestamps, and returns word-timed captions',async()=>{
 const {dir,media}=await tone();
 try{
  const result=await withFakeProvider(()=>Response.json({text:'hello world',words:[{word:'hello',start:.1,end:.4},{word:'world',start:.5,end:.9}],segments:[{start:.1,end:.9,text:'hello world'}]}),async seen=>{
   const out=await transcribe(media,settings(),dir);
   assert.equal(seen.length,1);
   assert.equal(seen[0].url,'https://openrouter.ai/api/v1/audio/transcriptions');
   assert.equal(seen[0].headers.Authorization,'Bearer sk-or-test-key');
   assert.equal(seen[0].form.get('model'),OPENROUTER_STT_MODEL);
   assert.equal(OPENROUTER_STT_MODEL,'google/gemini-3.5-transcribe');
   assert.equal(seen[0].form.get('response_format'),'verbose_json');
   assert.deepEqual(seen[0].form.getAll('timestamp_granularities[]'),['segment','word']);
   assert.equal(seen[0].form.has('language'),false,'auto language is left to the provider');
   assert.ok(seen[0].form.get('file') instanceof Blob);
   return out;
  });
  assert.equal(result.provider,'openrouter');
  assert.equal(result.captions[0].text,'hello world');
  assert.deepEqual(result.captions[0].words?.map(w=>w.text),['hello','world']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a chosen model and language are passed through, and other providers keep their one word-timestamp request',async()=>{
 const {dir,media}=await tone();
 try{
  await withFakeProvider(()=>Response.json({segments:[{start:0,end:1,text:'hola'}]}),async seen=>{
   const out=await transcribe(media,settings({model:'openai/whisper-large-v3',language:'es'}),dir);
   assert.equal(seen[0].form.get('model'),'openai/whisper-large-v3');
   assert.equal(seen[0].form.get('language'),'es');
   assert.equal(out.captions[0].text,'hola','a model that only returns segments still produces a timed transcript');
   await transcribe(media,settings({provider:'openai',model:''}),dir);
   assert.equal(seen[1].url,'https://api.openai.com/v1/audio/transcriptions');
   assert.equal(seen[1].form.get('model'),'whisper-1');
   assert.deepEqual(seen[1].form.getAll('timestamp_granularities[]'),['word']);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a plain-text reply without timing is refused with guidance rather than saved as untimed captions',async()=>{
 const {dir,media}=await tone();
 try{
  await withFakeProvider(()=>Response.json({text:'hello world',usage:{cost:.0005}}),async()=>{
   await assert.rejects(transcribe(media,settings(),dir),/no timed transcript/);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('OpenRouter needs a key before anything is uploaded',async()=>{
 const {dir,media}=await tone();
 try{
  await withFakeProvider(()=>Response.json({}),async seen=>{
   await assert.rejects(transcribe(media,settings({apiKey:undefined}),dir),/API key/);
   assert.equal(seen.length,0,'no request is made without a key');
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('OpenRouter failures name the problem and never echo the key; other providers keep the generic text',()=>{
 assert.match(describeProviderFailure('openrouter',401,'{}'),/rejected the API key/);
 assert.match(describeProviderFailure('openrouter',402,'{}'),/no credits/);
 assert.match(describeProviderFailure('openrouter',429,'{}'),/rate limiting/);
 const bad=describeProviderFailure('openrouter',400,JSON.stringify({error:{message:'verbose_json is not supported for this model'}}));
 assert.match(bad,/verbose_json is not supported/);assert.match(bad,/openai\/whisper-large-v3/);
 assert.doesNotMatch(describeProviderFailure('openrouter',500,'<html>secret sk-or-test-key</html>'),/sk-or-test-key|<html>/);
 assert.equal(describeProviderFailure('openai',400,'{"error":{"message":"x"}}'),'Transcription provider returned HTTP 400. Check the API key, transcription model, and provider limits.');
 assert.ok(describeProviderFailure('openrouter',400,JSON.stringify({error:{message:'x'.repeat(2000)}})).length<500);
});
