import type {Project} from '../shared/types';

/** A response may update only the snapshot that initiated it (or its identical SSE echo). */
export function canAdoptRecovery(before:Project,current:Project|null,result:Project){
 return Boolean(current&&current.id===before.id&&result.id===before.id&&(current===before||JSON.stringify(current)===JSON.stringify(before)||JSON.stringify(current)===JSON.stringify(result)));
}
export async function runGuardedProjectOperation<T extends {project:Project;revision:string}>(options:{
 projectId:string;signal?:AbortSignal;current:()=>Project|null;flush:()=>Promise<Project|undefined>;
 revision:()=>Promise<string>;operation:(snapshot:Project,revision:string)=>Promise<T>;adopt:(result:T)=>void;conflict:()=>void;
}):Promise<T>{
 options.signal?.throwIfAborted();
 if(options.current()?.id!==options.projectId)throw Error('The active project changed. Open recovery in the intended project.');
 const snapshot=await options.flush();options.signal?.throwIfAborted();
 if(!snapshot||snapshot.id!==options.projectId||options.current()!==snapshot)throw Error('The project changed before recovery. Review it again.');
 const revision=await options.revision();options.signal?.throwIfAborted();
 if(options.current()!==snapshot)throw Error('The project changed before recovery. Review it again.');
 const result=await options.operation(snapshot,revision);
 if(options.signal?.aborted)return result;
 const current=options.current();
 if(canAdoptRecovery(snapshot,current,result.project))options.adopt(result);
 else if(current?.id===snapshot.id)options.conflict();
 return result;
}
/** Cancels stale file-picker/probe completions, including after a project switch. */
export class RecoveryRequestScope{
 private generation=0;private controller:AbortController|null=null;
 stop(){this.generation++;this.controller?.abort();this.controller=null;}
 begin(){this.stop();const generation=this.generation,controller=new AbortController();this.controller=controller;return {signal:controller.signal,active:()=>this.generation===generation&&!controller.signal.aborted};}
}
export function singleReplacementPath(paths:string[]):string|null{
 if(!paths.length)return null;
 if(paths.length!==1)throw Error('Choose exactly one replacement file. No files were changed.');
 const path=paths[0].trim();if(!path)throw Error('Choose a replacement file.');return path;
}
/** A slow SSE fetch must not replace a newer clean snapshot or flag its own echo. `saved` is the saved object (compared by identity) or its JSON. */
export function projectRefreshDisposition(before:Project,current:Project|null,incoming:Project,saved:Project|null|string):'ignore'|'conflict'|'adopt'{
 if(!current||current.id!==incoming.id)return 'ignore';
 const clean=typeof saved==='string'?JSON.stringify(current)===saved:current===saved;
 if(current!==before&&clean)return 'ignore';
 return clean?'adopt':'conflict';
}
