import type {ExportRecord} from '../shared/export-history';
import {projectDuration,type ExportOptions,type Project} from '../shared/types';

export type ExportRange={mode:'full'|'scene'|'custom';sceneId:string;start:number;end:number};
export const activeExport=(record:ExportRecord)=>record.status==='queued'||record.status==='running';

/** Late lists and polls must not replace a newer accepted job state. */
export function mergeExportRecords(current:ExportRecord[],incoming:ExportRecord[],projectId:string){
 const byId=new Map(current.filter(record=>record.projectId===projectId).map(record=>[record.id,record]));
 for(const record of incoming){
  if(record.projectId!==projectId)continue;
  const old=byId.get(record.id);
  if(!old||record.revision>old.revision||(record.revision===old.revision&&record.updatedAt>=old.updatedAt&&!(!activeExport(old)&&activeExport(record))))byId.set(record.id,record);
 }
 return [...byId.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id));
}

/** A paged list can omit an older running export; keep its visible receipt live. */
export async function refreshActiveExportRecords(listed:ExportRecord[],activeIds:string[],read:(id:string)=>Promise<ExportRecord>):Promise<ExportRecord[]>{
 const present=new Set(listed.map(record=>record.id));
 const missing=[...new Set(activeIds)].filter(id=>!present.has(id));
 return [...listed,...await Promise.all(missing.map(read))];
}

export function resolveExportOptions(project:Project,options:ExportOptions,choice:ExportRange):ExportOptions{
 const total=projectDuration(project);let range:ExportOptions['range'];
 if(choice.mode==='custom')range={start:choice.start,end:choice.end};
 if(choice.mode==='scene'){
  const scene=project.scenes.find(scene=>scene.id===choice.sceneId);
  if(!scene)throw Error('This scene changed. Choose a scene again before exporting.');
  const next=project.scenes.filter(item=>item.start>scene.start).sort((a,b)=>a.start-b.start)[0];
  range={start:scene.start,end:scene.start+(scene.duration||Math.max(0,(next?.start??total)-scene.start))};
 }
 if(range&&(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||range.end>total+.001))throw Error('Choose an export range within the saved timeline, with the end after the start.');
 return {...options,range};
}

/** One dialog lifetime can include concurrent reads, but never a previous project. */
export class ExportSession{
 private generation=0;private controller=new AbortController();private projectId='';
 reset(projectId:string){this.close();this.projectId=projectId;this.controller=new AbortController();}
 close(){this.generation++;this.controller.abort();}
 request(){const generation=this.generation,projectId=this.projectId,signal=this.controller.signal;return {projectId,signal,active:()=>generation===this.generation&&!signal.aborted};}
}

export async function exportCurrentVersion<T>(request:ReturnType<ExportSession['request']>,flush:()=>Promise<Project|undefined>,options:ExportOptions,range:ExportRange,revision:(p:Project)=>Promise<string>,start:(p:Project,options:ExportOptions,revision:string,signal:AbortSignal)=>Promise<T>):Promise<T|undefined>{
 const snapshot=await flush();if(!request.active())return;
 if(!snapshot||snapshot.id!==request.projectId)throw Error('The active project changed. Open Export in the intended project.');
 const resolved=resolveExportOptions(snapshot,options,range),expected=await revision(snapshot);if(!request.active())return;
 const record=await start(snapshot,resolved,expected,request.signal);return request.active()?record:undefined;
}
