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
export function selectedChangeIds(job:AutomationJob,selection:ReadonlySet<string>):string[]{return job.proposal?.changes.filter(change=>selection.has(change.id)).map(change=>change.id)??[];}
export const automationRunning=(job:AutomationJob)=>job.status==='queued'||job.status==='running';
