import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAutomationEngine} from './automation.js';
import {revision} from './storage.js';
import {createProject,defaultEffects,defaultTransform,type AISettings,type Caption,type Project} from '../shared/types.js';

const MISSING_MODEL='Set the local Whisper GGML model path in AI settings, or SCENEFORGE_WHISPER_MODEL.';
const words:Caption[]=[{id:'c',start:0,end:1,text:'hello there',words:[{text:'hello',start:.1,end:.5},{text:'there',start:.5,end:.9}]}];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/** An engine whose "transcribe" is a stand-in recording which provider each call used. */
async function setup(saved:Partial<AISettings>,transcribe:(settings:AISettings)=>Promise<{captions:Caption[];provider:string}>){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-cloud-fallback-')),file=path.join(dir,'speech.wav');await fs.writeFile(file,'synthetic');
 const p=createProject('Fallback fixture');p.scenes[0].duration=10;
 p.media=[{id:'speech',path:file,name:'Speech',kind:'audio',duration:10,width:0,height:0}];
 p.clips=[{id:'voice',mediaId:'speech',name:'Voice',track:'audio',start:0,sourceIn:0,sourceOut:10,speed:1,gain:1,muted:false,transform:defaultTransform(),effects:defaultEffects()}];
 let project=p,saves=0;const providers:string[]=[];
 const engine=createAutomationEngine({root:path.join(dir,'automation'),cache:path.join(dir,'cache'),read:async()=>structuredClone(project),
  save:async(next:Project,options?:{expectedRevision?:string})=>{if(options?.expectedRevision!==revision(project))throw Object.assign(Error('Conflict'),{status:409});project=structuredClone(next);project.updatedAt=String(++saves);return structuredClone(project);},
  settings:async()=>({provider:'local',baseUrl:'',model:'',language:'auto',...saved}) as AISettings,
  transcribe:async(_media:unknown,settings:AISettings)=>{providers.push(settings.provider);return transcribe(settings);},
  analyze:async()=>({suggestions:[]}),inspect:async()=>[],register:async(m:unknown)=>m,semantic:async()=>({changes:[],operations:[],warnings:[]})} as any);
 return {engine,providers,get project(){return project;},async close(){await engine.shutdown();await fs.rm(dir,{recursive:true,force:true});}};
}
async function finished(engine:ReturnType<typeof createAutomationEngine>,id:string){for(let i=0;i<300;i++){const j=await engine.get(id);if(!['queued','running'].includes(j.status))return j;await delay(10);}throw Error('Job timed out');}
const localMissing=async(settings:AISettings)=>{if(settings.provider==='local')throw new Error(MISSING_MODEL);return {captions:structuredClone(words),provider:settings.provider};};

test('a transcription the person starts falls back to their cloud provider when this Mac has no local engine',async()=>{
 const s=await setup({provider:'openrouter',apiKey:'sk-or-test',model:'google/gemini-3.5-transcribe'},localMissing);
 try{
  const job=await s.engine.queueTranscription(s.project.id,{force:true});
  const done=await finished(s.engine,job!.id);
  assert.equal(done.status,'complete');
  assert.deepEqual(s.providers,['local','openrouter'],'local is always tried first');
  assert.ok(s.project.captions.length>0,'captions from the cloud provider are applied');
 }finally{await s.close();}
});

test('an automatic transcription never leaves the Mac, even with a saved cloud key',async()=>{
 const s=await setup({provider:'openrouter',apiKey:'sk-or-test'},localMissing);
 try{
  const job=await s.engine.queueTranscription(s.project.id,{automatic:true});
  const done=await finished(s.engine,job!.id);
  assert.equal(done.status,'failed');
  assert.deepEqual(s.providers,['local'],'no cloud attempt');
  assert.match(done.error??'',/GGML|WHISPER/i);
 }finally{await s.close();}
});

test('without a saved cloud key there is no fallback, and a failure that is not a missing engine is never retried in the cloud',async()=>{
 const noKey=await setup({provider:'openrouter'},localMissing);
 try{
  const job=await noKey.engine.queueTranscription(noKey.project.id,{force:true});
  assert.equal((await finished(noKey.engine,job!.id)).status,'failed');
  assert.deepEqual(noKey.providers,['local']);
 }finally{await noKey.close();}
 const other=await setup({provider:'openrouter',apiKey:'sk-or-test'},async()=>{throw new Error('The audio could not be decoded.');});
 try{
  const job=await other.engine.queueTranscription(other.project.id,{force:true});
  assert.equal((await finished(other.engine,job!.id)).status,'failed');
  assert.deepEqual(other.providers,['local'],'a decode error is not a reason to upload');
 }finally{await other.close();}
});

test('when the local engine works it is used even if a cloud key is saved',async()=>{
 const s=await setup({provider:'openrouter',apiKey:'sk-or-test'},async settings=>({captions:structuredClone(words),provider:settings.provider}));
 try{
  const job=await s.engine.queueTranscription(s.project.id,{force:true});
  assert.equal((await finished(s.engine,job!.id)).status,'complete');
  assert.deepEqual(s.providers,['local']);
 }finally{await s.close();}
});
