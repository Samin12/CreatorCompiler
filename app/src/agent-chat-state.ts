import type {AgentChatJob} from '../shared/agent-chat';
const terminal=(job:AgentChatJob)=>!['queued','running'].includes(job.status);
export function mergeChatJobs(current:readonly AgentChatJob[],incoming:readonly AgentChatJob[]):AgentChatJob[]{
 const jobs=new Map(current.map(job=>[job.id,job]));
 for(const next of incoming){const previous=jobs.get(next.id);if(previous){
  if(previous.undone&&!next.undone)continue;
  if(terminal(previous)&&!terminal(next))continue;
  if(previous.updatedAt>next.updatedAt)continue;
  if(previous.updatedAt===next.updatedAt&&terminal(previous)&&!next.undone)continue;
 }jobs.set(next.id,next);}
 return [...jobs.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-12);
}
