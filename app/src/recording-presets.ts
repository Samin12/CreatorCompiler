import type {NormalizedRegion} from './capture-region';
import type {CaptureRequest} from './capture-preview';
export type RecordingSettings={selection:{camera:boolean;microphone:boolean;screen:boolean;systemAudio:boolean};cameraId:string;microphoneId:string;cameraResolution:string;cameraFps:number;screenFps:number;mirror:boolean;echoCancellation:boolean;noiseSuppression:boolean;captureMode:'display'|'window'|'region';region:NormalizedRegion|null};
export type RecordingPreset={id:string;name:string;settings:RecordingSettings};
export type RecordingPreferences={version:1;current:RecordingSettings;activeId:string|null;presets:RecordingPreset[]};
export const RECORDING_PREFERENCES_KEY='sceneforge.recording-preferences.v1';
export const defaultRecordingSettings=():RecordingSettings=>({selection:{camera:true,microphone:true,screen:false,systemAudio:false},cameraId:'',microphoneId:'',cameraResolution:'1920x1080',cameraFps:30,screenFps:30,mirror:false,echoCancellation:true,noiseSuppression:true,captureMode:'display',region:null});
const clone=(s:RecordingSettings):RecordingSettings=>({...s,selection:{...s.selection},region:s.region?{...s.region}:null});
function settingsFrom(value:unknown):RecordingSettings{
 const d=defaultRecordingSettings(),s=(value&&typeof value==='object'?value:{}) as Partial<RecordingSettings>;
 for(const key of ['camera','microphone','screen','systemAudio'] as const)if(typeof s.selection?.[key]==='boolean')d.selection[key]=s.selection[key];
 for(const key of ['cameraId','microphoneId'] as const)if(typeof s[key]==='string')d[key]=s[key].slice(0,1024);
 if(['1280x720','1920x1080','3840x2160'].includes(s.cameraResolution!))d.cameraResolution=s.cameraResolution!;
 for(const key of ['cameraFps','screenFps'] as const)if([30,60].includes(s[key]!))d[key]=s[key]!;
 for(const key of ['mirror','echoCancellation','noiseSuppression'] as const)if(typeof s[key]==='boolean')d[key]=s[key];
 if(['display','window','region'].includes(s.captureMode!))d.captureMode=s.captureMode!;
 if(s.region&&['x','y','width','height'].every(k=>typeof s.region?.[k as keyof NormalizedRegion]==='number'&&Number.isFinite(s.region[k as keyof NormalizedRegion]))&&s.region.x>=0&&s.region.y>=0&&s.region.width>0&&s.region.height>0&&s.region.x+s.region.width<=1&&s.region.y+s.region.height<=1)d.region={...s.region};
 return d;
}
export function readRecordingPreferences(raw:string|null):RecordingPreferences{
 const empty:RecordingPreferences={version:1,current:defaultRecordingSettings(),activeId:null,presets:[]};
 try{const value=JSON.parse(raw||'null');if(value?.version!==1)return empty;
 const seen=new Set<string>();const presets:RecordingPreset[]=[];
 for(const item of Array.isArray(value.presets)?value.presets.slice(0,50):[]){if(typeof item?.id!=='string'||!item.id||seen.has(item.id)||typeof item.name!=='string'||!item.name.trim())continue;seen.add(item.id);presets.push({id:item.id.slice(0,128),name:item.name.trim().slice(0,80),settings:settingsFrom(item.settings)});}
 return {version:1,current:settingsFrom(value.current),activeId:presets.some(p=>p.id===value.activeId)?value.activeId:null,presets};
 }catch{return empty;}
}
export function loadRecordingPreferences():RecordingPreferences{try{return readRecordingPreferences(localStorage.getItem(RECORDING_PREFERENCES_KEY));}catch{return readRecordingPreferences(null);}}
export function saveRecordingPreferences(value:RecordingPreferences){localStorage.setItem(RECORDING_PREFERENCES_KEY,JSON.stringify(value));}
export function saveRecordingPreset(presets:RecordingPreset[],name:string,settings:RecordingSettings,id:string):RecordingPreset[]{
 const clean=name.trim();if(!clean||clean.length>80)throw new Error('Use a preset name between 1 and 80 characters.');
 if(presets.some(p=>p.name.toLocaleLowerCase()===clean.toLocaleLowerCase()&&p.id!==id))throw new Error('A recording preset already has that name.');
 if(presets.length>=50&&!presets.some(p=>p.id===id))throw new Error('You can save up to 50 recording presets.');
 const value={id,name:clean,settings:clone(settings)};return presets.some(p=>p.id===id)?presets.map(p=>p.id===id?value:p):[...presets,value];
}
/** Automatic restoration may open already-granted camera/mic only. Display sharing always needs a fresh explicit choice. */
export function grantedPreviewRequests(settings:RecordingSettings,granted:{camera?:boolean;microphone?:boolean}):CaptureRequest[]{
 const requests:CaptureRequest[]=[];
 if(settings.selection.camera&&granted.camera){const [width,height]=settings.cameraResolution.split('x').map(Number);requests.push({kind:'camera',deviceId:settings.cameraId,width,height,frameRate:settings.cameraFps});}
 if(settings.selection.microphone&&granted.microphone)requests.push({kind:'microphone',deviceId:settings.microphoneId,echoCancellation:settings.echoCancellation,noiseSuppression:settings.noiseSuppression});
 return requests;
}
