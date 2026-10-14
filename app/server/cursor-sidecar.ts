import {clipDuration,type Canvas,type Clip,type CursorPoint,type Media} from '../shared/types.js';

export interface RecordedCursorPoint {time:number;x:number;y:number;pressed:boolean;cursorKind:number}
/** Observed Borumi v1 framing. Coordinates normalize against the recorded logical display size. */
export function decodeCursorSidecar(bytes:Buffer):RecordedCursorPoint[]{
 if(bytes.length<4||bytes.readUInt32BE(0)!==1)throw new Error('Unsupported cursor sidecar version.');
 if(bytes.length>32*1024*1024)throw new Error('Cursor sidecar exceeds the 32 MB import limit.');
 const points:RecordedCursorPoint[]=[];let offset=4,pressed=false;
 while(offset<bytes.length){
  if(offset+4>bytes.length)throw new Error('Truncated cursor event length.');
  const length=bytes.readUInt32BE(offset);offset+=4;
  if(length!==30||offset+length>bytes.length)throw new Error('Unsupported or truncated cursor event.');
  const kind=bytes[offset],x=bytes.readFloatBE(offset+1),y=bytes.readFloatBE(offset+5),width=bytes.readFloatBE(offset+9),height=bytes.readFloatBE(offset+13);
  const ticks=bytes.readBigUInt64BE(offset+17),scale=bytes.readUInt32BE(offset+25),cursorKind=bytes[offset+29];
  if(![1,2,3].includes(kind)||![x,y,width,height].every(Number.isFinite)||width<=0||height<=0||!scale||ticks>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid cursor event fields.');
  // Native parser/TryFrom/CursorAnalyzer disassembly confirms 1 down, 2 up, 3 movement.
  if(kind===1)pressed=true;else if(kind===2)pressed=false;
  const time=Number(ticks)/scale;
  points.push({time,x:x/width,y:y/height,pressed,cursorKind});offset+=length;
 }
 return points.sort((a,b)=>a.time-b.time);
}

function atOrBefore(points:RecordedCursorPoint[],time:number){let low=0,high=points.length;while(low<high){const mid=(low+high)>>>1;if(points[mid].time<=time+1e-8)low=mid+1;else high=mid}return points[low-1]}

/** Bake source-clock samples through independent trims, speed, contain/cover and layout transforms. */
export function cursorForTimeline(clips:Clip[],mediaById:Map<string,Media>,events:Map<string,RecordedCursorPoint[]>,canvas:Canvas):CursorPoint[]{
 // Native frame evidence confirms recorded cursors are composited above video.
 // A higher screen without a cursor sidecar must not suppress a lower source's cursor.
 const screens=clips.filter(c=>c.track==='screen'&&c.transform.opacity>0&&(events.get(c.mediaId)?.length??0)>0).map(c=>({clip:c,end:c.start+clipDuration(c)})).sort((a,b)=>(b.clip.zIndex??0)-(a.clip.zIndex??0));
 const times=new Set<number>([0]);
 for(const {clip:c,end} of screens){times.add(c.start);times.add(end);for(const point of events.get(c.mediaId)??[])if(point.time>=c.sourceIn&&point.time<c.sourceOut)times.add(c.start+(point.time-c.sourceIn)/c.speed)}
 const out:CursorPoint[]=[];
 for(const time of [...times].sort((a,b)=>a-b)){
  const top=screens.find(s=>s.clip.start<=time+1e-8&&s.end>time+1e-8)?.clip;
  const samples=top&&events.get(top.mediaId),media=top&&mediaById.get(top.mediaId),sample=top&&samples&&atOrBefore(samples,top.sourceIn+(time-top.start)*top.speed);
  let point:CursorPoint={time,x:out.at(-1)?.x??0,y:out.at(-1)?.y??0,visible:false,pressed:false};
  if(top&&media&&sample){
   const t=top.transform,bw=t.width*canvas.width,bh=t.height*canvas.height;
   const mw=media.width||bw,mh=media.height||bh,scale=t.fit==='cover'?Math.max(bw/mw,bh/mh):Math.min(bw/mw,bh/mh);
   let px=(bw-mw*scale)/2+sample.x*mw*scale,py=(bh-mh*scale)/2+sample.y*mh*scale;
   const visible=px>=0&&px<=bw&&py>=0&&py<=bh;
   if(top.effects.flipX)px=bw-px;
   const angle=t.rotation*Math.PI/180,dx=px-bw/2,dy=py-bh/2;
   px=bw/2+dx*Math.cos(angle)-dy*Math.sin(angle);py=bh/2+dx*Math.sin(angle)+dy*Math.cos(angle);
   point={time,x:t.x+px/canvas.width,y:t.y+py/canvas.height,pressed:sample.pressed,visible};
  }
  const previous=out.at(-1);
  if(!previous||previous.x!==point.x||previous.y!==point.y||previous.pressed!==point.pressed||previous.visible!==point.visible){
   // Sidecars are event streams, so silence means a stationary pointer. The
   // renderer interpolates points: retain that hold instead of drifting for
   // seconds toward the next event or newly selected source. Short movement
   // samples retain their timing; sparse changes ease for at most one frame.
   const frame=1/Math.max(1,canvas.fps);
   if(previous?.visible!==false&&point.visible!==false&&previous&&
     (previous.x!==point.x||previous.y!==point.y)&&time-previous.time>2*frame){
    out.push({...previous,time:time-frame});
   }
   out.push(point);
  }
 }
 return out;
}
