import type {AutomationJob} from '../shared/automation';
const finished=(job:AutomationJob)=>['complete','conflict','failed','cancelled'].includes(job.status);
/** Polling and mutation responses may arrive in either order. Never resurrect finished work. */
export function mergeAutomationJobs(current:readonly AutomationJob[],incoming:readonly AutomationJob[]):AutomationJob[]{
 const result=new Map(current.map(job=>[job.id,job]));
 for(const next of incoming){const previous=result.get(next.id);if(previous){
  if(previous.updatedAt>next.updatedAt)continue;
  if(previous.undone&&!next.undone)continue;
  if(previous.applied&&!next.applied)continue;
  if(finished(previous)&&!finished(next))continue;
 }result.set(next.id,next);}
 return [...result.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
}
/** Returns `previous` when a refresh changed nothing, and otherwise reuses unchanged job objects, so a poll without news does not re-render. */
export function reuseAutomationJobs(previous:readonly AutomationJob[],next:AutomationJob[]):AutomationJob[]{
 const byId=new Map(previous.map(job=>[job.id,job]));let same=previous.length===next.length;
 const result=next.map((job,i)=>{const old=byId.get(job.id),kept=old&&(old===job||JSON.stringify(old)===JSON.stringify(job))?old:job;if(kept!==previous[i])same=false;return kept;});
 return same?previous as AutomationJob[]:result;
}
export function selectedChangeIds(job:AutomationJob,selection:ReadonlySet<string>):string[]{return job.proposal?.changes.filter(change=>selection.has(change.id)).map(change=>change.id)??[];}
export const automationRunning=(job:AutomationJob)=>job.status==='queued'||job.status==='running';
