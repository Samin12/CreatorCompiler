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
/** Seconds of samples either side of a time that the camera-follow smoothing reads. Track requests pad by this much so
 * every preview tile and export window sees the same neighbors and frames the same crop. */
export const FACE_FOLLOW_SUPPORT=3;
const FOLLOW_RADIUS=.75,ANCHOR_RADIUS=FACE_FOLLOW_SUPPORT,DEAD_ZONE=.05,PRESENCE=.5;
const biweight=(d:number,r:number)=>{const u=d/r;return u>=1?0:(1-u*u)**2;};
const smoothstep=(n:number)=>{const u=clamp(n,0,1);return u*u*(3-2*u);};
function lowerBound(points:FaceTrackPoint[],time:number){let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].time<time)lo=mid+1;else hi=mid;}return lo;}
function linearCrop(points:FaceTrackPoint[],time:number,sourceWidth:number,sourceHeight:number,width:number,height:number,flipX:boolean){
 let lo=0,hi=points.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(points[mid].time<=time)lo=mid;else hi=mid-1;}
 const a=points[lo],b=points[Math.min(lo+1,points.length-1)];
 const left=faceCrop(a?.face??null,sourceWidth,sourceHeight,width,height,flipX);
 if(!a||!b||b.time<=a.time||time<=a.time)return left;
 const right=faceCrop(b.face,sourceWidth,sourceHeight,width,height,flipX),mix=clamp((time-a.time)/(b.time-a.time),0,1);
 return {...left,x:left.x+(right.x-left.x)*mix,y:left.y+(right.y-left.y)*mix};
}
/** Smooth camera follow, stateless so it never depends on where playback or an export window began.
 * A short symmetric kernel over detected faces removes detector jitter; a long one gives a steady anchor. Offsets from the
 * anchor inside a dead zone (5% of the crop) are ignored, then blend continuously back to the short path, so small head
 * movements only drift the frame imperceptibly over a few seconds while real moves are followed promptly and in full.
 * Missed detections never pull the frame: it eases back to center only as faces become rare across the long window. */
export function trackedCrop(points:FaceTrackPoint[],time:number,sourceWidth:number,sourceHeight:number,width:number,height:number,flipX=false){
 const base=faceCrop(null,sourceWidth,sourceHeight,width,height,flipX);
 if(points.length<2)return linearCrop(points,time,sourceWidth,sourceHeight,width,height,flipX);
 let sx=0,sy=0,sw=0,lx=0,ly=0,lw=0,all=0;
 for(let i=lowerBound(points,time-ANCHOR_RADIUS);i<points.length&&points[i].time<time+ANCHOR_RADIUS;i++){
  const point=points[i],d=Math.abs(point.time-time),long=biweight(d,ANCHOR_RADIUS);all+=long;if(!point.face)continue;
  const crop=faceCrop(point.face,sourceWidth,sourceHeight,width,height,flipX),short=biweight(d,FOLLOW_RADIUS);
  sx+=crop.x*short;sy+=crop.y*short;sw+=short;lx+=crop.x*long;ly+=crop.y*long;lw+=long;
 }
 if(lw<=1e-9)return base;
 const ax=lx/lw,ay=ly/lw,fx=sw>1e-9?sx/sw:ax,fy=sw>1e-9?sy/sw:ay,presence=smoothstep(lw/all/PRESENCE);
 const follow=(short:number,anchor:number,zone:number)=>{const diff=short-anchor;return anchor+diff*smoothstep(Math.abs(diff)/zone-1);};
 const x=follow(fx,ax,DEAD_ZONE*width),y=follow(fy,ay,DEAD_ZONE*height);
 return {...base,x:clamp(base.x+(x-base.x)*presence,0,base.maxX),y:clamp(base.y+(y-base.y)*presence,0,base.maxY)};
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
