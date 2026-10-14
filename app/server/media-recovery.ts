import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream,constants} from 'node:fs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {Media,Project} from '../shared/types.js';
import type {MediaFingerprint,MediaRecoveryInspection,MediaRecoveryItem,MediaRelinkPlan,MediaRelinkResult} from '../shared/recovery.js';
import * as storage from './storage.js';
import {probeMedia} from './media.js';

const conflict=(message:string)=>Object.assign(Error(message),{status:409});
const unavailable=()=>Object.assign(Error('This relink review expired or the app restarted. Review the replacement again.'),{status:410});
const PLAN_LIFETIME=30*60*1000;
const FFMPEG=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
interface Fingerprint extends MediaFingerprint {statKey:string;}
interface PlanRecord {plan:MediaRelinkPlan;fingerprint:Fingerprint;requestedPath:string;before:Project;state:'review'|'applied'|'undone';busy:boolean;afterRevision?:string;}
const plans=new Map<string,PlanRecord>();
let fingerprintWorkers=0;
const fingerprintWaiters:Array<()=>void>=[];
let decodeWorkers=0;
const decodeWaiters:Array<()=>void>=[];
async function decodeSample(args:string[],description:string,expectedBytes?:number):Promise<void>{
 if(decodeWorkers>=2)await new Promise<void>(resolve=>decodeWaiters.push(resolve));else decodeWorkers++;
 try{await new Promise<void>((resolve,reject)=>{
  const child=spawn(FFMPEG,['-v','error','-nostdin','-xerror','-err_detect','explode','-threads','2',...args],{stdio:['ignore','pipe','pipe']});
  let bytes=0,error='',failure:string|undefined;
  const stop=(message:string)=>{failure??=message;child.kill('SIGKILL');};
  const timer=setTimeout(()=>stop('The decode check exceeded its 15-second limit.'),15000);timer.unref();
  child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)stop('The decode check exceeded its output limit.');});
  child.stderr.on('data',(chunk:Buffer)=>{error=(error+chunk.toString()).slice(-4096);});
  child.on('error',cause=>{clearTimeout(timer);console.warn('Media recovery decode could not start:',cause.message);reject(Error(`Could not verify ${description}. Check that the media tools are available and try again.`));});
  child.on('close',code=>{clearTimeout(timer);if(failure||code!==0||bytes===0||(expectedBytes!==undefined&&bytes!==expectedBytes)){console.warn(`Media recovery failed to decode ${description}:`,failure||error.trim()||'No complete sample was produced.');reject(Error(`Could not decode ${description}. Choose a different copy of this recording.`));}else resolve();});
 });}finally{const next=decodeWaiters.shift();if(next)next();else decodeWorkers--;}
}
async function verifyDecodable(file:string,candidate:Media,p:Project,mediaId:string,requiredEnd:number){
 if(candidate.kind!=='audio'){
  const clips=p.clips.filter(c=>c.mediaId===mediaId),start=Math.min(...clips.map(c=>c.sourceIn),requiredEnd||0);
  const times=candidate.kind==='image'?[0]:[start,Math.max(0,requiredEnd-1/(candidate.fps||30))];
  for(const time of [...new Set(times.map(value=>Math.max(0,value).toFixed(9)))])await decodeSample([
   ...(candidate.kind==='image'?[]:['-ss',time]),'-i',file,'-map','0:v:0','-an','-sn','-dn','-frames:v','1','-vf','scale=64:64','-pix_fmt','rgb24','-threads','2','-f','rawvideo','pipe:1',
  ],candidate.kind==='image'?'the image':`a video frame near source ${Number(time).toFixed(3)}s`,64*64*3);
 }
 // Audio can legitimately end before video. Check its first available samples,
 // not the video's last source time; resetting timestamps permits delayed audio.
 if(candidate.hasAudio)await decodeSample(['-i',file,'-map','0:a:0','-vn','-sn','-dn','-af','asetpts=PTS-STARTPTS,aresample=16000','-t','0.25','-ac','1','-ar','16000','-threads','2','-f','s16le','pipe:1'],'the opening audio samples');
}
async function fingerprint(file:string):Promise<Fingerprint>{
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Choose an absolute local media path.');
 if(fingerprintWorkers>=2)await new Promise<void>(resolve=>fingerprintWaiters.push(resolve));else fingerprintWorkers++;
 try{
  const realPath=await fs.realpath(file),before=await fs.stat(realPath,{bigint:true});
  if(!before.isFile())throw Error('The replacement must be a regular media file.');
  const key=(stat:typeof before)=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
  const digest=createHash('sha256');for await(const bytes of createReadStream(realPath,{highWaterMark:1024*1024}))digest.update(bytes);
  const after=await fs.stat(realPath,{bigint:true});
  if(key(before)!==key(after)||await fs.realpath(file)!==realPath)throw conflict('The replacement changed while being read. Review it again.');
  return {sha256:digest.digest('hex'),size:Number(after.size),realPath,modifiedAt:new Date(Number(after.mtimeMs)).toISOString(),statKey:key(after)};
 }finally{const next=fingerprintWaiters.shift();if(next)next();else fingerprintWorkers--;}
}
function publicFingerprint(value:Fingerprint):MediaFingerprint{const {statKey:_,...result}=value;return result;}
function references(p:Project,m:Media){
 const clips=p.clips.filter(c=>c.mediaId===m.id);
 return {clipIds:clips.map(c=>c.id),requiredSourceEnd:Math.max(0,...clips.map(c=>Math.max(c.sourceOut,c.effectTiming?.sourceOut??0))),usedAsBackground:p.canvas.backgroundMediaId===m.id};
}
export async function inspectMedia(projectId:string):Promise<MediaRecoveryInspection>{
 const p=await storage.readProject(projectId),items:MediaRecoveryItem[]=[];
 // Stat calls are cheap and sequential; a large offline project must not create thousands of concurrent I/O requests.
 for(const m of p.media){
  let status:MediaRecoveryItem['status']='available';
  try{const stat=await fs.stat(m.path);if(!stat.isFile())status='not-file';else await fs.access(m.path,constants.R_OK);}
  catch(error){status=['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code||'')?'missing':'unreadable';}
  let catalogStatus:MediaRecoveryItem['catalogStatus']='ok',catalogPath:string|undefined;
  try{
   const catalog=await storage.readMedia(m.id);
   if(!catalog||catalog.id!==m.id||typeof catalog.path!=='string'||!path.isAbsolute(catalog.path)||!['video','audio','image'].includes(catalog.kind))catalogStatus='invalid';
   else{catalogPath=catalog.path;if(['path','kind','width','height','fps','hasAudio'].some(key=>catalog[key as keyof Media]!==m[key as keyof Media]))catalogStatus='mismatch';}
  }catch(error){catalogStatus=(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'invalid';}
  items.push({mediaId:m.id,name:m.name,path:m.path,kind:m.kind,status,catalogStatus,catalogPath,...references(p,m)});
 }
 return {projectId:p.id,revision:storage.revision(p),items,missingCount:items.filter(item=>item.status!=='available').length,attentionCount:items.filter(item=>item.status!=='available'||item.catalogStatus!=='ok').length};
}
function checkRevision(p:Project,expected:string){if(!expected||storage.revision(p)!==expected)throw conflict('The project changed. Refresh its missing-media list and review the replacement again.');}
function prunePlans(){
 const now=Date.now();
 for(const [id,record] of plans)if(!record.busy&&((record.state==='review'&&Date.parse(record.plan.expiresAt)<now)||(record.state!=='review'&&Date.parse(record.plan.expiresAt)+24*60*60*1000<now)))plans.delete(id);
 if(plans.size>=200)throw Error('Too many active relink reviews. Finish an existing review or restart the app.');
}
export async function planRelink(projectId:string,mediaId:string,replacementPath:string,expectedRevision:string):Promise<MediaRelinkPlan>{
 const before=await storage.readProject(projectId);checkRevision(before,expectedRevision);
 const current=before.media.find(m=>m.id===mediaId);if(!current)throw Error('The selected media is not part of this project.');
 prunePlans();
 const id=randomUUID(),verified=await fingerprint(replacementPath),probeDir=path.join(storage.CACHE_DIR,'relink-review',id);
 let probed:Media;
 try{probed=await probeMedia(verified.realPath,probeDir);}finally{await fs.rm(probeDir,{recursive:true,force:true});}
 const refs=references(before,current),blockers:string[]=[],warnings:string[]=[],requiredAcknowledgements:MediaRelinkPlan['requiredAcknowledgements']=[];
 if(probed.kind!==current.kind)blockers.push(`Expected ${current.kind} media; this file is ${probed.kind}.`);
 const expectedAudio=current.kind==='audio'?true:current.hasAudio;
 if(current.kind!=='image'&&expectedAudio===undefined)blockers.push('The original audio-stream metadata is unknown, so a safe replacement cannot be verified.');
 else if(Boolean(probed.hasAudio)!==Boolean(expectedAudio))blockers.push(expectedAudio?'The original contains audio, but this replacement does not.':'This replacement adds audio that was not present in the original.');
 if(current.kind!=='audio'){
  if(current.width<=0||current.height<=0)blockers.push('The original frame dimensions are unknown.');
  else if(current.width!==probed.width||current.height!==probed.height)blockers.push(`Expected ${current.width}×${current.height} frames; this file is ${probed.width}×${probed.height}.`);
 }
 if(current.kind==='video'){
  if(!probed.fps)blockers.push('The replacement video frame rate could not be determined.');
  else if(!current.fps){const message='Original frame rate unavailable; verify replacement is the same recording.';warnings.push(message);requiredAcknowledgements.push({id:'original-fps-unknown',message});}
  else if(Math.abs(current.fps-probed.fps)>.001)blockers.push(`Expected ${current.fps.toFixed(3)} fps; this file is ${probed.fps.toFixed(3)} fps.`);
 }
 if(current.kind!=='image'&&(!Number.isFinite(probed.duration)||probed.duration+1e-6<refs.requiredSourceEnd))blockers.push(`The replacement must contain source time through ${refs.requiredSourceEnd.toFixed(6)} seconds, including preserved effect intervals.`);
 if(!blockers.length)await verifyDecodable(verified.realPath,probed,before,mediaId,refs.requiredSourceEnd);
 const probeStat=await fs.stat(verified.realPath,{bigint:true});
 if([probeStat.dev,probeStat.ino,probeStat.size,probeStat.mtimeNs,probeStat.ctimeNs].join(':')!==verified.statKey)throw conflict('The replacement changed while being inspected. Review it again.');
 // Recheck after potentially slow probing, decoding and hashing, before returning an actionable review.
 checkRevision(await storage.readProject(projectId),expectedRevision);
 warnings.push('Matching media properties cannot confirm this is the intended take. Check the chosen file before applying.');
 warnings.push('Validation decodes small samples at the first used and near-final source times, plus opening audio. It does not verify every frame or the entire file.');
 if(before.importMetadata?.roundtrip)warnings.push('Relinking changes source identity. Exporting this edited project back to its preserved Borumi copy may be unsupported.');
 const replacement:Media={...probed,id:randomUUID()};delete replacement.thumbnail;delete replacement.proxyPath;delete replacement.waveform;
 const plan:MediaRelinkPlan={id,projectId,revision:expectedRevision,mediaId,current:structuredClone(current),replacement,...refs,fingerprint:publicFingerprint(verified),compatible:blockers.length===0,blockers,warnings,requiredAcknowledgements,expiresAt:new Date(Date.now()+PLAN_LIFETIME).toISOString()};
 plans.set(id,{plan,fingerprint:verified,requestedPath:replacementPath,before:structuredClone(before),state:'review',busy:false});return structuredClone(plan);
}
function getPlan(projectId:string,planId:string){const record=plans.get(planId);if(!record||record.plan.projectId!==projectId)throw unavailable();return record;}
function result(record:PlanRecord,project:Project):MediaRelinkResult{return {planId:record.plan.id,project,revision:storage.revision(project),oldMediaId:record.plan.mediaId,newMediaId:record.plan.replacement.id};}
export async function applyRelink(projectId:string,planId:string,expectedRevision:string,acknowledgements:string[]=[]):Promise<MediaRelinkResult>{
 const record=getPlan(projectId,planId),plan=record.plan;
 if(record.busy||record.state!=='review')throw conflict('This relink review has already been applied or is being processed.');
 if(Date.parse(plan.expiresAt)<Date.now())throw unavailable();
 if(!plan.compatible)throw Error('This replacement is incompatible. Choose a file that satisfies every requirement.');
 if(!Array.isArray(acknowledgements)||!acknowledgements.every(value=>typeof value==='string')||plan.requiredAcknowledgements.some(warning=>!acknowledgements.includes(warning.id)))throw conflict('Acknowledge every required compatibility warning before applying this replacement.');
 if(expectedRevision!==plan.revision)throw conflict('The supplied revision does not match the reviewed replacement.');
 record.busy=true;
 try{
  checkRevision(await storage.readProject(projectId),plan.revision);
  let now:Fingerprint;try{now=await fingerprint(record.requestedPath);}catch{throw conflict('The replacement is unavailable or changed after review. Review it again before relinking.');}
  if(JSON.stringify(now)!==JSON.stringify(record.fingerprint))throw conflict('The replacement file changed after review. Review it again before relinking.');
  const replacement:Media={...structuredClone(plan.replacement),name:plan.current.name};
  if(plan.current.audioRole!==undefined)replacement.audioRole=plan.current.audioRole;
  const next=structuredClone(record.before);next.media=next.media.map(m=>m.id===plan.mediaId?replacement:m);
  next.clips=next.clips.map(c=>c.mediaId===plan.mediaId?{...c,mediaId:replacement.id}:c);
  if(next.canvas.backgroundMediaId===plan.mediaId)next.canvas.backgroundMediaId=replacement.id;
  // Catalog records are immutable by fresh identity: duplicates/history retain the old record.
  // If a later CAS conflicts, an unused fresh catalog entry is harmless and never replaces existing media.
  await storage.registerMedia(replacement);
  const saved=await storage.saveProject(next,{expectedRevision:plan.revision,checkpoint:true});
  record.afterRevision=storage.revision(saved);record.state='applied';return result(record,saved);
 }finally{record.busy=false;}
}
export async function undoRelink(projectId:string,planId:string,expectedRevision:string):Promise<MediaRelinkResult>{
 const record=getPlan(projectId,planId);
 if(record.busy||record.state!=='applied'||!record.afterRevision)throw conflict('This replacement has no active relink to undo.');
 if(expectedRevision!==record.afterRevision)throw conflict('The project changed after relinking. Review version history to recover earlier work.');
 record.busy=true;
 try{const saved=await storage.saveProject(record.before,{expectedRevision:record.afterRevision,checkpoint:true});record.state='undone';return result(record,saved);}
 finally{record.busy=false;}
}
