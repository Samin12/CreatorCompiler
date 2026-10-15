export interface AutomationSettings { automaticTranscription:boolean; }
export type AutomationKind='transcription'|'auto-cut'|'visualize';
export interface AutomationChange {
 id:string; label:string; reason:string; start?:number; end?:number; selected:boolean;
 category:'silence'|'repeat'|'semantic'|'layout'|'chapter'|'proof';
}
export interface AutomationProposal {
 summary:string; changes:AutomationChange[]; warnings:string[]; baseRevision:string;
 beforeDuration:number; afterDuration:number;
}
export interface AutomationJob {
 id:string; projectId:string; kind:AutomationKind;
 sceneId?:string; sceneName?:string;
 status:'queued'|'running'|'ready'|'complete'|'conflict'|'failed'|'cancelled';
 progress:number; message:string; createdAt:string; updatedAt:string;
 automatic:boolean; applied:boolean; undone:boolean; error?:string;
 captionCount?:number; proposal?:AutomationProposal;
}
export interface QuickActionRequest { kind:'auto-cut'|'visualize'; semantic?:boolean; sceneId?:string; }
export interface AutomationMutation { job:AutomationJob; project:import('./types.js').Project; }
export interface CutReview {
 before:import('./types.js').Project;after:import('./types.js').Project;
 joins:Array<{id:string;label:string;originalStart:number;originalEnd:number;editedTime:number}>;
}
