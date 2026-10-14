import {DatabaseSync} from 'node:sqlite';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readdir,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {clipDuration,type Project,type Clip} from '../shared/types.js';
import {encodeBorumiScript} from './borumi-script.js';
import {readBorumiPreservation,safeBorumiOutputRoot,type BorumiProvenance} from './borumi-provenance.js';
import {planStructuralTimeline,type StructuralTimelinePlan} from './borumi-compat-timeline.js';

type Row=Record<string,any>;
export interface BorumiCompatibilityPlan {supported:boolean;blockers:string[];warnings:string[];changes:Array<{kind:string;id:string;fields:string[]}>;sourceFormat:'preserved-borumi';history:'new-root';}
const same=isDeepStrictEqual;
const fields=(a:Row,b:Row,keys:string[])=>keys.filter(k=>!same(a[k],b[k]));
const without=(v:Row,keys:string[])=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const changed=(a:Row,b:Row,keys:string[])=>!same(without(a,keys),without(b,keys));
const ids=(a:Array<{id:string}>)=>a.map(x=>x.id);
const decode=(text:string)=>JSON.parse(text) as Row;
const sourceKinds=['AudioClip','VideoClip','Music','SoundEffect','Overlay'];

function buildPlan(project:Project,source:BorumiProvenance,structural:StructuralTimelinePlan|null):BorumiCompatibilityPlan {
 const base=source.baseline,blockers=new Set<string>(),warnings=new Set<string>([
  'Exports a separate copy. The original Borumi project is never modified.',
  'The copy starts a new Borumi history. A consistent source database snapshot and its original history are preserved inside .sceneforge/original-project.sqlite.',
  'Unedited native fields and bundle files are retained. SceneForge preview differences do not replace those native settings.'
 ]),changes:BorumiCompatibilityPlan['changes']=[];
 const change=(kind:string,id:string,fs:string[])=>{if(fs.length)changes.push({kind,id,fields:fs})};
 if(structural){for(const reason of structural.blockers)blockers.add(reason);for(const warning of structural.warnings)warnings.add(warning);changes.push(...structural.changes);}
 if(project.version!==1)blockers.add('Unsupported SceneForge project version.');
 if(project.recordedTakes?.length||!same(project.recordedTakes??[],base.recordedTakes??[]))blockers.add('SceneForge recorded-take history cannot be preserved by this Borumi export. Keep the SceneForge project or export a video instead.');
 if(project.name!==base.name)change('project',project.id,['name']);
 if(changed(project.canvas,base.canvas,['width','height']))blockers.add('Canvas changes other than width and height cannot be exported yet.');
 for(const k of ['width','height'] as const)if(!Number.isInteger(project.canvas[k])||project.canvas[k]<1||project.canvas[k]>16384)blockers.add('Canvas dimensions must be integers between 1 and 16384.');
 change('canvas',project.id,fields(project.canvas,base.canvas,['width','height']));
 for(const key of ['captions','captionStyle','zooms','cursor'] as const)if(!same(project[key],(structural?.expected??base)[key]))blockers.add(`Changed ${key} cannot be exported to Borumi yet.`);
 if(!same(ids(project.scenes),ids(base.scenes)))blockers.add('Adding, deleting or reordering scenes cannot be exported yet.');
 for(const scene of project.scenes){const b=base.scenes.find(x=>x.id===scene.id);if(!b)continue;
  if(!structural&&!same([scene.start,scene.duration],[b.start,b.duration]))blockers.add('Scene timing changes cannot be exported yet.');
  change('scene',scene.id,fields(scene,b,['name','script']));
  if(scene.script!==b.script)warnings.add('Edited scene scripts are exported as plain paragraphs; native rich text formatting is replaced.');
  if(scene.notes!==b.notes)warnings.add('Scene notes are SceneForge-only and are not included in Borumi.');
 }
 if(!same([...ids(project.media)].sort(),[...ids(base.media)].sort()))blockers.add('Adding or removing media cannot be exported yet.');
 for(const media of project.media){const b=base.media.find(x=>x.id===media.id);if(b&&fields(media,b,['path','kind','duration','width','height','hasAudio','fps','audioRole']).length)blockers.add('Relinking or changing source media or its audio role cannot be exported yet.');}
 if(!structural&&!same([...ids(project.clips)].sort(),[...ids(base.clips)].sort()))blockers.add('Adding, splitting or removing clips cannot be exported yet.');
 const groups=new Map<string,Clip[]>();
 for(const b of base.clips){const m=source.mapping.clips[b.id];if(m){const g=groups.get(m.segmentId)??[];g.push(b);groups.set(m.segmentId,g);}}
 for(const clip of structural?[]:project.clips){const b=base.clips.find(x=>x.id===clip.id);if(!b)continue;const m=source.mapping.clips[clip.id];
  if(clip.name!==b.name)warnings.add('Clip display names are SceneForge-only; source media names are preserved.');
  if(!m){if(changed(clip,b,['name']))blockers.add('A generated background or unsupported native clip was changed.');continue;}
  if(changed(clip,b,['name','gain','muted','start','sourceIn','sourceOut','speed','effects']))blockers.add('Clip track, source, transform or layer changes cannot be exported yet.');
  if(changed(clip.effects,b.effects,['flipX']))blockers.add('Clip effect changes other than horizontal flip cannot be exported yet.');
  if(clip.muted!==b.muted)blockers.add('Changed mute state cannot be encoded exactly yet; it is not approximated as a low volume.');
  const gainChanged=clip.gain!==b.gain,flipChanged=clip.effects.flipX!==b.effects.flipX;
  if(gainChanged&&(m.kind==='VideoClip'||m.kind==='Overlay'))blockers.add('Gain changes on native visual-only clips cannot be exported yet.');
  if(gainChanged&&(!Number.isFinite(clip.gain)||clip.gain<=0||clip.gain>100))blockers.add('Exported gain must be greater than zero and at most 100.');
  if(flipChanged&&m.kind!=='VideoClip')blockers.add('Horizontal flip is supported only for native video clips.');
  const timing=fields(clip,b,['start','sourceIn','sourceOut','speed']);
  if(timing.length){
   if((groups.get(m.segmentId)?.length??0)>1)blockers.add('Timing edits to a clip divided by imported layout boundaries cannot be exported yet.');
   if(!sourceKinds.includes(m.kind))blockers.add(`Timing edits to native ${m.kind} cannot be exported yet.`);
   if(!['AudioClip','VideoClip'].includes(m.kind)&&clip.speed!==b.speed)blockers.add('Speed changes on overlays/music cannot be exported yet.');
   const scene=base.scenes.find(s=>source.mapping.scenes[s.id]===m.sceneId),media=base.media.find(v=>v.id===clip.mediaId);
   if(![clip.start,clip.sourceIn,clip.sourceOut,clip.speed].every(Number.isFinite)||clip.speed<.05||clip.speed>16||clip.sourceIn<0||clip.sourceOut<=clip.sourceIn||!scene||clip.start<scene.start-1e-7||clip.start+clipDuration(clip)>scene.start+scene.duration+1e-7||media&&media.kind!=='image'&&clip.sourceOut>media.duration+1e-5)blockers.add('A clip edit exceeds its source media or original scene bounds.');
  }
  change('clip',clip.id,[...timing,...(gainChanged?['gain']:[]),...(flipChanged?['flipX']:[])]);
 }
 for(const group of structural?[]:groups.values()){
  const active=group.map(b=>project.clips.find(c=>c.id===b.id)).filter((c):c is Clip=>!!c);
  for(const field of ['gain','flipX'] as const){const value=(c:Clip)=>field==='gain'?c.gain:c.effects.flipX;
   if(active.length&&active.some((c,i)=>value(c)!==value(group[i]))&&active.some(c=>value(c)!==value(active[0])))blockers.add('All pieces of the same imported native segment must share exported gain and flip.');
  }
 }
 for(const scene of structural?[]:base.scenes){const relevant=project.clips.filter(c=>{const m=source.mapping.clips[c.id];return m?.sceneId===source.mapping.scenes[scene.id]&&['AudioClip','VideoClip'].includes(m.kind)});const timingChanged=relevant.some(c=>{const b=base.clips.find(x=>x.id===c.id);return b&&fields(c,b,['start','sourceIn','sourceOut','speed']).length>0});if(timingChanged&&Math.abs(Math.max(scene.start,...relevant.map(c=>c.start+clipDuration(c)))-(scene.start+scene.duration))>1e-6)blockers.add('This trim changes the native scene duration; cross-scene timing changes cannot be exported yet.');}
 if(!same([...ids(project.elements)].sort(),[...ids(base.elements)].sort()))blockers.add('Adding or removing annotations cannot be exported yet.');
 for(const e of project.elements){const b=base.elements.find(x=>x.id===e.id);if(!b)continue;
  if(!source.mapping.elements[e.id]){if(!same(e,b))blockers.add('An unsupported native annotation was changed.');continue;}
  const map=source.mapping.elements[e.id],scene=base.scenes.find(s=>source.mapping.scenes[s.id]===map.sceneId),targetScene=project.scenes.find(s=>s.id===scene?.id);
  const nativeElement={...e,start:e.start-(structural&&scene&&targetScene?targetScene.start-scene.start:0)};
  if(same(nativeElement,b))continue;
  if(e.text!==b.text&&source.mapping.elements[e.id].plainText!==true)blockers.add('Rich native text cannot be replaced by plain text safely.');
  if(changed(nativeElement,b,['text','start','duration','x','y','width','height']))blockers.add('Changed text styling cannot be exported exactly yet.');
  if(![e.start,e.duration,e.x,e.y,e.width,e.height].every(Number.isFinite)||e.duration<=0||e.width<=0||e.height<=0)blockers.add('Text timing and geometry must be finite and non-empty.');
  const bounds=structural?targetScene:scene;
  if(!bounds||e.start<bounds.start||e.start+e.duration>bounds.start+bounds.duration+1e-7)blockers.add('A text overlay exceeds its scene bounds.');
  change('text',e.id,fields(nativeElement,b,['text','start','duration','x','y','width','height']));
 }
 if(!same(project.settings,base.settings)||project.notes!==base.notes)warnings.add('SceneForge editor preferences and project notes are not included in Borumi.');
 return {supported:blockers.size===0,blockers:[...blockers],warnings:[...warnings],changes,sourceFormat:'preserved-borumi',history:'new-root'};
}
function structuralPlan(project:Project,source:BorumiProvenance,database:string){const db=new DatabaseSync(database,{readOnly:true});try{return planStructuralTimeline(project,source,db.prepare('SELECT * FROM scene_timeline_segments').all() as Row[]);}finally{db.close()}}
export async function planBorumiRoundtrip(project:Project,preservationRoot:string):Promise<BorumiCompatibilityPlan>{const {value,database}=await readBorumiPreservation(project,preservationRoot);return buildPlan(project,value,structuralPlan(project,value,database));}

function patchDatabase(db:DatabaseSync,project:Project,source:BorumiProvenance,newProjectId:string,structural:StructuralTimelinePlan|null){
 const base=source.baseline;
 const original=db.prepare('SELECT * FROM projects WHERE id=?').get(source.originalProjectId) as Row|undefined;
 if(!original||Number((db.prepare('SELECT count(*) n FROM projects').get() as Row).n)!==1)throw Error('The source snapshot must contain exactly one project.');
 const target=decode(original.render_target);if(!target.mode)throw Error('Unsupported native render target.');
 if(project.canvas.width!==base.canvas.width||project.canvas.height!==base.canvas.height){target.mode={...target.mode,width:project.canvas.width,height:project.canvas.height};db.prepare('UPDATE projects SET render_target=? WHERE id=?').run(JSON.stringify(target),source.originalProjectId);}
 if(project.name!==base.name)db.prepare('UPDATE projects SET name=? WHERE id=?').run(project.name,source.originalProjectId);
 for(const scene of project.scenes){const id=source.mapping.scenes[scene.id],b=base.scenes.find(s=>s.id===scene.id);if(!id||!b)continue;if(scene.name!==b.name)db.prepare('UPDATE scenes SET name=? WHERE id=?').run(scene.name,id);if(scene.script!==b.script)db.prepare('UPDATE scenes SET script=? WHERE id=?').run(encodeBorumiScript(scene.script),id);}
 const patched=new Set<string>();
 for(const c of structural?[]:project.clips){const m=source.mapping.clips[c.id],b=base.clips.find(x=>x.id===c.id);if(!m||!b||patched.has(m.segmentId))continue;patched.add(m.segmentId);
  const row=db.prepare('SELECT * FROM scene_timeline_segments WHERE id=?').get(m.segmentId) as Row|undefined;if(!row)throw Error('A preserved native segment is missing.');
  const k=decode(row.kind);let touched=false,start=row.start,duration=row.duration;
  if(c.gain!==b.gain){k.volume_filter=20*Math.log10(c.gain);touched=true;}
  if(c.effects.flipX!==b.effects.flipX){k.mirrored=c.effects.flipX;touched=true;}
  if(fields(c,b,['start','sourceIn','sourceOut','speed']).length){
   start=Number(row.start)+(c.start-b.start);duration=clipDuration(c);
   const offset=c.sourceIn-b.sourceIn;
   if(['VideoClip','AudioClip'].includes(k.kind)){k.clip_start=Number(k.clip_start??0)+offset;if(c.speed!==b.speed)k.speed=c.speed;}
   else if(k.kind==='Overlay'){k.overlay_kind={...k.overlay_kind,media_start:Number(k.overlay_kind?.media_start??0)+offset};}
   else{k.media_start=Number(k.media_start??0)+offset;}
   touched=true;
  }
  if(touched)db.prepare('UPDATE scene_timeline_segments SET start=?,duration=?,kind=?,edited=1 WHERE id=?').run(start,duration,JSON.stringify(k),m.segmentId);
 }
 if(structural)for(const patch of structural.patches){
  db.prepare('DELETE FROM scene_timeline_segments WHERE id=?').run(patch.id);
  for(const value of patch.rows){const row:Row={...value,id:value.id??randomUUID()},columns=Object.keys(row),quoted=columns.map(c=>'"'+c.replaceAll('"','""')+'"');
   db.prepare(`INSERT INTO scene_timeline_segments(${quoted.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));
  }
 }
 for(const e of project.elements){const m=source.mapping.elements[e.id],b=base.elements.find(x=>x.id===e.id);if(!m||!b)continue;
  const scene=base.scenes.find(s=>source.mapping.scenes[s.id]===m.sceneId),targetScene=project.scenes.find(s=>s.id===scene?.id);
  const nativeElement={...e,start:e.start-(structural&&scene&&targetScene?targetScene.start-scene.start:0)};
  if(same(nativeElement,b))continue;
  const row=db.prepare('SELECT * FROM scene_timeline_segments WHERE id=?').get(m.segmentId) as Row;const k=decode(row.kind);
  if(e.text!==b.text){if(typeof k.overlay_kind?.text!=='string')throw Error('Rich native text cannot be replaced by plain text safely.');k.overlay_kind={...k.overlay_kind,text:e.text};}
  if(fields(e,b,['x','y','width','height']).length)k.position={...k.position,kind:'Custom',x_ratio:e.x,y_ratio:e.y,width_ratio:e.width,height_ratio:e.height};
  db.prepare('UPDATE scene_timeline_segments SET start=?,duration=?,kind=?,edited=1 WHERE id=?').run(Number(row.start)+nativeElement.start-b.start,e.duration,JSON.stringify(k),m.segmentId);
 }
 // A fresh ID avoids collisions with the source. Never invent canonical history hashes.
 for(const table of ['project_version','project_commits'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.exec(`DELETE FROM ${table}`);
 for(const table of ['projects','scenes','medias','project_sources','project_timeline']){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const column=table==='projects'?'id':'project_id';
  if((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some(x=>x.name===column))db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(newProjectId,source.originalProjectId);
 }
}

async function copyTree(source:string,target:string,counter:{files:number;bytes:number},excludeRoot:Set<string>=new Set()){
 await mkdir(target,{recursive:true,mode:0o700});
 for(const item of await readdir(source,{withFileTypes:true})){
  if(excludeRoot.has(item.name))continue;
  const from=path.join(source,item.name),to=path.join(target,item.name),before=await lstat(from);
  if(before.isSymbolicLink())throw Error('Source bundle contains a symbolic link. Export is stopped to avoid copying files outside the selected bundle.');
  if(before.isDirectory())await copyTree(from,to,counter);
  else if(before.isFile()){
   await copyFile(from,to,constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);
   const after=await lstat(from),copied=await lstat(to);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||copied.size!==before.size)throw Error('A source asset changed while copying. Retry when the source is idle.');
   counter.files++;counter.bytes+=copied.size;
  }else throw Error('Unsupported special file inside the source bundle.');
 }
}
export interface BorumiExportResult {path:string;projectId:string;plan:BorumiCompatibilityPlan;filesCopied:number;bytesCopied:number;nativeValidation:'pending';}
export async function exportBorumiRoundtrip(project:Project,options:{preservationRoot:string;outputRoot:string}):Promise<BorumiExportResult>{
 const {value:source,database}=await readBorumiPreservation(project,options.preservationRoot),structural=structuralPlan(project,source,database),plan=buildPlan(project,source,structural);
 if(!plan.supported)throw Error(`Borumi export blocked: ${plan.blockers.join(' ')}`);
 const id=randomUUID(),slug=project.name.normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,70)||'SceneForge project';
 const outputRoot=await safeBorumiOutputRoot(options.outputRoot,source.sourceRoot);
 const output=path.resolve(outputRoot,`${slug}-${id.slice(0,8)}.bmprojbundle`),staging=`${output}.partial`;
 const sourcePath=path.resolve(source.sourceRoot);
 if(output===sourcePath||output.startsWith(sourcePath+path.sep))throw Error('Export destination must be outside the original bundle.');
 const counter={files:0,bytes:0};
 for(const media of source.baseline.media){try{if(!(await lstat(media.path)).isFile())throw Error('Not a regular file')}catch{throw Error('A source media file is missing or is a symbolic link. Relink or restore the original asset before exporting.');}}
 for(const [relative,expected] of Object.entries(source.assets??{})){const actual=await lstat(path.join(source.sourceRoot,relative));if(actual.size!==expected.size||actual.mtimeMs!==expected.mtimeMs)throw Error('A source media file changed after import. Reimport it before exporting a compatible copy.');}
 try{
  if(source.sourceIsBundle)await copyTree(source.sourceRoot,staging,counter,new Set([path.basename(source.sourceDatabase),'project.bmproj-wal','project.bmproj-shm','project.bmproj-journal','.sceneforge']));
  else{await mkdir(staging,{mode:0o700});try{await copyTree(path.join(source.sourceRoot,'medias'),path.join(staging,'medias'),counter)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  await mkdir(path.join(staging,'.sceneforge'),{mode:0o700});
  if(source.sourceIsBundle){try{await copyTree(path.join(source.sourceRoot,'.sceneforge'),path.join(staging,'.sceneforge','previous-export'),counter)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  await copyFile(database,path.join(staging,'.sceneforge','original-project.sqlite'),constants.COPYFILE_EXCL);
  const targetDb=path.join(staging,'project.bmproj');await copyFile(database,targetDb,constants.COPYFILE_EXCL);
  const db=new DatabaseSync(targetDb);
  try{db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');patchDatabase(db,project,source,id,structural);
   const integrity=Object.values(db.prepare('PRAGMA integrity_check').get()??{})[0];if(integrity!=='ok')throw Error('Exported database failed integrity check.');
   db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.close()}
  const result:BorumiExportResult={path:output,projectId:id,plan,filesCopied:counter.files,bytesCopied:counter.bytes,nativeValidation:'pending'};
  await writeFile(path.join(staging,'.sceneforge','export.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),sourceSnapshot:source.snapshotId,sourceDatabaseSha256:source.databaseSha256,...result},null,2),{mode:0o600});
  await rename(staging,output);return result;
 }catch(error){await rm(staging,{recursive:true,force:true});throw error}
}
