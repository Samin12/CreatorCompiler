export interface SelectionRect {x:number;y:number;width:number;height:number}
export interface SelectionItem extends SelectionRect {id:string}
export function rectangleBetween(a:{x:number;y:number},b:{x:number;y:number}):SelectionRect{return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
export function itemsInRectangle(rect:SelectionRect,items:readonly SelectionItem[],existing:readonly string[]=[]):string[]{
 const ids=new Set(existing);for(const item of items)if(item.x<rect.x+rect.width&&item.x+item.width>rect.x&&item.y<rect.y+rect.height&&item.y+item.height>rect.y)ids.add(item.id);return [...ids];
}
export function orderedTimeRange(a:number,b:number,duration:number):{start:number;end:number}|null{const start=Math.max(0,Math.min(duration,a,b)),end=Math.max(0,Math.min(duration,Math.max(a,b)));return end-start>=.001?{start,end}:null;}
