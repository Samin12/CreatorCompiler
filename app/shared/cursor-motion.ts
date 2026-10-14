/** Large on-screen pointer. The historical default of 24px was never calibrated. */
export const LEGACY_CURSOR_SIZE = 24;
export const LARGE_CURSOR_SIZE = 168;
/** Short follow used when a project asks for automatic cursor motion. */
export const AUTO_CURSOR_SMOOTHING = 0.62;
const HOLD_GAP = 0.12;
const FULL_TAU = 0.18;

export interface CursorSample { time:number;x:number;y:number;visible?:boolean;pressed?:boolean }
export interface CursorPose { x:number;y:number;visible:boolean;pressed:boolean }

export function cursorDrawSize(size:number):number {
 if(!Number.isFinite(size))return LARGE_CURSOR_SIZE;
 if(size===LEGACY_CURSOR_SIZE)return LARGE_CURSOR_SIZE;
 return Math.min(240,Math.max(8,size));
}

/** Stored 0 with the old 24px size means follow had not been applied yet. */
export function cursorMotionSmoothing(size:number,smoothing:number):number {
 const value=Number.isFinite(smoothing)?Math.min(1,Math.max(0,smoothing)):AUTO_CURSOR_SMOOTHING;
 if(size===LEGACY_CURSOR_SIZE&&value===0)return AUTO_CURSOR_SMOOTHING;
 return value;
}

export function materializeCursor(cursor:{size:number;smoothing:number}) {
 cursor.smoothing=cursorMotionSmoothing(cursor.size,cursor.smoothing);
 cursor.size=cursorDrawSize(cursor.size);
}

/**
 * Pointer pose at `time`.
 * Gaps longer than a short sample step hold still. Smoothing above 0 follows
 * the target with a time constant, so dense samples glide instead of stepping.
 * A hidden sample stays hidden and does not pull the pointer across the gap.
 */
export function cursorPoseAt(points:CursorSample[],time:number,smoothing:number):CursorPose|null {
 if(!points.length||!Number.isFinite(time))return null;
 const pts=points.filter(point=>Number.isFinite(point.time)&&Number.isFinite(point.x)&&Number.isFinite(point.y)).sort((a,b)=>a.time-b.time);
 if(!pts.length||time<pts[0].time)return null;
 const tau=Math.min(1,Math.max(0,smoothing))*FULL_TAU;
 let x=pts[0].x,y=pts[0].y;
 for(let i=0;i<pts.length;i++){
  const a=pts[i],b=pts[i+1];
  if(time<a.time)break;
  const dt=Math.max(0,Math.min(time,b?b.time:time)-a.time);
  if(a.visible===false){
   x=a.x;y=a.y;
   if(!b||time<b.time)return {x,y,visible:false,pressed:!!a.pressed};
   if(b.visible!==false){x=b.x;y=b.y;}
   continue;
  }
  const span=b?b.time-a.time:0;
  const moving=!!b&&b.visible!==false&&span>0&&span<=HOLD_GAP;
  if(!moving){
   if(tau===0){x=a.x;y=a.y;}
   else if(dt>0){const k=Math.exp(-dt/tau);x=a.x+(x-a.x)*k;y=a.y+(y-a.y)*k;}
  }else if(b){
   if(tau===0){const u=Math.min(1,dt/span);x=a.x+(b.x-a.x)*u;y=a.y+(b.y-a.y)*u;}
   else{
    const vx=(b.x-a.x)/span,vy=(b.y-a.y)/span,k=Math.exp(-dt/tau);
    x=a.x+vx*dt-vx*tau+(x-(a.x-vx*tau))*k;
    y=a.y+vy*dt-vy*tau+(y-(a.y-vy*tau))*k;
   }
  }
  if(!b||time<b.time)return {x,y,visible:true,pressed:!!a.pressed};
 }
 const last=pts[pts.length-1];
 return {x,y,visible:last.visible!==false,pressed:!!last.pressed};
}
