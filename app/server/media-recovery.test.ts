import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createProject,defaultEffects,defaultTransform,type Media,type Project} from '../shared/types.js';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sceneforge-media-recovery-'));
process.env.SCENEFORGE_DATA_DIR=path.join(dir,'data');
const storage=await import('./storage.js');
const media=await import('./media.js');
const recovery=await import('./media-recovery.js');
const ffmpeg=process.env.SCENEFORGE_FFMPEG||'ffmpeg';
const ffprobe=process.env.SCENEFORGE_FFPROBE||'ffprobe';
const files={video:path.join(dir,'video.mp4'),silent:path.join(dir,'silent.mp4'),wide:path.join(dir,'wide.mp4'),slow:path.join(dir,'slow.mp4'),short:path.join(dir,'short.mp4'),audio:path.join(dir,'audio.wav'),image:path.join(dir,'image.png')};
let source:Media,image:Media;
function run(args:string[]){const result=spawnSync(ffmpeg,['-v','error','-nostdin','-y',...args],{maxBuffer:64*1024*1024});assert.equal(result.status,0,result.stderr.toString());return result.stdout;}
before(async()=>{
 await storage.initStorage();
 for(const [file,width,fps,duration,audio] of [[files.video,320,30,4,true],[files.silent,320,30,4,false],[files.wide,640,30,4,true],[files.slow,320,24,4,true],[files.short,320,30,3,true]] as const){
  run(['-f','lavfi','-i',`testsrc2=size=${width}x180:rate=${fps}:duration=${duration}`,...audio?['-f','lavfi','-i',`sine=frequency=440:sample_rate=48000:duration=${duration}`]:[], '-c:v','libx264','-preset','ultrafast','-threads','2',...audio?['-c:a','aac']:[],file]);
 }
 run(['-f','lavfi','-i','sine=frequency=330:sample_rate=48000:duration=4','-c:a','pcm_s16le',files.audio]);
 run(['-f','lavfi','-i','color=blue:size=320x180','-frames:v','1','-threads','1',files.image]);
 source=await media.probeMedia(files.video,storage.CACHE_DIR);image=await media.probeMedia(files.image,storage.CACHE_DIR);
});
after(()=>fs.rm(dir,{recursive:true,force:true}));
async function project(overrides:Partial<Media>={}):Promise<Project>{
 const m={...source,id:randomUUID(),path:path.join(dir,randomUUID()+'.missing.mp4'),audioRole:'microphone' as const,...overrides};
 await storage.registerMedia(m);const p=createProject('Recovery fixture');p.media=[m];p.canvas={width:320,height:180,fps:30,background:'#171b27',padding:0,radius:0};p.scenes[0].duration=2;
 p.clips=[{id:randomUUID(),mediaId:m.id,name:'Preserved clip',track:'screen',start:0,sourceIn:.5,sourceOut:2.5,speed:1,gain:.7,muted:false,transform:defaultTransform(),effects:{...defaultEffects(),normalize:true,fadeIn:.2,fadeOut:.3},effectTiming:{sourceIn:0,sourceOut:3.8},audioRole:'microphone'}];
 return storage.saveProject(p);
}
async function render(p:Project){const job=media.startExport(p,{format:'mp4',width:320,height:180,fps:30,quality:'draft',burnCaptions:false},path.join(dir,'renders'));const start=Date.now();while(Date.now()-start<60000){const current=media.getJob(job.id)!;if(current.status==='complete')return current.outputPath!;if(current.status==='failed'||current.status==='cancelled')throw Error(current.error||current.message);await new Promise(r=>setTimeout(r,30));}throw Error('Export timed out');}
const withoutUpdated=(p:Project)=>({...p,updatedAt:''});

test('aggregate inspection reports all missing paths and includes original effect-tail requirements',async()=>{
 const p=await project();p.media.push({...image,id:randomUUID(),path:dir,name:'Not a file'});p.media.push({...image,id:randomUUID(),name:'Available'});const saved=await storage.saveProject(p);const info=await recovery.inspectMedia(p.id);
 assert.equal(info.revision,storage.revision(saved));assert.equal(info.items.length,3);assert.equal(info.missingCount,2);
 assert.equal(info.items[0].status,'missing');assert.equal(info.items[0].requiredSourceEnd,3.8);assert.deepEqual(info.items[0].clipIds,[p.clips[0].id]);assert.equal(info.items[1].status,'not-file');assert.equal(info.items[2].status,'available');
 assert.equal(info.items[0].catalogStatus,'ok');assert.equal(info.items[2].catalogStatus,'missing');assert.equal(info.attentionCount,3);
});
test('catalog mismatch, absence and invalid records are separate from an available project file and repair stays local',async()=>{
 const p=await project({path:source.path}),m=p.media[0],duplicate=await storage.duplicateProject(p.id);
 await storage.registerMedia({...m,path:files.silent});const catalogFile=path.join(storage.DATA_DIR,'catalog',m.id+'.json');const priorCatalog=await fs.readFile(catalogFile,'utf8');
 const info=await recovery.inspectMedia(p.id);assert.equal(info.items[0].status,'available');assert.equal(info.items[0].catalogStatus,'mismatch');assert.equal(info.missingCount,0);assert.equal(info.attentionCount,1);
 const plan=await recovery.planRelink(p.id,m.id,m.path,info.revision);const fixed=await recovery.applyRelink(p.id,plan.id,plan.revision);assert.notEqual(fixed.newMediaId,m.id);assert.equal((await recovery.inspectMedia(p.id)).attentionCount,0);
 assert.equal(await fs.readFile(catalogFile,'utf8'),priorCatalog);assert.deepEqual(await storage.readProject(duplicate.id),duplicate);
 await fs.rm(catalogFile);assert.equal((await recovery.inspectMedia(duplicate.id)).items[0].catalogStatus,'missing');
 await fs.writeFile(catalogFile,'broken json');const invalid=await recovery.inspectMedia(duplicate.id);assert.equal(invalid.items[0].status,'available');assert.equal(invalid.items[0].catalogStatus,'invalid');assert.equal(invalid.attentionCount,1);
});
test('real relocated AV preserves decoded output, clip effects, duplicate project and historical catalog', {timeout:90000},async()=>{
 const original=path.join(dir,'original-take.mp4'),replacement=path.join(dir,'moved-take.mp4');await fs.copyFile(files.video,original);
 const p=await project({path:original}),oldMedia=p.media[0],duplicate=await storage.duplicateProject(p.id);const oldCatalog=await fs.readFile(path.join(storage.DATA_DIR,'catalog',oldMedia.id+'.json'),'utf8');
 const outputBefore=await render(p);await fs.rename(original,replacement);
 const plan=await recovery.planRelink(p.id,oldMedia.id,replacement,storage.revision(p));assert.equal(plan.compatible,true,plan.blockers.join(';'));assert.equal(plan.requiredSourceEnd,3.8);assert.equal(plan.fingerprint.sha256,createHash('sha256').update(await fs.readFile(replacement)).digest('hex'));
 const result=await recovery.applyRelink(p.id,plan.id,plan.revision);assert.notEqual(result.newMediaId,oldMedia.id);assert.match(result.newMediaId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(result.project.clips,p.clips.map(c=>({...c,mediaId:result.newMediaId})));assert.equal(result.project.media[0].audioRole,'microphone');assert.equal(result.project.media[0].name,oldMedia.name);
 assert.deepEqual(await storage.readProject(duplicate.id),duplicate);assert.equal(await fs.readFile(path.join(storage.DATA_DIR,'catalog',oldMedia.id+'.json'),'utf8'),oldCatalog);
 const history=await storage.history(p.id);const checkpoint=JSON.parse(await fs.readFile(path.join(storage.DATA_DIR,'history',p.id,history[0].id+'.json'),'utf8'));assert.deepEqual(checkpoint,p);
 const outputAfter=await render(result.project);
 assert.deepEqual(run(['-i',outputAfter,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1']),run(['-i',outputBefore,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1']),'every decoded video pixel must be unchanged');
 assert.deepEqual(run(['-i',outputAfter,'-vn','-f','f32le','-ac','2','-ar','48000','pipe:1']),run(['-i',outputBefore,'-vn','-f','f32le','-ac','2','-ar','48000','pipe:1']),'every decoded audio sample must be unchanged');
 const undone=await recovery.undoRelink(p.id,plan.id,result.revision);assert.deepEqual(withoutUpdated(undone.project),withoutUpdated(p));assert.equal((await storage.readMedia(result.newMediaId)).path,await fs.realpath(replacement),'new catalog remains valid for the later checkpoint');
});
test('review rejects wrong kind, missing audio, geometry, fps, and short effect tail',async()=>{
 const p=await project();
 assert.ok((await media.probeMedia(files.short,storage.CACHE_DIR)).duration>p.clips[0].sourceOut,'short candidate covers visible clip but not original effect tail');
 for(const [candidate,message] of [[files.audio,/Expected video/],[files.silent,/contains audio/],[files.wide,/320×180/],[files.slow,/fps/],[files.short,/3\.800000/]] as const){const plan=await recovery.planRelink(p.id,p.media[0].id,candidate,storage.revision(p));assert.equal(plan.compatible,false);assert.match(plan.blockers.join(' '),message);await assert.rejects(recovery.applyRelink(p.id,plan.id,plan.revision),/incompatible/);}
 const corrupt=path.join(dir,'corrupt.mp4');await fs.writeFile(corrupt,'not a video');await assert.rejects(recovery.planRelink(p.id,p.media[0].id,corrupt,storage.revision(p)));assert.deepEqual(await storage.readProject(p.id),p);
});
test('probeable containers with damaged late video or opening audio payload cannot be approved',async()=>{
 const p=await project();
 for(const [stream,target,label] of [['v:0',3.65,'late-video'],['a:0',0,'opening-audio']] as const){
  const packetResult=spawnSync(ffprobe,['-v','error','-select_streams',stream,'-show_packets','-show_entries','packet=pts_time,pos,size','-of','json',files.video],{encoding:'utf8'});assert.equal(packetResult.status,0,packetResult.stderr);
  const packets=JSON.parse(packetResult.stdout).packets as Array<{pts_time:string;pos:string;size:string}>;
  const packet=packets.find(packet=>Number(packet.pts_time)>=target)!;assert.ok(packet);
  const bytes=await fs.readFile(files.video);bytes.fill(255,Number(packet.pos),Number(packet.pos)+Number(packet.size));const damaged=path.join(dir,label+'.mp4');await fs.writeFile(damaged,bytes);
  const metadata=await media.probeMedia(damaged,path.join(dir,'damaged-probe'));assert.equal(metadata.kind,'video');assert.equal(metadata.hasAudio,true);assert.equal(metadata.width,source.width);assert.equal(metadata.duration,source.duration);
  await assert.rejects(recovery.planRelink(p.id,p.media[0].id,damaged,storage.revision(p)),(error:Error)=>{assert.match(error.message,/Could not decode/);assert.ok(error.message.length<180,'UI error must not contain raw decoder diagnostics');return true;});
 }
 assert.deepEqual(await storage.readProject(p.id),p);
});
test('shorter but valid audio does not fail the used-end video check',async()=>{
 const skew=path.join(dir,'audio-ends-early.mp4');run(['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.3','-c:v','libx264','-preset','ultrafast','-threads','2','-c:a','aac',skew]);
 const p=await project();p.clips[0].sourceIn=2;p.clips[0].sourceOut=3.5;const saved=await storage.saveProject(p);
 const plan=await recovery.planRelink(p.id,p.media[0].id,skew,storage.revision(saved));assert.equal(plan.compatible,true);assert.match(plan.warnings.join(' '),/does not verify every frame/);
});
test('unknown original video fps requires explicit acknowledgement rather than guessing',async()=>{
 const p=await project({fps:undefined});const plan=await recovery.planRelink(p.id,p.media[0].id,files.video,storage.revision(p));assert.equal(plan.compatible,true);assert.equal(plan.requiredAcknowledgements[0].id,'original-fps-unknown');
 await assert.rejects(recovery.applyRelink(p.id,plan.id,plan.revision),/Acknowledge/);assert.equal(storage.revision(await storage.readProject(p.id)),storage.revision(p));
 const result=await recovery.applyRelink(p.id,plan.id,plan.revision,['original-fps-unknown']);assert.notEqual(result.newMediaId,p.media[0].id);
});
test('image replacement ignores synthetic five-second duration and remaps selected canvas background only',async()=>{
 const p=await project({...image,id:randomUUID(),path:path.join(dir,'lost-image.png'),audioRole:undefined});p.clips[0].sourceIn=0;p.clips[0].sourceOut=100;p.clips[0].effectTiming={sourceIn:0,sourceOut:200};p.canvas.backgroundMediaId=p.media[0].id;const saved=await storage.saveProject(p),duplicate=await storage.duplicateProject(p.id);
 const plan=await recovery.planRelink(p.id,p.media[0].id,files.image,storage.revision(saved));assert.equal(plan.compatible,true);const result=await recovery.applyRelink(p.id,plan.id,plan.revision);assert.equal(result.project.canvas.backgroundMediaId,result.newMediaId);assert.deepEqual(result.project.clips[0],{...p.clips[0],mediaId:result.newMediaId});assert.deepEqual(await storage.readProject(duplicate.id),duplicate);
});
test('stale project reviews and changes during probing never overwrite the newer edit',async()=>{
 const p=await project(),plan=await recovery.planRelink(p.id,p.media[0].id,files.video,storage.revision(p));const edited=await storage.saveProject({...p,notes:'new work'},{expectedRevision:plan.revision});
 await assert.rejects(recovery.applyRelink(p.id,plan.id,plan.revision),/project changed/);assert.deepEqual(await storage.readProject(p.id),edited);
 const pending=recovery.planRelink(p.id,p.media[0].id,files.video,storage.revision(edited));const newer=await storage.saveProject({...edited,notes:'during probe'},{expectedRevision:storage.revision(edited)});await assert.rejects(pending,/project changed/);assert.deepEqual(await storage.readProject(p.id),newer);
});
test('changed or retargeted candidate is rejected even when the reviewed project is unchanged',async()=>{
 const p=await project(),candidate=path.join(dir,'changing.mp4');await fs.copyFile(files.video,candidate);const plan=await recovery.planRelink(p.id,p.media[0].id,candidate,storage.revision(p));await fs.appendFile(candidate,'changed');await assert.rejects(recovery.applyRelink(p.id,plan.id,plan.revision),/changed/);
 const link=path.join(dir,'chosen-symlink.mp4');await fs.symlink(files.video,link);const linked=await recovery.planRelink(p.id,p.media[0].id,link,storage.revision(p));await fs.unlink(link);await fs.symlink(files.wide,link);await assert.rejects(recovery.applyRelink(p.id,linked.id,linked.revision),/changed/);assert.deepEqual(await storage.readProject(p.id),p);
});
test('competing apply commits only once and later saves block exact-snapshot undo',async()=>{
 const p=await project(),plan=await recovery.planRelink(p.id,p.media[0].id,files.video,storage.revision(p));const results=await Promise.allSettled([recovery.applyRelink(p.id,plan.id,plan.revision),recovery.applyRelink(p.id,plan.id,plan.revision)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const applied=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof recovery.applyRelink>>>).value;const latest=await storage.saveProject({...applied.project,notes:'after relink'},{expectedRevision:applied.revision});await assert.rejects(recovery.undoRelink(p.id,plan.id,applied.revision),/changed/);assert.deepEqual(await storage.readProject(p.id),latest);
});
