import type {DesktopMediaAccessStatus,DesktopMediaPermissions,SceneForgeDesktopBridge} from './desktop';
import {requestDisplayMedia,requestUserMedia} from './media-access';

export type CapturePermission='camera'|'microphone'|'screen';
export const permissionLabels:Record<DesktopMediaAccessStatus,string>={
 'not-determined':'Not requested',granted:'Allowed',denied:'Not allowed',restricted:'Restricted',unknown:'Not verified',unsupported:'Not available',
};
export async function readMediaPermissions(bridge?:Pick<SceneForgeDesktopBridge,'getMediaPermissions'|'platform'>,permissions?:Pick<Permissions,'query'>):Promise<DesktopMediaPermissions>{
 if(bridge?.getMediaPermissions)return bridge.getMediaPermissions();
 const result:DesktopMediaPermissions={platform:bridge?.platform||'browser',camera:'unknown',microphone:'unknown',screen:'unknown',systemAudio:'unknown'};
 if(permissions)await Promise.all((['camera','microphone'] as const).map(async kind=>{try{const permission=await permissions.query({name:kind as PermissionName});result[kind]=permission.state==='prompt'?'not-determined':permission.state;}catch{/* Some browsers cannot query capture permissions. */}}));
 return result;
}

/** A setup check never leaves a camera, microphone or shared screen running. */
export async function checkCapturePermission(kind:CapturePermission,devices?:Pick<MediaDevices,'getUserMedia'|'getDisplayMedia'>):Promise<string>{
 if(!devices||(kind==='screen'?!devices.getDisplayMedia:!devices.getUserMedia))throw new Error('Capture is unavailable here. Open the desktop app or a browser with media capture support.');
 const stream=kind==='screen'?await requestDisplayMedia({video:true,audio:false},devices):await requestUserMedia({video:kind==='camera',audio:kind==='microphone'},undefined,devices);
 try{
  const track=(kind==='microphone'?stream.getAudioTracks():stream.getVideoTracks()).find(t=>t.readyState==='live');
  if(!track)throw new Error(`No live ${kind==='screen'?'screen':kind} was returned. Try choosing another source.`);
  return track.label||kind;
 }finally{for(const track of stream.getTracks())track.stop();}
}

export function capturePermissionError(error:unknown):string{
 const name=(error as {name?:string})?.name;
 if(name==='NotAllowedError'||name==='PermissionDeniedError')return 'Access was not granted, or the chooser was cancelled. You can try again or review your privacy settings.';
 if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'No matching device was found. Connect a camera or microphone, then try again.';
 if(name==='NotReadableError'||name==='TrackStartError')return 'The device could not start. It may be in use by another app; close that app and try again.';
 // Chromium's wording when the desktop handler has no screen to share, which on macOS means screen recording is not allowed yet.
 if(error instanceof Error&&/invalid capture constraints/i.test(error.message))return 'macOS has not allowed screen recording for SceneForge yet. Turn it on in Privacy & Security → Screen & System Audio Recording, then quit and reopen SceneForge.';
 return error instanceof Error?error.message:'The check did not finish. Please try again.';
}
