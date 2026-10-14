/** Edits that share a coalesce key, with no other edit or history step between them and less than a second apart, form one undo step. */
export const COALESCE_MS=1000;
export class EditHistory<T>{
 past:T[]=[];future:T[]=[];private open:{key:string;at:number}|null=null;
 /** Records the state an edit replaced; a continued coalesced edit keeps the step that began it. `limit` is read only when a step is added. */
 record(previous:T,limit:()=>number,key?:string,now=Date.now()):boolean{
  const open=this.open,continued=Boolean(key&&open&&open.key===key&&now-open.at<=COALESCE_MS);this.open=key?{key,at:now}:null;this.future=[];
  if(continued)return false;const max=limit();this.past=[...this.past.slice(-(max-1)),previous];return true;
 }
 undo(current:T):T|undefined{this.open=null;const previous=this.past.pop();if(previous!==undefined)this.future.push(current);return previous;}
 redo(current:T):T|undefined{this.open=null;const next=this.future.pop();if(next!==undefined)this.past.push(current);return next;}
 reset(){this.past=[];this.future=[];this.open=null;}
}
