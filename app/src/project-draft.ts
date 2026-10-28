import {create,current,isDraft} from 'mutative';
import type {Project} from '../shared/types';

/** Counts structural updates that had to be repeated on a full copy. */
export const draftStats={fallbacks:0};
const resolve=(value:unknown):unknown=>isDraft(value)?current(value as object):Array.isArray(value)?value.map(resolve):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)])):value;
/** Deep copy that also accepts mutative drafts, which structuredClone rejects. */
export function plainClone<T>(value:T):T{
 if(isDraft(value))return structuredClone(current(value as object)) as T;
 try{return structuredClone(value);}catch(error){if((error as Error)?.name!=='DataCloneError')throw error;return structuredClone(resolve(value)) as T;}
}
/** The current state behind a draft, for read-heavy passes over a whole timeline. Read it; write through the draft. */
export const plainView=<T>(value:T):T=>isDraft(value)?current(value as object) as T:value;
// A draft-specific failure (structuredClone of a proxy, a revoked proxy) is retried on a full copy; other errors abort the edit.
const draftFailure=(error:unknown)=>error instanceof TypeError||(error as Error)?.name==='DataCloneError';
/** Applies one edit with structural sharing: only the edited path is copied, so untouched subtrees keep their identity for memoized views and undo history. */
export function applyProjectChange(base:Project,fn:(draft:Project)=>void,updatedAt=new Date().toISOString()):Project{
 const failed:{error?:unknown}={};let error:unknown;
 try{return create(base,draft=>{try{fn(draft as Project);}catch(error){failed.error=error;throw error;}draft.updatedAt=updatedAt;});}
 catch(caught){if('error' in failed&&!draftFailure(failed.error))throw failed.error;error=caught;}
 // Only a retry that succeeds proves the draft was at fault; an edit that fails again (its own TypeError) throws that error unreported.
 const next=structuredClone(base);fn(next);next.updatedAt=updatedAt;
 if(!draftStats.fallbacks++)console.warn('Creator Compiler: a structural project update failed; this edit used a full copy instead.',error);
 return next;
}
