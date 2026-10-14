export type ScreenCaptureMode='display'|'window'|'region';

/** Recording is blocked until the user picks the native source. The permission grant alone does not open a preview. */
export function screenChoicePrompt(mode:ScreenCaptureMode):string{
 if(mode==='window')return 'Choose an application window in the screen panel. The preview stays off until you pick one.';
 if(mode==='region')return 'Choose a display in the screen panel, then the region. Recording stays off until that area is selected.';
 return 'Choose a display in the screen panel. The preview stays off until you pick one.';
}
export function screenPreviewPrompt(mode:ScreenCaptureMode):string{
 if(mode==='window')return 'Choose an application window to see it here.';
 if(mode==='region')return 'Choose a display, then select the region.';
 return 'Choose a display to see it here.';
}
/** Empty desktop source list after enumeration. A granted permission with no sources is not treated as a successful preview. */
export function screenSourceListNotice(input:{loaded:boolean;matchCount:number;mode:ScreenCaptureMode;permission?:string}):string|null{
 if(!input.loaded||input.matchCount>0)return null;
 if(input.permission==='granted')return 'Screen recording is allowed, but macOS did not return a matching window or display. Quit SceneForge and open it again, then choose the source.';
 if(input.permission==='denied'||input.permission==='restricted')return 'Screen recording access is off for this build. Allow SceneForge in Screen & System Audio Recording, then quit and reopen it.';
 if(input.permission==='not-determined')return 'Screen recording permission has not been granted yet. Open Mac setup and allow SceneForge, then choose a source.';
 return input.mode==='window'?'No application windows are available. Open the window you want, then refresh.':'No displays are available. Connect a display, then refresh.';
}
