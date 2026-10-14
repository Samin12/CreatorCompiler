/** Rendered timeline window in content pixels. Scroll is quantized to quarter-viewport steps with a step of overscan per side, so scrolling re-renders a few times per screen instead of on every scroll event. */
export interface TimelineWindow {left:number;right:number;width:number}
export function timelineWindow(scrollLeft:number,width:number):TimelineWindow{
 const viewport=Math.max(0,Number.isFinite(width)?width:0),step=Math.max(64,Math.round(viewport/4)),base=Math.floor(Math.max(0,Number.isFinite(scrollLeft)?scrollLeft:0)/step)*step;
 return {left:Math.max(0,base-step),right:base+viewport+2*step,width:viewport};
}
export const sameTimelineWindow=(a:TimelineWindow,b:TimelineWindow)=>a.left===b.left&&a.right===b.right&&a.width===b.width;
