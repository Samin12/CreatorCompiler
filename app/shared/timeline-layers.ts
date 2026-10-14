import type {Clip,Project,TrackKind} from './types';

export type LayerKind='video'|'audio';
export interface TimelineLayerRow {id:string;name:string;kind:LayerKind;order:number;track?:TrackKind;legacyZ?:number}
const roles:Record<TrackKind,{name:string;kind:LayerKind;order:number}>={
 overlay:{name:'Overlays',kind:'video',order:2},camera:{name:'Camera',kind:'video',order:1},screen:{name:'Screen / Video',kind:'video',order:0},
 audio:{name:'Audio',kind:'audio',order:1},music:{name:'Music',kind:'audio',order:0},
};
export const clipLayerKind=(clip:Clip):LayerKind=>roles[clip.track].kind;
const roleId=(track:TrackKind)=>`role:${track}`;
const legacyId=(clip:Clip)=>`legacy:${clip.track}:${clip.zIndex}`;
function assignedRow(clip:Clip,project:Project):TimelineLayerRow|undefined{
 const role=Object.entries(roles).find(([track])=>roleId(track as TrackKind)===clip.layerId);
 if(role&&role[1].kind===clipLayerKind(clip))return {id:clip.layerId!,track:role[0] as TrackKind,...role[1]};
 return project.timelineLayers?.find(layer=>layer.id===clip.layerId&&layer.kind===clipLayerKind(clip));
}
/** Unassigned clips retain the exact pre-layer renderer order, including imported backgrounds. */
export function clipCompositeOrder(clip:Clip,project:Project):number{return assignedRow(clip,project)?.order??clip.zIndex??roles[clip.track].order;}
export function clipLayerRowId(clip:Clip,project:Project):string{
 return assignedRow(clip,project)?.id??(clip.zIndex!==undefined&&clip.zIndex!==roles[clip.track].order?legacyId(clip):roleId(clip.track));
}
/** The top video row is the highest composite layer. Explicit old z-orders remain visible. */
export function timelineRows(project:Project):TimelineLayerRow[]{
 const rows:TimelineLayerRow[]=Object.entries(roles).map(([track,value])=>({id:roleId(track as TrackKind),track:track as TrackKind,...value}));
 rows.push(...(project.timelineLayers??[]));
 const seen=new Set(rows.map(row=>row.id));
 for(const clip of project.clips){const id=clipLayerRowId(clip,project);if(seen.has(id))continue;seen.add(id);rows.push({id,track:clip.track,name:`${roles[clip.track].name} · layer ${clip.zIndex}`,kind:clipLayerKind(clip),order:clipCompositeOrder(clip,project),legacyZ:clip.zIndex});}
 return rows.sort((a,b)=>(a.kind===b.kind?b.order-a.order:a.kind==='video'?-1:1)||a.id.localeCompare(b.id));
}
export type LayerDestination={kind:'existing';rowId:string}|{kind:'new';beforeId:string|null;afterId:string|null};
/** Mutates only selected same-kind layer assignments. Time, source role, and old zIndex stay intact. */
export function moveClipsToLayer(project:Project,ids:ReadonlySet<string>,anchorId:string,destination:LayerDestination,makeId:()=>string=()=>globalThis.crypto.randomUUID()):void{
 const anchor=project.clips.find(clip=>clip.id===anchorId);if(!anchor)return;
 const kind=clipLayerKind(anchor),rows=timelineRows(project).filter(row=>row.kind===kind),anchorIndex=rows.findIndex(row=>row.id===clipLayerRowId(anchor,project));
 const moving=project.clips.filter(clip=>ids.has(clip.id)&&clipLayerKind(clip)===kind);
 if(!moving.length||anchorIndex<0)return;
 const sourceIndices=new Map(moving.map(clip=>[clip.id,rows.findIndex(row=>row.id===clipLayerRowId(clip,project))]));
 let serial=1;const names=new Set((project.timelineLayers??[]).map(row=>row.name));
 const newRow=(before:TimelineLayerRow|undefined,after:TimelineLayerRow|undefined):TimelineLayerRow=>{
  let name='';do{name=`${kind==='video'?'Video':'Audio'} layer ${serial++}`;}while(names.has(name));names.add(name);
  const order=before&&after?(before.order+after.order)/2:before?before.order-1:after?after.order+1:0;
  const row={id:makeId(),name,kind,order};(project.timelineLayers??=[]).push(row);return row;
 };
 let target:number;
 if(destination.kind==='existing'){target=rows.findIndex(row=>row.id===destination.rowId);if(target<0)return;}
 else{
  target=destination.beforeId?rows.findIndex(row=>row.id===destination.beforeId):rows.length;
  if(target<0||destination.afterId&&rows[target-1]?.id!==destination.afterId)return;
  if(rows[target-1]&&rows[target]&&rows[target-1].order<=rows[target].order)return;
  rows.splice(target,0,newRow(rows[target-1],rows[target]));
 }
 const destinations=new Map(moving.map(clip=>[clip.id,target+sourceIndices.get(clip.id)!-anchorIndex]));
 const lowest=Math.min(...destinations.values()),highest=Math.max(...destinations.values());
 const prefix=Math.max(0,-lowest);
 for(let index=0;index<prefix;index++)rows.unshift(newRow(undefined,rows[0]));
 while(rows.length<=highest+prefix)rows.push(newRow(rows.at(-1),undefined));
 const persistedLegacy=new Map<string,string>();
 for(const clip of moving){const row=rows[destinations.get(clip.id)!+prefix];let id=row.id;
  if(row.legacyZ!==undefined){id=persistedLegacy.get(row.id)??'';if(!id){id=makeId();(project.timelineLayers??=[]).push({id,name:row.name,kind:row.kind,order:row.order});persistedLegacy.set(row.id,id);}}
  clip.layerId=id;
 }
}
