import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createProject, defaultEffects, defaultTransform, makeId, type Project, type Clip, type Media, type Caption } from '../shared/types.js';
import {cursorForTimeline,decodeCursorSidecar,type RecordedCursorPoint} from './cursor-sidecar.js';
import {decodeBorumiScript} from './borumi-script.js';
import {preserveBorumiDatabase,finishBorumiPreservation,type BorumiMapping} from './borumi-provenance.js';

type Row=Record<string,any>;
const decode=(v:any,fallback:any=null):any=>{if(typeof v!=='string')return v??fallback;try{return JSON.parse(v)}catch{return fallback}};
const numeric=(v:any,fallback=0)=>Number.isFinite(Number(v))&&v!==null?Number(v):fallback;
const rgb=(v:any)=>v&&[v.r,v.g,v.b].every(Number.isFinite)?`#${[v.r,v.g,v.b].map((n:number)=>Math.max(0,Math.min(255,n)).toString(16).padStart(2,'0')).join('')}`:undefined;

/** Converts an observed SQLite document without writing to the source database or media. */
export async function importBorumi(input:string,options:{roundtripDirectory?:string}={}):Promise<Project>{
 const info=await stat(input); const dbPath=info.isDirectory()?path.join(input,'project.bmproj'):input;
 let db=new DatabaseSync(dbPath,{readOnly:true});
 const rows=(name:string):Row[]=>{try{return db.prepare(`SELECT * FROM "${name}"`).all() as Row[]}catch{return []}};
 let data:Record<string,Row[]>;
 let preserved:Awaited<ReturnType<typeof preserveBorumiDatabase>>|undefined;
 try{if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get())throw new Error('This SQLite file is not a supported Borumi project.');
  if(options.roundtripDirectory){
   preserved=await preserveBorumiDatabase(db,dbPath,options.roundtripDirectory);
   db.close();db=new DatabaseSync(path.join(preserved.folder,'original.sqlite'),{readOnly:true});
  }
  data=Object.fromEntries(['projects','scenes','takes','clips','medias','scene_timeline_segments','project_timeline'].map(n=>[n,rows(n)]));
 }finally{db.close()}
 if(!data.projects.length)throw new Error('Borumi document has no project row.');
 const original=data.projects[0];const p=createProject(`${original.name||'Imported project'} — imported`);p.scenes=[];
 const mapping:BorumiMapping={scenes:{},media:{},clips:{},elements:{}};
 const warnings=new Set<string>(); const unmapped:Row[]=[];
 const retainTransitions=(segment:Row,k:Row,keys:string[])=>{
  const transitions=Object.fromEntries(keys.filter(key=>k[key]!=null).map(key=>[key,k[key]]));
  const unsupported=Object.values(transitions).filter(value=>!['Instant','Cut'].includes(typeof value==='string'?value:value.kind));
  if(unsupported.length){warnings.add(`${k.kind} transitions ${[...new Set(unsupported.map(value=>typeof value==='string'?value:value.kind))].join('/')} retained without animation: original fixed duration and easing are not recovered.`);unmapped.push({segmentId:segment.id,kind:'UnsupportedTransition',sourceKind:k.kind,transitions,renderedAs:'instant',reason:'Original fixed timing/curve is unknown; no invented duration applied.'})}
 };
 const target=decode(original.render_target,{}).mode??{};
 p.canvas.width=Math.max(1,numeric(target.width,1920));p.canvas.height=Math.max(1,numeric(target.height,1080));p.canvas.padding=0;p.canvas.radius=0;
 const timeline=data.project_timeline[0]??{};const background=decode(timeline.background,{}).main_kind;
 if(background?.kind==='Color'||background?.kind==='Solid')p.canvas.background=rgb(background.color)||p.canvas.background;
 else if(background)warnings.add(`Canvas background ${background.kind} retained as source metadata; choose a new canvas background.`);
 const mediaDir=path.join(path.dirname(dbPath),'medias');let filenames:string[]=[];
 try{filenames=await readdir(mediaDir)}catch{warnings.add('The bundle medias folder is missing. Source assets need relinking.')}
 const mediaMap=new Map<string,Media>();const cursorEvents=new Map<string,RecordedCursorPoint[]>();let cursorSidecars=0;
 for(const item of data.medias){
  const files=filenames.filter(n=>n.startsWith(`${item.id}.`)&&!n.endsWith('.cursor'));
  const filename=files[0];const tracks=decode(item.tracks,[]);const kind=tracks.some((t:Row)=>t.kind==='Video')?'video':tracks.some((t:Row)=>t.kind==='Image')?'image':'audio';
  const media:Media={id:makeId(),name:item.name||filename||`Missing ${kind}`,path:filename?path.join(mediaDir,filename):path.join(mediaDir,`${item.id}.missing`),kind,duration:numeric(item.duration),width:numeric(item.width),height:numeric(item.height),hasAudio:tracks.some((t:Row)=>t.kind==='Audio')};
  if(!filename)warnings.add(`Missing media file for source asset ${item.id}.`);
  mediaMap.set(item.id,media);p.media.push(media);
  mapping.media[media.id]=item.id;
  if(filenames.includes(`${item.id}.cursor`)){
   cursorSidecars++;
   try{cursorEvents.set(media.id,decodeCursorSidecar(await readFile(path.join(mediaDir,`${item.id}.cursor`))))}
   catch(error){warnings.add(`Cursor sidecar for ${item.id} was not imported: ${(error as Error).message}`)}
  }
 }
 const clipMap=new Map(data.clips.map(c=>[c.id,c]));const sceneStarts=new Map<string,number>();const visualOrigins=new Map<string,Row>();
 const segmentDuration=(s:Row)=>{if(s.duration!==null&&s.duration!==undefined)return Math.max(0,numeric(s.duration));const k=decode(s.kind,{});const c=clipMap.get(k.clip_id);const m=c&&mediaMap.get(c.media);return c?Math.max(0,(numeric(c.duration,m?.duration??0)-numeric(k.clip_start))/Math.max(.05,numeric(k.speed,1))):0};
 let position=0;
 for(const scene of data.scenes.sort((a,b)=>String(a.seq)<String(b.seq)?-1:String(a.seq)>String(b.seq)?1:0)){
  const segments=data.scene_timeline_segments.filter(s=>s.scene_id===scene.id&&['VideoClip','AudioClip'].includes(decode(s.kind,{}).kind));const duration=segments.length?Math.max(0,...segments.map(s=>numeric(s.start)+segmentDuration(s))):3;
  sceneStarts.set(scene.id,position);p.scenes.push({id:makeId(),name:scene.name||`Scene ${p.scenes.length+1}`,script:decodeBorumiScript(scene.script),notes:'',start:position,duration});position+=duration;
  mapping.scenes[p.scenes.at(-1)!.id]=scene.id;
 }
 const captions:Caption[]=[];
 for(const segment of [...data.scene_timeline_segments].sort((a,b)=>numeric(a.segment_order)-numeric(b.segment_order))){
  const k=decode(segment.kind,{});const start=(sceneStarts.get(segment.scene_id)??0)+numeric(segment.start);const duration=segmentDuration(segment);
  if(k.kind==='VideoClip'||k.kind==='AudioClip'){
   const source=clipMap.get(k.clip_id);const media=source&&mediaMap.get(source.media);if(!source||!media){warnings.add('Some clips refer to unavailable source records.');continue}
   const speed=Math.max(.05,numeric(k.speed,1));const sourceIn=Math.max(0,numeric(source.start_offset)+numeric(source.start_offset_adjustment)+numeric(k.clip_start));
   const clip:Clip={id:makeId(),mediaId:media.id,name:media.name,track:k.kind==='AudioClip'?'audio':k.content_kind?.kind==='Camera'?'camera':'screen',start,sourceIn,sourceOut:sourceIn+duration*speed,speed,gain:Math.pow(10,numeric(k.volume_filter)/20),muted:k.kind==='VideoClip',transform:defaultTransform(),effects:defaultEffects()};
   if(k.kind==='AudioClip'&&['Microphone','SystemSound'].includes(k.content_kind?.kind))clip.audioRole=k.content_kind.kind==='Microphone'?'microphone':'system';
   if(k.kind==='VideoClip')retainTransitions(segment,k,['transition']);
   clip.effects.flipX=!!k.mirrored;clip.effects.denoise=numeric(k.noise_cancelling_filter)>0;clip.effects.normalize=['Minimal','Extended'].includes(k.voice_enhancement_filter?.kind);
   if(clip.track==='camera'&&k.face_tracking_mode?.kind==='Auto'){
    clip.effects.faceCenter=true;
    warnings.add('Explicit Auto camera face tracking uses SceneForge local sampled static face anchoring; it approximates Borumi dynamic tracking and may frame moving subjects differently. Original mode/settings are retained.');
   }
   if(clip.effects.denoise||clip.effects.normalize)warnings.add('Imported voice/noise options use SceneForge audio filters; Borumi model output is not reproduced.');
   if(k.crop||k.background||k.freeze_frame||k.color_adjustments||k.face_tracking_mode?.kind==='Auto'){
    warnings.add('Crop, face tracking, freeze frames, color adjustments and virtual backgrounds require review; original parameters are retained.');unmapped.push({segmentId:segment.id,kind:k.kind,parameters:k});
   }
   p.clips.push(clip);if(k.kind==='VideoClip')visualOrigins.set(clip.id,{...segment,parsed:k});
   mapping.clips[clip.id]={segmentId:segment.id,sceneId:segment.scene_id,kind:k.kind};
   if(k.kind==='AudioClip'){
    const raw=data.medias.find(m=>m.id===source.media);const transcript=decode(raw?.transcription_status,{}).transcription;
    const words=(transcript?.segments??[]).flatMap((s:Row)=>s.tokens??[]).filter((w:Row)=>numeric(w.end)>sourceIn&&numeric(w.start)<clip.sourceOut).map((w:Row)=>({text:String(w.text??''),start:start+Math.max(0,numeric(w.start)-sourceIn)/speed,end:start+Math.min(duration,(numeric(w.end)-sourceIn)/speed)}));
    for(let i=0;i<words.length;i+=7){const group=words.slice(i,i+7);captions.push({id:makeId(),start:group[0].start,end:group[group.length-1].end,text:group.map((w:Row)=>w.text).join(' ').replace(/\s+/g,' ').trim(),words:group})}
   }
  }else if(['Music','SoundEffect'].includes(k.kind)||k.kind==='Overlay'&&k.overlay_kind?.kind==='Media'){
   const media=mediaMap.get(k.media_id??k.overlay_kind?.media_id);if(!media){warnings.add('An overlay or sound source is unavailable.');continue}
   const pos=k.position??{};const sourceIn=numeric(k.media_start??k.overlay_kind?.media_start);const visibleDuration=duration||Math.max(0,(p.scenes.find(s=>s.start<=start&&s.start+s.duration>=start)?.duration??media.duration));
   p.clips.push({id:makeId(),mediaId:media.id,name:media.name,track:k.kind==='Overlay'?'overlay':'music',start,sourceIn,sourceOut:sourceIn+visibleDuration,speed:1,gain:Math.pow(10,numeric(k.volume_filter)/20),muted:false,transform:{...defaultTransform(),x:numeric(pos.x_ratio),y:numeric(pos.y_ratio),width:numeric(pos.width_ratio,1),height:numeric(pos.height_ratio,1),borderRadius:numeric(k.border_radius_ratio)},effects:defaultEffects()});
   mapping.clips[p.clips.at(-1)!.id]={segmentId:segment.id,sceneId:segment.scene_id,kind:k.kind};
   retainTransitions(segment,k,['entrance_transition','exit_transition']);
   if(k.shadow_style||k.stroke_style){warnings.add('Overlay shadows and stroke details require review.');unmapped.push({segmentId:segment.id,kind:k.kind,parameters:k})}
  }else if(k.kind==='Overlay'&&k.overlay_kind?.kind==='Text'){
   retainTransitions(segment,k,['entrance_transition','exit_transition']);
   const pos=k.position??{};const text=k.overlay_kind.text??'';p.elements.push({id:makeId(),type:'text',start,duration,text:typeof text==='string'?text:JSON.stringify(text),x:numeric(pos.x_ratio,.1),y:numeric(pos.y_ratio,.1),width:numeric(pos.width_ratio,.8),height:numeric(pos.height_ratio,.2),color:'#ffffff',background:'transparent',fontSize:48,opacity:1,rotation:0});warnings.add('Text content imported with default style; original text style retained.');unmapped.push({segmentId:segment.id,kind:k.kind,parameters:k});
   mapping.elements[p.elements.at(-1)!.id]={segmentId:segment.id,sceneId:segment.scene_id,plainText:typeof k.overlay_kind.text==='string'};
  }else if(k.kind==='Layout'){retainTransitions(segment,k,['transition']);unmapped.push({start,duration,kind:k.kind,parameters:k})}
  else{warnings.add(`${k.kind||'Unknown'} segments retained as source metadata but not rendered identically.`);unmapped.push({start,duration,kind:k.kind,parameters:k})}
 }
 // Native layouts enumerate the active lanes from top to bottom. Keep a
 // persistent lane across cuts, then compact active lanes for each interval:
 // a lone clip on lane 1 is still layout source 0 once lane 0 has ended.
 const visualsByRole=new Map<string,Clip[]>();
 const lanes=new Map<string,Array<Array<{start:number;end:number;order:number}>>>();const laneOf=new Map<string,number>();
 const rounded=(v:number)=>Math.round(v*1e4)/1e4;
 for(const clip of p.clips.filter(c=>visualOrigins.has(c.id)).sort((a,b)=>numeric(visualOrigins.get(a.id)?.segment_order)-numeric(visualOrigins.get(b.id)?.segment_order)||a.start-b.start)){
  const role=visualOrigins.get(clip.id)!.parsed.content_kind?.kind??'Video';
  const clips=visualsByRole.get(role)??[];clips.push(clip);visualsByRole.set(role,clips);
  const roleLanes=lanes.get(role)??[];lanes.set(role,roleLanes);
  const start=rounded(clip.start),end=rounded(clip.start+(clip.sourceOut-clip.sourceIn)/clip.speed),order=numeric(visualOrigins.get(clip.id)?.segment_order);
  const overlap=(r:{start:number;end:number})=>start<r.end&&end>r.start;
  let lane=0;for(let i=0;i<roleLanes.length;i++)if(roleLanes[i].some(r=>overlap(r)&&r.order<order))lane=i+1;
  while(roleLanes[lane]?.some(overlap))lane++;
  (roleLanes[lane]??=[]).push({start,end,order});laneOf.set(clip.id,lane);
 }
 const layouts=data.scene_timeline_segments.filter(s=>decode(s.kind,{}).kind==='Layout').map(s=>({start:(sceneStarts.get(s.scene_id)??0)+numeric(s.start),end:s.duration==null?position:(sceneStarts.get(s.scene_id)??0)+numeric(s.start)+numeric(s.duration),value:decode(s.kind,{}).layout_kind_v2??decode(s.kind,{}).layout_kind})).sort((a,b)=>a.start-b.start);
 p.clips=p.clips.flatMap(clip=>{
  const origin=visualOrigins.get(clip.id);if(!origin)return [clip];const role=origin.parsed.content_kind?.kind??'Video';const end=clip.start+(clip.sourceOut-clip.sourceIn)/clip.speed;
  const roleClips=visualsByRole.get(role)!;
  const roleBounds=roleClips.flatMap(c=>[c.start,c.start+(c.sourceOut-c.sourceIn)/c.speed]);
  const bounds=[...new Set([clip.start,end,...[...layouts.flatMap(l=>[l.start,l.end]),...roleBounds].filter(t=>t>clip.start&&t<end)])].sort((a,b)=>a-b);
  return bounds.slice(0,-1).flatMap((a,i)=>{
   const b=bounds[i+1];if(b-a<=1e-7)return [];const middle=(a+b)/2;const layout=layouts.filter(l=>l.start<=middle&&l.end>middle).at(-1)?.value;
   const active=roleClips.filter(c=>c.start<=middle&&c.start+(c.sourceOut-c.sourceIn)/c.speed>middle).sort((a,b)=>laneOf.get(b.id)!-laneOf.get(a.id)!);
   const lane=active.findIndex(c=>c.id===clip.id);
   const piece:Clip={...structuredClone(clip),id:i===0?clip.id:makeId(),start:a,sourceIn:clip.sourceIn+(a-clip.start)*clip.speed,sourceOut:clip.sourceIn+(b-clip.start)*clip.speed};
   mapping.clips[piece.id]=mapping.clips[clip.id];
   const match=(source:Row)=>source?.content_kind?.kind===role&&numeric(source.layer_index)===lane;
   let zIndex=role==='Camera'?100:lane;
   if(layout?.kind==='Custom'){
    const index=(layout.sources??[]).findIndex((s:Row)=>match(s.source));const s=layout.sources?.[index];
    if(s){Object.assign(piece.transform,{x:numeric(s.x_ratio),y:numeric(s.y_ratio),width:numeric(s.width_ratio,1),height:numeric(s.height_ratio,1),fit:'cover',borderRadius:numeric(s.border_radius_ratio)*p.canvas.height});zIndex=index;
     if(s.shadow_style||s.stroke_style||s.overflow||s.video_background_override)warnings.add('Custom layout geometry/order imported; shadow, stroke, overflow and segmentation overrides require review.');
    }else piece.transform.opacity=0;
   }else if(layout?.kind==='Fullscreen'){
    if(!match(layout.source))piece.transform.opacity=0;else piece.transform.fit=layout.fit?.kind==='Cover'?'cover':'contain';
   }else{
    if(layout)warnings.add(`Layout preset ${layout.kind} uses an approximate automatic composition.`);
    if(role==='Camera'&&p.clips.some(c=>c.track==='screen'&&c.start<=middle&&c.start+(c.sourceOut-c.sourceIn)/c.speed>middle))Object.assign(piece.transform,{x:.72,y:.63,width:.25,height:.32,borderRadius:24,fit:'cover'});
   }
   Object.assign(piece,{zIndex});return [piece];
  });
 });
 if(background?.kind==='Media'){
  const bg=mediaMap.get(background.media_id);
  if(bg&&bg.kind==='image'){
   const bgClip:Clip={id:makeId(),mediaId:bg.id,name:'Canvas background',track:'screen',start:0,sourceIn:0,sourceOut:position,speed:1,gain:0,muted:true,transform:{...defaultTransform(),fit:'cover'},effects:defaultEffects()};Object.assign(bgClip,{zIndex:-1000});p.clips.unshift(bgClip);warnings.delete('Canvas background Media retained as source metadata; choose a new canvas background.');
  }
 }
 p.captions=captions.sort((a,b)=>a.start-b.start);p.captionStyle.enabled=false;
 if(p.captions.length)warnings.add('Existing transcript words imported as optional captions; review overlapping audio tracks before enabling captions.');
 if(cursorEvents.size){
  p.cursor.points=cursorForTimeline(p.clips,new Map(p.media.map(m=>[m.id,m])),cursorEvents,p.canvas);
  const globalCursor=decode(timeline.cursor,{});const style=globalCursor.style??decode(timeline.cursor_style,{});
  p.cursor.enabled=style.kind!=='Hidden'&&p.cursor.points.some(point=>point.visible!==false);p.cursor.smoothing=0;
  if(style.kind==='Pointer'&&rgb(style.primary_color))p.cursor.color=rgb(style.primary_color)!;
  p.cursor.highlight=!!globalCursor.highlight;
  warnings.add('Cursor positions imported from version-1 sidecars through source offsets, speed and layouts. Original cursor artwork, shape changes, size calibration, smoothing, click sounds/effects and timed style overrides are not reproduced.');
 }
 p.importWarnings=[...warnings];
 Object.assign(p,{importMetadata:{sourceApp:'Borumi',sourcePath:dbPath,unmappedSegments:unmapped,sourceSettings:{canvas:decode(original.render_target),cursorSidecars:{found:cursorSidecars,decoded:cursorEvents.size,sourceEvents:[...cursorEvents.values()].reduce((n,events)=>n+events.length,0),timelinePoints:p.cursor.points.length,format:'Borumi cursor v1',timing:'source media seconds'},timeline:Object.fromEntries(Object.entries(timeline).filter(([k])=>k!=='project_id').map(([k,v])=>[k,decode(v,v)]))}}});
 if(preserved){
  for(const clip of p.clips)clip.borumiOriginId=clip.id;
  p.importMetadata!.roundtrip=await finishBorumiPreservation(preserved,original.id,p,mapping);
 }
 return p;
}
