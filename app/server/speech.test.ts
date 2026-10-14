import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {wordsFromAlignment,SPEECH_MODEL,synthesizeSpeech} from './speech.js';

test('character alignment becomes spoken words',()=>{
 const words=wordsFromAlignment({characters:['H','i',' ','t','h','e','r','e'],character_start_times_seconds:[0,.1,.2,.3,.4,.5,.6,.7],character_end_times_seconds:[.1,.2,.25,.4,.5,.6,.7,.9]});
 assert.deepEqual(words,[{text:'Hi',start:0,end:.2},{text:'there',start:.3,end:.9}]);
});

test('speech synthesis writes audio and does not echo the key',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sceneforge-speech-')),output=path.join(dir,'line.mp3'),original=globalThis.fetch;
 try{
  globalThis.fetch=async(input,init)=>{
   assert.match(String(input),/\/text-to-speech\/voice123\/with-timestamps/);
   assert.equal((init?.headers as Record<string,string>)['xi-api-key'],'test-key');
   const body=JSON.parse(String(init?.body));assert.equal(body.model_id,SPEECH_MODEL);assert.equal(body.text,'Hello there');
   return new Response(JSON.stringify({audio_base64:Buffer.from('audio-bytes').toString('base64'),alignment:{characters:['Hello',' ','there'],character_start_times_seconds:[0,.2,.3],character_end_times_seconds:[.2,.25,1]}}),{status:200});
  };
  const result=await synthesizeSpeech({provider:'elevenlabs',baseUrl:'https://api.elevenlabs.io/v1',model:'scribe_v2',language:'en',apiKey:'test-key',voiceId:'voice123'},'Hello there',undefined,output);
  assert.equal(await readFile(output,'utf8'),'audio-bytes');assert.equal(result.captions[0].text,'Hello there');
  globalThis.fetch=async()=>new Response(JSON.stringify({detail:'bad key sk_testsecretvalue'}),{status:401});
  await assert.rejects(synthesizeSpeech({provider:'elevenlabs',baseUrl:'https://api.elevenlabs.io/v1',model:'scribe_v2',language:'en',apiKey:'test-key',voiceId:'voice123'},'Hello',undefined,output),/\[key\]/);
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});
