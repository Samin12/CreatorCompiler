import type {Zoom} from './types';

/** Retain the original ease-in/out phase when a timed zoom is split or rearranged. */
export function zoomTiming(zoom:Zoom){
 const offset=zoom.effectTiming?.offset??0,duration=zoom.effectTiming?.duration??zoom.duration;
 return {offset,duration,ramp:Math.max(.01,Math.min(.3,duration/3))};
}
export function zoomScaleAt(zoom:Zoom,time:number):number {
 if(time<zoom.start||time>=zoom.start+zoom.duration)return 1;
 if(zoom.easing!=='smooth')return zoom.scale;
 const {offset,duration,ramp}=zoomTiming(zoom),elapsed=time-zoom.start+offset;
 return Math.round((1+(zoom.scale-1)*Math.max(0,Math.min(1,elapsed/ramp,(duration-elapsed)/ramp)))*1e9)/1e9;
}
