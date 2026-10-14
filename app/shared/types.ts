/** SceneForge's independent, versioned editing model. All timeline times are seconds. */
export type TrackKind = 'screen'|'camera'|'audio'|'music'|'overlay';
/** Capture provenance, never inferred from a filename or signal level. */
export type AudioRole = 'microphone'|'system';
export const isAudioRole=(value:unknown):value is AudioRole=>value==='microphone'||value==='system';
export interface Media {
 id:string; name:string; path:string; kind:'video'|'audio'|'image'; duration:number; width:number; height:number;
 fps?:number; hasAudio?:boolean; size?:number; thumbnail?:string; proxyPath?:string; waveform?:number[];
 audioRole?:AudioRole;
}
export interface Canvas { width:number; height:number; fps:number; background:string; backgroundMediaId?:string; padding:number; radius:number; }
export interface Transform { x:number; y:number; width:number; height:number; rotation:number; opacity:number; fit:'contain'|'cover'; borderRadius:number; shadow?:{x:number;y:number;blur:number;color:string}; }
export interface Clip {
 id:string; mediaId:string; name:string; track:TrackKind; start:number; sourceIn:number; sourceOut:number; speed:number;
 gain:number; muted:boolean; transform:Transform;
 zIndex?:number;
 /** Visual timeline row, separate from recording/source role. */
 layerId?:string;
 audioRole?:AudioRole;
 /** Persistent recorded-take provenance; split clips retain this identity. */
 recordingTakeId?:string;
 /** Opaque imported clip identity; copy export validates it against the preserved baseline. */
 borumiOriginId?:string;
 /** Original source interval for continuous fades and audio processing after a split. */
 effectTiming?:{sourceIn:number;sourceOut:number};
 effects:{brightness:number; contrast:number; saturation:number; blur:number; grayscale:boolean; flipX:boolean; fadeIn:number; fadeOut:number; denoise:boolean; normalize:boolean; background?:'none'|'remove'|'blur'; faceCenter?:boolean};
}
export interface Scene { id:string; name:string; script:string; notes:string; start:number; duration:number; }
export interface Caption { id:string; start:number; end:number; text:string; words?:Array<{text:string;start:number;end:number}>; }
export interface CaptionStyle { enabled:boolean; fontSize:number; color:string; background:string; position:'bottom'|'center'|'top'; maxWords:number; }
export interface Element {
 id:string; type:'text'|'rectangle'|'ellipse'|'arrow'|'highlight'|'blur'; start:number; duration:number; text:string;
 x:number;y:number;width:number;height:number;color:string;background:string;fontSize:number;opacity:number;rotation:number;
}
export interface Zoom { id:string; start:number; duration:number; scale:number; x:number;y:number; target:'screen'|'camera'; easing:'linear'|'smooth'; }
export interface CursorPoint { time:number;x:number;y:number;pressed?:boolean;visible?:boolean; }
export interface CursorSettings { enabled:boolean; size:number; color:string; highlight:boolean; smoothing:number; points:CursorPoint[]; }
/** Captured assets remain available even when their take has no active timeline clips. */
export interface RecordedTake {
 id:string;createdAt:string;sceneId:string;name?:string;media:Media[];tracks:TrackKind[];offsets:number[];
 labels?:string[];clipIds?:string[];retained?:boolean;confirmedAt?:string;recordOver?:boolean;
 /** Edited clips/captions use scene-relative seconds; source trims/effects remain unchanged. */
 timeline?:{duration:number;start?:number;clips:Clip[];captions:Caption[]};
 /** Roles last installed by this take, used to preserve subsequent deletions when archiving. */
 installedRoles?:string[];
}
export interface Project {
 version:1; id:string; name:string; createdAt:string; updatedAt:string;
 canvas:Canvas; scenes:Scene[]; media:Media[]; clips:Clip[]; captions:Caption[]; captionStyle:CaptionStyle;
 elements:Element[]; zooms:Zoom[]; cursor:CursorSettings; notes:string;
 recordedTakes?:RecordedTake[];
 /** Ordered rows created by dragging clips between timeline layers. */
 timelineLayers?:Array<{id:string;name:string;kind:'video'|'audio';order:number}>;
 settings:{previewQuality:'original'|'proxy';snap:boolean;ripple:boolean;teleprompterSpeed:number;teleprompterFontSize:number;teleprompterMirror:boolean};
 importWarnings?:string[];
 importMetadata?:{sourceApp:string;sourceVersion?:string;sourcePath?:string;unmappedSegments?:unknown[];sourceSettings?:unknown;roundtrip?:{version:1;snapshotId:string}};
}
export interface ProjectSummary { id:string;name:string;updatedAt:string;duration:number;mediaCount:number;sceneCount:number;thumbnailMediaId?:string; }
export interface ExportOptions { format:'mp4'|'webm'|'wav'|'srt'|'txt'|'md'|'json'; width?:number;height?:number;fps?:number;quality?:'draft'|'balanced'|'high';hardware?:boolean;burnCaptions?:boolean; range?:{start:number;end:number}; }
export interface Job { id:string; type:'export'|'proxy'|'transcribe'|'analysis'; status:'queued'|'running'|'complete'|'failed'|'cancelled'|'interrupted'; progress:number; message:string; outputPath?:string; startedAt:string; completedAt?:string; error?:string; }
export interface AISettings { provider:'local'|'openai'|'openai-compatible'|'elevenlabs';baseUrl:string;model:string;language:string;apiKey?:string;localCommand?:string; }
export interface AISuggestion { id:string;type:'silence'|'filler'|'script'|'caption'|'cut';start?:number;end?:number;text:string;reason:string; }
export interface Capabilities { ffmpeg:boolean;ffprobe:boolean;hardwareEncode:boolean;transcription:{local:boolean;command?:string;providers:string[]};version:string; }
export const defaultTransform=():Transform=>({x:0,y:0,width:1,height:1,rotation:0,opacity:1,fit:'contain',borderRadius:0});
export const defaultEffects=():Clip['effects']=>({brightness:0,contrast:1,saturation:1,blur:0,grayscale:false,flipX:false,fadeIn:0,fadeOut:0,denoise:false,normalize:false});
export const clipDuration=(clip:Clip)=>Math.max(0,(clip.sourceOut-clip.sourceIn)/Math.max(.05,clip.speed));
/** Legacy untagged sources retain their original track priority. */
export function narrationPriority(clip:Clip,media?:Media){const role=clip.audioRole??media?.audioRole;return role==='microphone'?-1:role==='system'?4:({audio:0,camera:1,screen:2,overlay:3,music:4})[clip.track];}
export function clipEffectTiming(clip:Clip){const sourceIn=Math.min(clip.sourceIn,clip.effectTiming?.sourceIn??clip.sourceIn),sourceOut=Math.max(clip.sourceOut,clip.effectTiming?.sourceOut??clip.sourceOut);return {sourceIn,sourceOut,offset:(clip.sourceIn-sourceIn)/clip.speed,duration:(sourceOut-sourceIn)/clip.speed};}
export const projectDuration=(p:Project)=>Math.max(0,...p.clips.map(c=>c.start+clipDuration(c)),...p.elements.map(e=>e.start+e.duration),...p.scenes.map(s=>s.start+s.duration));
export const makeId=()=>globalThis.crypto.randomUUID();
export function createProject(name='Untitled project'):Project {const now=new Date().toISOString();return {version:1,id:makeId(),name,createdAt:now,updatedAt:now,canvas:{width:1920,height:1080,fps:30,background:'#171b27',padding:48,radius:20},scenes:[{id:makeId(),name:'Scene 1',script:'',notes:'',start:0,duration:0}],media:[],clips:[],captions:[],captionStyle:{enabled:true,fontSize:48,color:'#ffffff',background:'#10131ccc',position:'bottom',maxWords:7},elements:[],zooms:[],cursor:{enabled:false,size:24,color:'#ffffff',highlight:false,smoothing:.5,points:[]},notes:'',settings:{previewQuality:'proxy',snap:true,ripple:true,teleprompterSpeed:30,teleprompterFontSize:42,teleprompterMirror:false}};}
