import {clipDuration,type Clip} from '../shared/types';

/** Clamp the actual trim delta, keeping the right edge at its original time. */
export function trimClipLeft(clip:Clip,delta:number,minimumDuration=.1):Pick<Clip,'start'|'sourceIn'|'sourceOut'> {
 const earliest=Math.max(-clip.start,-clip.sourceIn/clip.speed);
 const latest=Math.max(0,clipDuration(clip)-minimumDuration);
 const applied=Math.max(earliest,Math.min(latest,delta));
 return {start:clip.start+applied,sourceIn:clip.sourceIn+applied*clip.speed,sourceOut:clip.sourceOut};
}
