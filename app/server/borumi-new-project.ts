import {DatabaseSync} from 'node:sqlite';
import {copyFile,lstat,mkdir,rename,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {clipDuration,defaultEffects,type Clip,type Project,type Scene} from '../shared/types.js';
import {encodeBorumiScript} from './borumi-script.js';
import {readBorumiPreservation,safeBorumiOutputRoot} from './borumi-provenance.js';

export interface NewBorumiPlan {supported:boolean;blockers:string[];warnings:string[];sourceFormat:'new-from-native-schema';history:'new-root';}
const epsilon=1e-6;
const owner=(p:Project,c:Clip)=>p.scenes.find(s=>c.start>=s.start-epsilon&&c.start+clipDuration(c)<=s.start+s.duration+epsilon);
const role=(c:Clip)=>c.track==='camera'?'Camera':'Screen';
export function planNewBorumiProject(p:Project):NewBorumiPlan{
 const blockers=new Set<string>(),warnings=['Requires a previously imported Borumi 0.32.0 schema template. Only schema and migration records are used; no source project content or history is copied.','A separate new Borumi project is created. Native opening still requires verification.','Creator Compiler editor preferences, notes and preview frame rate are not part of this Borumi interchange.'];
 if(p.timelineLayers?.length||p.clips.some(c=>c.layerId!==undefined))blockers.add('Custom timeline layers cannot be preserved by this Borumi export yet.');
 if(p.recordedTakes?.length)blockers.add('Creator Compiler recorded-take history cannot be preserved by this Borumi export. Keep the Creator Compiler project or export a video instead.');
 if(p.canvas.backgroundPattern!==undefined)blockers.add('Moving-dot canvas backgrounds cannot be preserved by this Borumi export. Choose Solid color in Canvas, or export a video instead.');
 if(!/^#[0-9a-f]{6}$/i.test(p.canvas.background)||p.canvas.padding!==0||p.canvas.radius!==0||p.canvas.backgroundMediaId)blockers.add('New Borumi export currently requires a solid six-digit canvas color, zero canvas padding and zero canvas radius.');
 if(![p.canvas.width,p.canvas.height].every(n=>Number.isInteger(n)&&n>0&&n<=16384))blockers.add('Canvas dimensions must be integers between 1 and 16384.');
 if(p.captions.length||p.elements.length||p.zooms.length||p.cursor.enabled||p.cursor.points.length)blockers.add('Captions, text/shapes, zooms and cursor paths cannot be exported from a new project yet.');
 for(const list of [p.scenes,p.media,p.clips])if(new Set(list.map(v=>v.id)).size!==list.length)blockers.add('Project entity IDs must be unique.');
 let end=0;for(const scene of p.scenes){if(Math.abs(scene.start-end)>epsilon||scene.duration<0)blockers.add('Scenes must be contiguous, in timeline order and nonnegative.');end=scene.start+scene.duration;}
 for(const c of p.clips){
  const m=p.media.find(m=>m.id===c.mediaId),scene=owner(p,c);if(!scene)blockers.add('Each clip must fit within a single scene.');
  if(!m||m.kind==='image'||c.track==='overlay')blockers.add('New Borumi export currently supports video/audio media on screen, camera, audio and music tracks.');
  if(m&&((['screen','camera'].includes(c.track)&&m.kind!=='video')||(['audio','music'].includes(c.track)&&m.kind!=='audio'&&!m.hasAudio)))blockers.add('A clip track does not match its source media streams.');
  if(![c.start,c.sourceIn,c.sourceOut,c.speed,c.gain].every(Number.isFinite)||c.sourceIn<0||c.sourceOut<=c.sourceIn||c.speed<.05||c.speed>16||m&&c.sourceOut>m.duration+epsilon||c.gain<=0||c.gain>100)blockers.add('Clip source range, speed or gain is outside the supported bounds.');
  if(c.effectTiming&&(Math.min(c.sourceIn,c.effectTiming.sourceIn)!==c.sourceIn||Math.max(c.sourceOut,c.effectTiming.sourceOut)!==c.sourceOut))blockers.add('Clip effect timing outside the current source range cannot be exported to a new Borumi project.');
  if(c.track==='music'&&c.speed!==1)blockers.add('Music speed changes cannot be exported yet.');
  if(['audio','music'].includes(c.track)&&c.muted)blockers.add('Muted standalone audio clips cannot be represented without dropping their editable clip.');
  // Camera face centering maps to Borumi's Auto face tracking; any other face centering has no native equivalent.
  const {faceCenter,...effects}=c.effects;if(!isDeepStrictEqual(effects,{...defaultEffects(),flipX:c.effects.flipX}))blockers.add('Only horizontal video flip and camera face centering are supported for new-project clip effects.');
  if(faceCenter&&c.track!=='camera')blockers.add('Face centering can only be exported on camera clips.');
  if(c.effects.flipX&&!['screen','camera'].includes(c.track))blockers.add('Horizontal flip requires a video track.');
  const t=c.transform;if(![t.x,t.y,t.width,t.height,t.rotation,t.opacity,t.borderRadius].every(Number.isFinite)||t.width<=0||t.height<=0||t.rotation!==0||t.opacity!==1||t.borderRadius<0)blockers.add('Video transforms require a positive rectangle, zero rotation and full opacity.');
  if(t.shadow)blockers.add('Clip shadows cannot be exported to a new Borumi project yet.');
  if(t.fit==='contain'&&t.borderRadius!==0)blockers.add('Contain-fit with rounded corners cannot be exported exactly yet.');
 }
 const videos=p.clips.filter(c=>['screen','camera'].includes(c.track));
 for(let i=0;i<videos.length;i++)for(let j=i+1;j<videos.length;j++)if(role(videos[i])===role(videos[j])&&videos[i].start<videos[j].start+clipDuration(videos[j])-epsilon&&videos[j].start<videos[i].start+clipDuration(videos[i])-epsilon)blockers.add('Overlapping videos on the same content track cannot be exported yet.');
 for(const s of p.scenes){const clips=p.clips.filter(c=>owner(p,c)?.id===s.id&&c.track!=='music');const actual=clips.length?Math.max(...clips.map(c=>c.start+clipDuration(c)))-s.start:0;if(Math.abs(actual-s.duration)>epsilon)blockers.add('Each scene duration must end at its last video or narration clip.');}
 return {supported:!blockers.size,blockers:[...blockers],warnings,sourceFormat:'new-from-native-schema',history:'new-root'};
}

const nativeSchema=`
CREATE TABLE _borumi_migrations(id INTEGER PRIMARY KEY,sql TEXT NOT NULL);
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,render_target TEXT,active_tool TEXT);
CREATE TABLE scenes(id TEXT PRIMARY KEY,project_id TEXT,seq TEXT,name TEXT,script TEXT);
CREATE TABLE takes(id TEXT PRIMARY KEY,scene_id TEXT,name TEXT,started_at REAL,ended_at REAL,record_over_mappings TEXT,record_over INTEGER);
CREATE TABLE clips(id TEXT PRIMARY KEY,take_id TEXT,media TEXT,source TEXT,start_offset REAL,duration REAL,media_track TEXT,start_offset_adjustment REAL);
CREATE TABLE medias(id TEXT PRIMARY KEY,project_id TEXT,kind TEXT,status TEXT,source TEXT,project_source TEXT,duration REAL,transcription_status TEXT,hidden_cursor INTEGER,prefers_mirrored INTEGER,tracks TEXT,audio_stats TEXT,rotation INTEGER,inferred_video_kind TEXT,inferred_audio_kind TEXT,name TEXT,width INTEGER,height INTEGER);
CREATE TABLE project_sources(id TEXT PRIMARY KEY,project_id TEXT,name TEXT,kind TEXT,seq TEXT,enabled INTEGER,preferred_source_affinities TEXT,preferred_source_configuration TEXT);
CREATE TABLE scene_timeline_segments(id TEXT PRIMARY KEY,scene_id TEXT,start REAL,duration REAL,edited INTEGER,segment_group TEXT,kind TEXT,segment_order INTEGER,created_at REAL);
CREATE TABLE project_timeline(project_id TEXT PRIMARY KEY,background TEXT,cursor_hide_camera_on_overlap INTEGER,cursor_style TEXT,cursor_size_factor REAL,cursor_hide_when_still INTEGER,captions TEXT,cursor_following_mode TEXT,cursor TEXT,virtual_background_candidates TEXT,last_selected_replace_background_media_id TEXT);
CREATE TABLE project_version(project_id TEXT PRIMARY KEY NOT NULL,root_commit_id TEXT NOT NULL,head_commit_id TEXT NOT NULL);
CREATE TABLE project_commits(commit_id TEXT PRIMARY KEY NOT NULL,format_version INTEGER NOT NULL,canonical_body BLOB NOT NULL);`;
const json=JSON.stringify;

export async function exportNewBorumiProject(p:Project,options:{templateProject:Project;preservationRoot:string;outputRoot:string}){
 const plan=planNewBorumiProject(p);if(!plan.supported)throw Error(`Borumi export blocked: ${plan.blockers.join(' ')}`);
 const template=await readBorumiPreservation(options.templateProject,options.preservationRoot),input=new DatabaseSync(template.database,{readOnly:true});
 let migrations:Array<{id:number;sql:string}>;try{migrations=input.prepare('SELECT id,sql FROM _borumi_migrations ORDER BY id').all() as typeof migrations;}finally{input.close()}
 if(migrations.length!==39||migrations.some((m,i)=>m.id!==i))throw Error('The schema template is not the observed Borumi 0.32.0 migration set.');
 const outputRoot=await safeBorumiOutputRoot(options.outputRoot,template.value.sourceRoot);
 const projectId=randomUUID(),slug=p.name.normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,70)||'Creator Compiler project',output=path.resolve(outputRoot,`${slug}-${projectId.slice(0,8)}.bmprojbundle`),staging=`${output}.partial`;
 const sourceRoot=path.resolve(template.value.sourceRoot);if(output===sourceRoot||output.startsWith(sourceRoot+path.sep))throw Error('Export destination must be outside the template source bundle.');
 await mkdir(path.join(staging,'medias'),{recursive:true,mode:0o700});
 let db:DatabaseSync|undefined;try{
  const mediaIds=new Map<string,string>();let bytesCopied=0;
  for(const m of p.media){const id=randomUUID(),ext=path.extname(m.path);if(!/^\.[a-zA-Z0-9]{1,12}$/.test(ext))throw Error('Media requires a recognizable file extension.');const before=await lstat(m.path);if(!before.isFile())throw Error('Media must be a regular file, not a symbolic link.');await copyFile(m.path,path.join(staging,'medias',id+ext),constants.COPYFILE_FICLONE|constants.COPYFILE_EXCL);const after=await lstat(m.path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Source media changed while copying.');bytesCopied+=before.size;mediaIds.set(m.id,id);}
  db=new DatabaseSync(path.join(staging,'project.bmproj'));db.exec(nativeSchema);db.exec('BEGIN IMMEDIATE');
  for(const m of migrations)db.prepare('INSERT INTO _borumi_migrations VALUES(?,?)').run(m.id,m.sql);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run(projectId,p.name,json({version:2,mode:{kind:'Generic',width:p.canvas.width,height:p.canvas.height}}),json({kind:'Record'}));
  const color={r:parseInt(p.canvas.background.slice(1,3),16),g:parseInt(p.canvas.background.slice(3,5),16),b:parseInt(p.canvas.background.slice(5,7),16),a:255};
  db.prepare('INSERT INTO project_timeline(project_id,background,cursor,virtual_background_candidates) VALUES(?,?,?,?)').run(projectId,json({main_kind:{kind:'Solid',color}}),json({style:{kind:'Hidden'},size_factor:1,hide_camera_on_overlap:false,hide_when_still:false,following_mode:{kind:'Auto'},click_sound_volume:-5}),'[]');
  for(const m of p.media){const tracks=[{kind:m.kind==='video'?'Video':m.kind==='image'?'Image':'Audio'},...(m.kind==='video'&&m.hasAudio?[{kind:'Audio'}]:[])];db.prepare('INSERT INTO medias(id,project_id,status,duration,tracks,name,width,height) VALUES(?,?,?,?,?,?,?,?)').run(mediaIds.get(m.id)!,projectId,json({kind:'Ready'}),m.duration,json(tracks),m.name,m.width||null,m.height||null);}
  let segmentOrder=0;const now=Date.now()/1000;
  const insertSegment=(sceneId:string,start:number,duration:number,kind:unknown)=>db!.prepare('INSERT INTO scene_timeline_segments(id,scene_id,start,duration,edited,kind,segment_order,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),sceneId,start,duration,1,json(kind),segmentOrder++,now);
  for(const [index,scene] of p.scenes.entries()){
   const sceneId=randomUUID(),takeId=randomUUID();db.prepare('INSERT INTO scenes VALUES(?,?,?,?,?)').run(sceneId,projectId,`O${String(index).padStart(8,'0')}`,scene.name,encodeBorumiScript(scene.script));db.prepare('INSERT INTO takes(id,scene_id,name,started_at) VALUES(?,?,?,?)').run(takeId,sceneId,'Creator Compiler import',now);
   const clips=p.clips.filter(c=>owner(p,c)?.id===scene.id),visual=clips.filter(c=>['screen','camera'].includes(c.track));
   for(const c of clips){
    const m=p.media.find(m=>m.id===c.mediaId)!,mediaId=mediaIds.get(c.mediaId)!,duration=clipDuration(c),start=c.start-scene.start;
    const addAV=(video:boolean)=>{const clipId=randomUUID();db!.prepare('INSERT INTO clips(id,take_id,media,start_offset,duration,media_track) VALUES(?,?,?,?,?,?)').run(clipId,takeId,mediaId,0,m.duration,json({kind:video?'Video':'Audio'}));const common={scene_id:sceneId,take_id:takeId,clip_id:clipId,clip_start:c.sourceIn,collapse_group_id:null,speed:c.speed===1?null:c.speed};
     const audioRole=c.audioRole??m.audioRole;
     insertSegment(sceneId,start,duration,video?{...common,kind:'VideoClip',content_kind:{kind:role(c)},mirrored:c.effects.flipX,freeze_frame:null,face_tracking_mode:{kind:c.track==='camera'&&c.effects.faceCenter?'Auto':'Disabled'},crop:null,background:null,color_adjustments:null,transition:{kind:'Cut'}}:{...common,kind:'AudioClip',content_kind:{kind:audioRole==='system'?'SystemSound':audioRole==='microphone'?'Microphone':c.track==='screen'?'SystemSound':'Microphone'},volume_filter:20*Math.log10(c.gain),noise_cancelling_filter:null,noise_cancelling_mode:null,voice_enhancement_filter:{kind:'Disabled'}});
    };
    if(['screen','camera'].includes(c.track)){addAV(true);if(m.hasAudio&&!c.muted)addAV(false);}
    else if(c.track==='music')insertSegment(sceneId,start,duration,{kind:'Music',media_id:mediaId,media_start:c.sourceIn,volume_filter:20*Math.log10(c.gain)});
    else addAV(false);
   }
   const cuts=[...new Set([scene.start,scene.start+scene.duration,...visual.flatMap(c=>[c.start,c.start+clipDuration(c)])])].sort((a,b)=>a-b);
   for(let i=0;i<cuts.length-1;i++){const start=cuts[i],duration=cuts[i+1]-start;if(duration<=epsilon)continue;const active=visual.filter(c=>c.start<=start+epsilon&&c.start+clipDuration(c)>start+epsilon),layers=active.map(c=>({c,layer:active.filter(x=>role(x)===role(c)).indexOf(c)})).sort((a,b)=>(a.c.zIndex??(a.c.track==='camera'?100:0))-(b.c.zIndex??(b.c.track==='camera'?100:0)));
    const sources=layers.map(({c,layer})=>{const t=c.transform,m=p.media.find(m=>m.id===c.mediaId)!;let {x,y,width,height}=t;if(t.fit==='contain'&&m.width&&m.height){const mediaAspect=m.width/m.height,boxAspect=width*p.canvas.width/(height*p.canvas.height);if(mediaAspect>boxAspect){const h=width*p.canvas.width/mediaAspect/p.canvas.height;y+=(height-h)/2;height=h;}else{const w=height*p.canvas.height*mediaAspect/p.canvas.width;x+=(width-w)/2;width=w;}}
     return {source:{content_kind:{kind:role(c)},layer_index:layer},x_ratio:x,y_ratio:y,width_ratio:width,height_ratio:height,border_radius_ratio:t.borderRadius/Math.max(1,Math.min(p.canvas.width,p.canvas.height)),lock_aspect_ratio:false,overflow:false,corner_shape:{kind:'Regular'},is_shadow_style_aware:true,shadow_style:null,stroke_style:null,video_background_override:null,face_tracking_mode_override:null,hide_on_cursor_overlap:null};});
    insertSegment(sceneId,start-scene.start,duration,{kind:'Layout',layout_kind_v2:{kind:'Custom',sources},layout_kind:null,transition:{kind:'Instant'}});
   }
  }
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get()??{})[0];if(integrity!=='ok')throw Error('New Borumi database integrity check failed.');db.exec('COMMIT');db.close();db=undefined;
  await mkdir(path.join(staging,'.sceneforge'),{mode:0o700});const result={path:output,projectId,plan,mediaCount:p.media.length,bytesCopied,nativeValidation:'pending' as const};await writeFile(path.join(staging,'.sceneforge','export.json'),json({version:1,...result}),{mode:0o600});await rename(staging,output);return result;
 }catch(error){try{db?.close()}catch{}await rm(staging,{recursive:true,force:true});throw error;}
}
