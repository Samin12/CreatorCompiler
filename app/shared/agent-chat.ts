export interface AgentChatRequest {message:string;selectedClipIds:string[];range?:{start:number;end:number};playhead:number;}
export interface AgentStatus {provider:'claude-code';installed:boolean;authenticated:boolean;supported:boolean;version?:string;executable?:string;message:string;}
export interface AgentChatJob {
 id:string;projectId:string;status:'queued'|'running'|'complete'|'failed'|'cancelled';request:AgentChatRequest;
 scope:'project'|'clips'|'range';text:string;activity:string[];error?:string;changed:boolean;changeSummary?:string;
 createdAt:string;updatedAt:string;beforeRevision:string;afterRevision?:string;undone?:boolean;
}
