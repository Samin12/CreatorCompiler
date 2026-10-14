import type {Project} from '../shared/types';
export interface BorumiExportPlan {supported:boolean;blockers:string[];warnings:string[];changes?:Array<{kind:string;id:string;fields:string[]}>;sourceFormat:'preserved-borumi'|'new-from-native-schema';history:'new-root';}
export interface BorumiPlanResponse {revision:string;plan:BorumiExportPlan;requiresTemplate:boolean;}
export interface BorumiCopyResult {path:string;projectId:string;sourceRevision:string;nativeValidation:'pending';plan:BorumiExportPlan;filesCopied?:number;mediaCount?:number;bytesCopied:number;}
/** Autosave timestamps do not change the content being reviewed. Server revision still guards export. */
export function borumiReviewKey(project:Project):string {const {updatedAt,...content}=project;return JSON.stringify(content);}
export function needsBorumiReimport(project:Project):boolean{return project.importMetadata?.sourceApp==='Borumi'&&!project.importMetadata.roundtrip;}
const labels:Record<string,string>={name:'Name',script:'Script',width:'Width',height:'Height',gain:'Audio gain',start:'Timeline start',sourceIn:'Source in',sourceOut:'Source out',speed:'Speed',flipX:'Horizontal flip',text:'Text',duration:'Duration',x:'Left',y:'Top'};
export function describeBorumiChange(project:Project,change:NonNullable<BorumiExportPlan['changes']>[number]){
 const item=change.kind==='project'?project:change.kind==='canvas'?project.canvas:change.kind==='scene'?project.scenes.find(x=>x.id===change.id):change.kind==='clip'?project.clips.find(x=>x.id===change.id):project.elements.find(x=>x.id===change.id);
 const value=(field:string)=>{let v=(item as unknown as Record<string,unknown>|undefined)?.[field];if(field==='flipX')v=(item as unknown as {effects?:{flipX:boolean}})?.effects?.flipX;
  if(typeof v==='boolean')return v?'On':'Off';if(typeof v==='number')return ['start','sourceIn','sourceOut','duration'].includes(field)?`${Number(v.toFixed(3))} s`:field==='gain'||field==='speed'?`${Number(v.toFixed(3))}×`:String(v);
  return typeof v==='string'?v.length>140?v.slice(0,140)+'…':v:'Updated';};
 const name=(item as unknown as {name?:string})?.name||({canvas:'Canvas',text:'Text overlay'} as Record<string,string>)[change.kind]||change.kind;
 return {name,values:change.fields.map(field=>({label:labels[field]||field,value:value(field)}))};
}
