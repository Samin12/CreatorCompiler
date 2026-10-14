/** One in-flight task per key shared by every requester. A requester's abort releases only its own
 * interest; the shared work is aborted when the last requester leaves, and a later request starts fresh. */
type Entry<T>={promise:Promise<T>;controller:AbortController;users:number};
export function sharedWork<T>(){
 const entries=new Map<string,Entry<T>>();
 function run(key:string,work:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)return Promise.reject(signal.reason);
  let entry=entries.get(key);
  if(!entry||entry.controller.signal.aborted){
   const controller=new AbortController(),created:Entry<T>={promise:Promise.resolve().then(()=>work(controller.signal)),controller,users:0};entry=created;entries.set(key,created);
   void created.promise.finally(()=>{if(entries.get(key)===created)entries.delete(key);}).catch(()=>{});
  }
  const record=entry;record.users++;
  return new Promise<T>((resolve,reject)=>{
   let done=false;
   const release=()=>{if(done)return false;done=true;signal?.removeEventListener('abort',cancel);record.users--;return true;};
   const cancel=()=>{if(release()){reject(signal!.reason);if(record.users===0)record.controller.abort();}};
   signal?.addEventListener('abort',cancel,{once:true});
   record.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
  });
 }
 return Object.assign(run,{pending:(key:string)=>entries.get(key)?.users??0});
}
