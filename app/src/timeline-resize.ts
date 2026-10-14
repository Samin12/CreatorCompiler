export const TIMELINE_HEIGHT_KEY='sceneforge.timeline-height';
export const DEFAULT_TIMELINE_HEIGHT=200;
export interface TimelineHeightBounds {min:number;max:number;}
/** Keep the transport visible and reserve preview room where the window allows it. */
export function timelineHeightBounds(containerHeight:number):TimelineHeightBounds {
 const available=Math.max(0,Math.floor(Number.isFinite(containerHeight)?containerHeight:0)-38);
 const preview=Math.min(120,Math.max(0,available-80)),max=available-preview;
 return {min:Math.min(120,max),max};
}
export function clampTimelineHeight(value:number,bounds:TimelineHeightBounds):number {
 return Math.round(Math.max(bounds.min,Math.min(bounds.max,Number.isFinite(value)?value:DEFAULT_TIMELINE_HEIGHT)));
}
export function parseTimelineHeight(value:string|null):number {
 if(value===null||!value.trim())return DEFAULT_TIMELINE_HEIGHT;
 const height=Number(value);return Number.isFinite(height)&&height>=0&&height<=10000?height:DEFAULT_TIMELINE_HEIGHT;
}
