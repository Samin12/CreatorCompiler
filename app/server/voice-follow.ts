import {mkdir,mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {transcribe} from './ai.js';
import type {AISettings} from '../shared/types.js';

export interface FollowResult {cursor:number;transcript:string;confidence:number}
export const scriptTokens=(text:string)=>text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)??[];
const normalized=(word:string)=>word.normalize('NFKC').toLocaleLowerCase('en').replace(/[’']/g,'');
const hesitation=/^(um+|uh+|erm+|hmm+)$/;
function similarity(a:string,b:string):number{
 if(a===b)return 1;
 if(/\d/.test(a+b)||Math.min(a.length,b.length)<4||Math.abs(a.length-b.length)>1)return 0;
 let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++edits>1)return 0;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++}}
 edits+=(a.length-i)+(b.length-j);return edits<=1?.75:0;
}
type Cell={score:number;matched:number;weight:number;first:number;last:number};
/** Align a bounded speech batch. Cursor is the index of the next script word. */
export function alignSpeech(script:string,transcript:string,cursor:number):FollowResult{
 const tokens=scriptTokens(script).map(normalized);const current=Math.max(0,Math.min(tokens.length,Math.floor(Number.isFinite(cursor)?cursor:0)));
 const spoken=scriptTokens(transcript).map(normalized).filter(w=>!hesitation.test(w)).slice(-40);
 if(spoken.length<2||!tokens.length)return {cursor:current,transcript,confidence:0};
 const from=Math.max(0,current-12),to=Math.min(tokens.length,current+80),window=tokens.slice(from,to);let previous:Cell[]=Array.from({length:window.length+1},(_,i)=>({score:0,matched:0,weight:0,first:from+i,last:from+i}));
 for(let i=1;i<=spoken.length;i++){
  const row:Cell[]=[{...previous[0],score:-.9*i}];
  for(let j=1;j<=window.length;j++){
   const sim=similarity(spoken[i-1],window[j-1]);const prev=previous[j-1];
   const diagonal:Cell={score:prev.score+(sim?2*sim:-1.5),matched:prev.matched+(sim?1:0),weight:prev.weight+sim,first:sim&&!prev.matched?from+j-1:prev.first,last:sim?from+j:prev.last};
   const insertion:Cell={...previous[j],score:previous[j].score-.9};const deletion:Cell={...row[j-1],score:row[j-1].score-.8};
   row[j]=[diagonal,insertion,deletion].sort((a,b)=>b.score-a.score||Math.abs(a.first-current)-Math.abs(b.first-current))[0];
  }previous=row;
 }
 let best:Cell|undefined;let bestRank=-Infinity;
 for(const cell of previous){
  const confidence=cell.weight/spoken.length;if(cell.matched<2||confidence<.6)continue;
  // A weak partial match is not enough to skip ahead or rewind into a repeated passage.
  if(Math.abs(cell.first-current)>18&&confidence<.8)continue;
  const rank=cell.score-.055*Math.abs(cell.first-current)-.04*Math.max(0,current-cell.last);
  if(rank>bestRank){best=cell;bestRank=rank}
 }
 if(!best)return {cursor:current,transcript,confidence:0};
 return {cursor:Math.max(from,Math.min(to,best.last)),transcript,confidence:Math.round(Math.min(1,best.weight/spoken.length)*1000)/1000};
}

export function inspectVoiceWav(wav:Buffer):{duration:number;sampleRate:number}{
 if(wav.length<44||wav.length>350_000||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('Voice following requires a PCM WAV batch up to 10 seconds.');
 let offset=12;let format:number|undefined,channels=0,sampleRate=0,bits=0,dataBytes=0;
 while(offset+8<=wav.length){const tag=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4);if(offset+8+length>wav.length)throw new Error('Voice WAV chunk is truncated.');
  if(tag==='fmt '&&length>=16){format=wav.readUInt16LE(offset+8);channels=wav.readUInt16LE(offset+10);sampleRate=wav.readUInt32LE(offset+12);bits=wav.readUInt16LE(offset+22)}
  if(tag==='data')dataBytes+=length;offset+=8+length+(length%2);
 }
 if(format!==1||channels!==1||sampleRate!==16000||bits!==16||!dataBytes)throw new Error('Voice following expects mono 16 kHz PCM16 WAV audio.');
 const duration=dataBytes/32000;if(duration>.0&&duration<=10)return {duration,sampleRate};throw new Error('Voice batch duration must be greater than zero and at most 10 seconds.');
}
let inFlight=false;
/** One local inference at a time. Never uploads audio even if cloud transcription is selected. */
export async function followSpeech(wav:Buffer,script:string,cursor:number,settings:AISettings,workDir:string):Promise<FollowResult>{
 const {duration}=inspectVoiceWav(wav);if(script.length>500_000)throw new Error('The teleprompter script is too large.');if(inFlight)throw new Error('Voice following is busy. Wait for the current batch before sending another.');
 inFlight=true;let folder:string|undefined;
 try{
  const defaultModel=process.env.SCENEFORGE_WHISPER_MODEL||path.join(os.homedir(),'Library','Application Support','SceneForge','studio','models','ggml-base.en.bin');
  const model=settings.provider==='local'&&settings.model?.trim()?settings.model:defaultModel;
  try{if(!(await stat(model)).isFile())throw new Error()}catch{throw new Error('Voice following needs an independent local Whisper model. Set the local model path or SCENEFORGE_WHISPER_MODEL.')}
  await mkdir(workDir,{recursive:true});folder=await mkdtemp(path.join(workDir,'voice-follow-'));const file=path.join(folder,'batch.wav');await writeFile(file,wav,{mode:0o600});
  const result=await transcribe({id:'voice-batch',name:'Local voice batch',path:file,kind:'audio',duration,width:0,height:0,hasAudio:true},{...settings,provider:'local',apiKey:undefined,baseUrl:'',model,localCommand:settings.provider==='local'?settings.localCommand:undefined},folder);
  const transcript=result.captions.map(c=>c.text).join(' ').trim();return alignSpeech(script,transcript,cursor);
 }finally{if(folder)await rm(folder,{recursive:true,force:true});inFlight=false}
}
