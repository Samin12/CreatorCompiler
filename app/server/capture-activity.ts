/** Open browser capture sessions defer background work. A session is a lease renewed by chunk activity,
 * so a crashed renderer or a long pause cannot block automation forever; a short settle after the last
 * capture ends lets take review start on an idle machine. */
export interface CaptureActivity {open(id:string):void;close(id:string):void;remaining():number;idle(signal?:AbortSignal):Promise<void>}
export function createCaptureActivity({staleMs=60_000,settleMs=4_000,now=()=>Date.now()}:{staleMs?:number;settleMs?:number;now?:()=>number}={}):CaptureActivity{
 const sessions=new Map<string,number>(),waiters=new Set<()=>void>();let ended=-Infinity;
 const prune=(t:number)=>{for(const [id,at] of sessions)if(t-at>=staleMs){sessions.delete(id);ended=Math.max(ended,at+staleMs);}};
 /** Milliseconds until no capture is open and the settle period has passed; 0 when background work may run. */
 function remaining(){const t=now();prune(t);if(sessions.size)return Math.max(1,Math.min(...sessions.values())+staleMs-t);return Math.max(0,ended+settleMs-t);}
 const notify=()=>{for(const wake of [...waiters])wake();};
 return {
  open(id){sessions.set(id,now());notify();},
  close(id){if(sessions.delete(id)){ended=Math.max(ended,now());notify();}},
  remaining,
  async idle(signal){
   for(let wait=remaining();wait>0;wait=remaining()){
    signal?.throwIfAborted();
    await new Promise<void>((resolve,reject)=>{
     const finish=(aborted:boolean)=>{clearTimeout(timer);waiters.delete(wake);signal?.removeEventListener('abort',abort);if(aborted)reject(signal!.reason);else resolve();};
     const wake=()=>finish(false),abort=()=>finish(true),timer=setTimeout(wake,wait);
     waiters.add(wake);signal?.addEventListener('abort',abort,{once:true});
    });
   }
   signal?.throwIfAborted();
  },
 };
}
export const captureActivity=createCaptureActivity();
