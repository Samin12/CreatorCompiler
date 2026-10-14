import type {Project} from '../shared/types';import {projectDuration} from '../shared/types';import type {AgentChatRequest} from '../shared/agent-chat';
export function buildChatRequest(project:Project,selectedIds:ReadonlySet<string>,range:{start:number;end:number}|null,playhead:number,message:string):AgentChatRequest{
 const prompt=message.trim();if(!prompt)throw new Error('Describe the edit you want to make.');
 const clips=new Set(project.clips.map(c=>c.id));const ids=[...selectedIds];if(ids.some(id=>!clips.has(id)))throw new Error('Some selected items are not available media clips. Select clips again, or clear the selection explicitly.');
 if(range&&(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||range.end>projectDuration(project)+.001))throw new Error('Choose a nonempty time range inside this project.');
 return {message:prompt,selectedClipIds:ids,...(range?{range:{start:range.start,end:range.end}}:{}),playhead:Math.max(0,Number.isFinite(playhead)?playhead:0)};
}
