import {trackedCrop,type FaceTrack} from '../shared/face-tracking.ts';
const number=(value:number)=>value.toFixed(9);
/** One short interpolation expression per interval; never a project-sized nested expression. */
export function faceCropCommands(track:FaceTrack,options:{sourceIn:number;sourceOut:number;speed:number;sourceWidth:number;sourceHeight:number;width:number;height:number;target:string;flipX?:boolean}){
 const {sourceIn,sourceOut,speed,sourceWidth,sourceHeight,width,height,target,flipX}=options;
 if(!/^[a-zA-Z0-9_]+$/.test(target)||![sourceIn,sourceOut,speed,sourceWidth,sourceHeight,width,height].every(Number.isFinite)||speed<=0||sourceOut<=sourceIn||Math.min(sourceWidth,sourceHeight,width,height)<=0)throw Error('Invalid tracked crop interval or dimensions');
 const times=[sourceIn,...track.points.map(p=>p.time).filter(time=>time>sourceIn+1e-8&&time<sourceOut-1e-8),sourceOut];
 const positions=times.map(time=>({time:(time-sourceIn)/speed,...trackedCrop(track.points,time,sourceWidth,sourceHeight,width,height,flipX)}));
 const commands=positions.slice(0,-1).map((p,i)=>{
  const next=positions[i+1],delta=next.time-p.time;
  const expression=(key:'x'|'y')=>`${number(p[key])}+${number(next[key]-p[key])}*clip((t-${number(p.time)})/${number(delta)},0,1)`;
  return `${number(p.time)} [enter] crop@${target} x '${expression('x')}', crop@${target} y '${expression('y')}';`;
 }).join('\n');
 return {initial:positions[0],commands};
}
