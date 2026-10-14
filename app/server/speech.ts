import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {constants} from 'node:fs';
import type {AISettings, Caption} from '../shared/types.js';
import {captionsFromWords} from './ai.js';
import * as storage from './storage.js';

export const SPEECH_MODEL='eleven_flash_v2_5';
export interface CharacterAlignment {characters:string[];character_start_times_seconds:number[];character_end_times_seconds:number[]}
export interface ListedVoice {id:string;name:string;category:string}

async function executable(name:string){
 for(const entry of (process.env.PATH??'').split(path.delimiter).map(dir=>path.join(dir,name)))try{await access(entry,constants.X_OK);return entry;}catch{}
 throw new Error('FFmpeg is required to prepare a voice sample.');
}
function run(command:string,args:string[]){
 return new Promise<void>((resolve,reject)=>{let stderr='';const child=spawn(command,args,{stdio:['ignore','ignore','pipe']});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Preparing the voice sample timed out.'));},10*60*1000);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1200);});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`ffmpeg failed (${code}): ${stderr}`));});
 });
}
function eleven(settings:AISettings){
 if(settings.provider!=='elevenlabs'||!settings.apiKey)throw new Error('Save an ElevenLabs API key in Settings → AI & transcription before cloning a voice or generating speech.');
 let base=settings.baseUrl?.trim()||'https://api.elevenlabs.io/v1';
 if(/^https:\/\/api\.openai\.com\/v1\/?$/.test(base))base='https://api.elevenlabs.io/v1';
 const url=new URL(base.replace(/\/$/,''));
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Provider URL must use HTTPS or local HTTP.');
 return {key:settings.apiKey,base:url.href.replace(/\/$/,'')};
}
async function failure(response:Response,label:string){
 const detail=(await response.text().catch(()=>'')).replace(/sk_[A-Za-z0-9]+/g,'[key]').slice(0,180);
 throw new Error(`${label} returned HTTP ${response.status}.${detail?` ${detail}`:''}`);
}
/** Group character timings into spoken words. Spacing and empty tokens break words. */
export function wordsFromAlignment(alignment?:CharacterAlignment|null){
 if(!alignment?.characters?.length)return [];
 const words:{text:string;start:number;end:number}[]=[];let text='',start=0,end=0,open=false;
 for(let i=0;i<alignment.characters.length;i++){
  const ch=String(alignment.characters[i]??''),a=Number(alignment.character_start_times_seconds?.[i]),b=Number(alignment.character_end_times_seconds?.[i]);
  if(!ch.trim()){if(open&&text.trim())words.push({text:text.trim(),start,end:Math.max(end,start+.02)});text='';open=false;continue;}
  if(!open){start=Number.isFinite(a)?a:end;text=ch;open=true;}else text+=ch;
  if(Number.isFinite(b))end=Math.max(end,b);
 }
 if(open&&text.trim())words.push({text:text.trim(),start,end:Math.max(end,start+.02)});
 return words.filter(word=>word.text&&word.end>word.start);
}
export async function listVoices(settings:AISettings):Promise<ListedVoice[]>{
 const {key,base}=eleven(settings);
 const response=await fetch(`${base}/voices`,{headers:{'xi-api-key':key},signal:AbortSignal.timeout(30_000)});
 if(!response.ok)await failure(response,'ElevenLabs voice list');
 const data=await response.json() as {voices?:Array<{voice_id?:string;name?:string;category?:string}>};
 return (data.voices??[]).flatMap(voice=>voice.voice_id&&voice.name?[{id:voice.voice_id,name:voice.name,category:voice.category||''}]:[]);
}
export async function extractVoiceSample(input:string,output:string){
 const ffmpeg=await executable('ffmpeg');await mkdir(path.dirname(output),{recursive:true});
 await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-t','60','-vn','-ac','1','-ar','44100','-c:a','aac','-b:a','96k',output]);
}
export async function cloneVoice(settings:AISettings,name:string,samplePath:string){
 const trimmed=name.trim();if(!trimmed||trimmed.length>80)throw new Error('Enter a voice name up to 80 characters.');
 const {key,base}=eleven(settings);const bytes=await readFile(samplePath);
 if(bytes.byteLength<1000)throw new Error('The voice sample is too short. Record or choose at least a second of speech.');
 if(bytes.byteLength>25_000_000)throw new Error('Voice samples must be 25 MB or smaller.');
 const form=new FormData();form.append('name',trimmed);form.append('description','SceneForge instant voice clone');form.append('files',new Blob([bytes]),path.basename(samplePath)||'sample.m4a');
 const response=await fetch(`${base}/voices/add`,{method:'POST',headers:{'xi-api-key':key},body:form,signal:AbortSignal.timeout(120_000)});
 if(!response.ok)await failure(response,'ElevenLabs voice clone');
 const data=await response.json() as {voice_id?:string};if(!data.voice_id)throw new Error('ElevenLabs did not return a voice ID.');
 await storage.saveAISettings({voiceId:data.voice_id,voiceName:trimmed});
 return {voiceId:data.voice_id,voiceName:trimmed};
}
export async function synthesizeSpeech(settings:AISettings,text:string,voiceId:string|undefined,output:string):Promise<{captions:Caption[]}>{
 const spoken=text.replace(/\s+/g,' ').trim();
 if(!spoken)throw new Error('Enter the line you want spoken.');
 if(spoken.length>4000)throw new Error('Generated lines are limited to 4,000 characters.');
 const id=(voiceId||settings.voiceId||'').trim();if(!id)throw new Error('Clone your voice or paste a voice ID before generating speech.');
 const {key,base}=eleven(settings);
 const response=await fetch(`${base}/text-to-speech/${encodeURIComponent(id)}/with-timestamps?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({text:spoken,model_id:SPEECH_MODEL}),signal:AbortSignal.timeout(120_000)});
 if(!response.ok)await failure(response,'ElevenLabs speech');
 const data=await response.json() as {audio_base64?:string;alignment?:CharacterAlignment};
 if(!data.audio_base64)throw new Error('ElevenLabs returned no audio.');
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,Buffer.from(data.audio_base64,'base64'));
 const words=wordsFromAlignment(data.alignment);
 return {captions:words.length?captionsFromWords(words,12):[]};
}
