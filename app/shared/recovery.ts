import type {Media,Project} from './types.js';

export interface TrashProjectSummary {
 id:string; projectId:string; name:string; trashedAt:string; revision:string;
 duration:number; mediaCount:number; sceneCount:number; collision:boolean;
}
export interface TrashRestoreResult {project:Project;revision:string;restoredAsCopy:boolean;}
export type MediaAvailability='available'|'missing'|'unreadable'|'not-file';
export interface MediaRecoveryItem {
 mediaId:string;name:string;path:string;kind:Media['kind'];status:MediaAvailability;
 catalogStatus:'ok'|'missing'|'mismatch'|'invalid';catalogPath?:string;
 clipIds:string[];requiredSourceEnd:number;usedAsBackground:boolean;
}
export interface MediaRecoveryInspection {projectId:string;revision:string;items:MediaRecoveryItem[];missingCount:number;attentionCount:number;}
export interface MediaFingerprint {sha256:string;size:number;realPath:string;modifiedAt:string;}
export interface MediaRelinkPlan {
 id:string;projectId:string;revision:string;mediaId:string;current:Media;replacement:Media;
 requiredSourceEnd:number;clipIds:string[];usedAsBackground:boolean;
 fingerprint:MediaFingerprint;compatible:boolean;blockers:string[];warnings:string[];expiresAt:string;
 requiredAcknowledgements:Array<{id:string;message:string}>;
}
export interface MediaRelinkResult {planId:string;project:Project;revision:string;oldMediaId:string;newMediaId:string;}
