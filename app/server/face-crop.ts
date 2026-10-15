import {trackedCrop,type FaceTrack} from '../shared/face-tracking.ts';
const number=(value:number)=>value.toFixed(9);
/** One short interpolation expression per interval of the simplified follow path; never a project-sized nested expression. */
export function faceCropCommands(track:FaceTrack,options:{sourceIn:number;sourceOut:number;speed:number;sourceWidth:number;sourceHeight:number;width:number;height:number;target:string;flipX?:boolean}){
 const {sourceIn,sourceOut,speed,sourceWidth,sourceHeight,width,height,target,flipX}=options;
 if(!/^[a-zA-Z0-9_]+$/.test(target)||![sourceIn,sourceOut,speed,sourceWidth,sourceHeight,width,height].every(Number.isFinite)||speed<=0||sourceOut<=sourceIn||Math.min(sourceWidth,sourceHeight,width,height)<=0)throw Error('Invalid tracked crop interval or dimensions');
 // The smoothed follow path is curved, so it is sampled every 1/30 s of source time and then simplified: points that the
 // straight line between their kept neighbors already reproduces within a quarter pixel are dropped, so a held frame is one command.
 const step=1/30,count=Math.min(20000,Math.ceil((sourceOut-sourceIn)/step)),times=[...Array.from({length:count},(_,i)=>sourceIn+i*(sourceOut-sourceIn)/count),sourceOut];
 const sampled=times.map(time=>({time:(time-sourceIn)/speed,...trackedCrop(track.points,time,sourceWidth,sourceHeight,width,height,flipX)}));
 const positions=[sampled[0]];
 for(let i=1;i<sampled.length-1;i++){const a=positions[positions.length-1],b=sampled[i],c=sampled[i+1],mix=(b.time-a.time)/(c.time-a.time);if(Math.abs(a.x+(c.x-a.x)*mix-b.x)>.25||Math.abs(a.y+(c.y-a.y)*mix-b.y)>.25)positions.push(b);}
 positions.push(sampled[sampled.length-1]);
 const commands=positions.slice(0,-1).map((p,i)=>{
  const next=positions[i+1],delta=next.time-p.time;
  const expression=(key:'x'|'y')=>`${number(p[key])}+${number(next[key]-p[key])}*clip((t-${number(p.time)})/${number(delta)},0,1)`;
  return `${number(p.time)} [enter] crop@${target} x '${expression('x')}', crop@${target} y '${expression('y')}';`;
 }).join('\n');
 return {initial:positions[0],commands};
}
