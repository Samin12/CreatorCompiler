import {defaultTransform,type Canvas,type Project,type Transform} from './types.js';

type CanvasSize=Pick<Canvas,'width'|'height'>;
/** Independently authored preset from observed normalized composition dimensions. */
export function creatorShadow(canvas:CanvasSize):NonNullable<Transform['shadow']>{
 const scale=Math.max(1,Math.min(canvas.width,canvas.height))/1080;
 return {x:0,y:20*scale,blur:20*scale,color:'#00000064'};
}
export function creatorCameraTransform(canvas:CanvasSize):Transform{
 return {...defaultTransform(),x:.7966337703449105,y:.2126346230506897,width:.1843080371618271,height:.5747307538986206,fit:'cover',borderRadius:19.2*Math.max(1,Math.min(canvas.width,canvas.height))/1080,shadow:creatorShadow(canvas)};
}
export function creatorScreenTransform(canvas:CanvasSize):Transform{
 return {...defaultTransform(),x:.01,y:.0177778,width:.7675755,height:.9644444,fit:'cover',borderRadius:19.2*Math.max(1,Math.min(canvas.width,canvas.height))/1080,shadow:creatorShadow(canvas)};
}
/** Explicit user action; preserve timing, color effects, rotation and opacity. */
export function applyCreatorLayout(project:Project):void{
 for(const clip of project.clips){
  if(clip.track!=='screen'&&clip.track!=='camera'||clip.zIndex===-1000)continue;
  const {rotation:_,opacity:__,...geometry}=clip.track==='camera'?creatorCameraTransform(project.canvas):creatorScreenTransform(project.canvas);
  Object.assign(clip.transform,geometry);
 }
}
