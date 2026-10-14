/** A dismissed or superseded dialog request may finish on the server, but cannot update the UI or project. */
export class AIDialogRequestScope {
 private current:AbortController|null=null;
 cancel(){this.current?.abort();this.current=null;}
 async run<T>(work:(signal:AbortSignal)=>Promise<T>,callbacks:{relevant:()=>boolean;success:(result:T)=>void;error:(error:unknown)=>void;finish:()=>void}):Promise<void>{
  this.cancel();const controller=new AbortController();this.current=controller;
  const relevant=()=>this.current===controller&&!controller.signal.aborted&&callbacks.relevant();
  try{const result=await work(controller.signal);if(relevant())callbacks.success(result);}
  catch(error){if(relevant())callbacks.error(error);}
  finally{if(relevant())callbacks.finish();if(this.current===controller)this.current=null;}
 }
}

export function preciseAITime(seconds:number):string{
 const total=Math.max(0,Math.round((Number.isFinite(seconds)?seconds:0)*1000));
 return `${Math.floor(total/60000).toString().padStart(2,'0')}:${Math.floor(total%60000/1000).toString().padStart(2,'0')}.${(total%1000).toString().padStart(3,'0')}`;
}
