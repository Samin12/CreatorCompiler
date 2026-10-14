/** Source-normalized observation. A partially visible face can extend past a frame edge. */
export interface FaceBounds {x:number;y:number;width:number;height:number;confidence:number;}
export interface FaceTrackPoint {time:number;face:FaceBounds|null;}
export interface FaceTrack {version:1;sampleRate:4;start:number;end:number;points:FaceTrackPoint[];subject:'largest-face';}
export const FACE_TILE_SECONDS=10;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
/** Keep plausible partial observations intact so their true center is not shifted by clipping. */
export function isFaceBounds(value:unknown):value is FaceBounds {
 if(!value||typeof value!=='object')return false;
 const f=value as FaceBounds;
 if(!(['x','y','width','height','confidence'] as const).every(k=>Number.isFinite(f[k]))||f.confidence<.5||f.confidence>1||f.width<=0||f.height<=0)return false;
 // Bound malformed model/cache data, while allowing a face to cross any edge.
 if(f.width>2||f.height>2||f.x< -1||f.y< -1||f.x+f.width>2||f.y+f.height>2)return false;
 return Math.min(1,f.x+f.width)>Math.max(0,f.x)&&Math.min(1,f.y+f.height)>Math.max(0,f.y);
}
export function faceCrop(face:FaceBounds|null,sourceWidth:number,sourceHeight:number,width:number,height:number,flipX=false){
 const scale=Math.max(width/sourceWidth,height/sourceHeight);
 const scaledWidth=Math.ceil(sourceWidth*scale/2)*2,scaledHeight=Math.ceil(sourceHeight*scale/2)*2;
 const maxX=Math.max(0,scaledWidth-width),maxY=Math.max(0,scaledHeight-height);
 const cx=face?(flipX?1-face.x-face.width/2:face.x+face.width/2):.5;
 return {x:face?clamp(scaledWidth*cx-width/2,0,maxX):maxX/2,y:face?clamp(scaledHeight*(face.y+face.height/2)-height*.4,0,maxY):maxY/2,maxX,maxY};
}
/** Interpolate bounded crop coordinates, including gentle return to center when no face is detected. */
export function trackedCrop(points:FaceTrackPoint[],time:number,sourceWidth:number,sourceHeight:number,width:number,height:number,flipX=false){
 let lo=0,hi=points.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(points[mid].time<=time)lo=mid;else hi=mid-1;}
 const a=points[lo],b=points[Math.min(lo+1,points.length-1)];
 const left=faceCrop(a?.face??null,sourceWidth,sourceHeight,width,height,flipX);
 if(!a||!b||b.time<=a.time||time<=a.time)return left;
 const right=faceCrop(b.face,sourceWidth,sourceHeight,width,height,flipX),mix=clamp((time-a.time)/(b.time-a.time),0,1);
 return {...left,x:left.x+(right.x-left.x)*mix,y:left.y+(right.y-left.y)*mix};
}
/** Symmetric finite support makes each absolute-time tile independent of clip and export boundaries. */
export function smoothFaceSamples(points:FaceTrackPoint[]):FaceTrackPoint[]{
 return points.map((point,i)=>{
  if(!point.face)return point;
  const current=point.face,neighbors=[{face:current,weight:2}];
  for(const other of [points[i-1],points[i+1]])if(other?.face&&Math.abs(other.time-point.time)<=.4){
   const distance=Math.hypot(other.face.x-current.x,other.face.y-current.y);
   if(distance<.18)neighbors.push({face:other.face,weight:1});
  }
  const total=neighbors.reduce((n,p)=>n+p.weight,0),face={...current};
  for(const key of ['x','y','width','height'] as const)face[key]=neighbors.reduce((n,p)=>n+p.face[key]*p.weight,0)/total;
  return {time:point.time,face};
 });
}
