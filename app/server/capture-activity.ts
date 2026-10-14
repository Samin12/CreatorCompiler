/** Open browser capture sessions defer background work. A session is a lease renewed by chunk activity,
 * so a crashed renderer or a long pause cannot block automation forever; a short settle after the last
 * capture ends lets take review start on an idle machine. A session that has delivered no chunk yet
 * (created at countdown start) holds only a short lease, so a cancelled start stops deferring work within seconds. */
export interface CaptureActivity {open(id:string,pending?:boolean):void;close(id:string):void;remaining(settle?:boolean):number;idle(signal?:AbortSignal,settle?:boolean):Promise<void>;changed(signal?:AbortSignal):Promise<void>}
export function createCaptureActivity({staleMs=60_000,pendingMs=10_000,settleMs=4_000,now=()=>Date.now()}:{staleMs?:number;pendingMs?:number;settleMs?:number;now?:()=>number}={}):CaptureActivity{
 const sessions=new Map<string,number>(),waiters=new Set<()=>void>();let ended=-Infinity;
 const prune=(t:number)=>{for(const [id,until] of sessions)if(t>=until){sessions.delete(id);ended=Math.max(ended,until);}};
 /** Milliseconds until no capture is open and (unless `settle` is false) the settle period has passed; 0 when background work may run. */
 function remaining(settle=true){const t=now();prune(t);if(sessions.size)return Math.max(1,Math.min(...sessions.values())-t);return settle?Math.max(0,ended+settleMs-t):0;}
 const notify=()=>{for(const wake of [...waiters])wake();};
 const change=(wait:number|undefined,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const finish=(aborted:boolean)=>{clearTimeout(timer);waiters.delete(wake);signal?.removeEventListener('abort',abort);if(aborted)reject(signal!.reason);else resolve();};
  const wake=()=>finish(false),abort=()=>finish(true),timer=wait===undefined?undefined:setTimeout(wake,wait);
  waiters.add(wake);signal?.addEventListener('abort',abort,{once:true});
 });
 return {
  /** `pending` opens the short lease of a session that has not received a chunk yet. */
  open(id,pending=false){sessions.set(id,now()+(pending?pendingMs:staleMs));notify();},
  close(id){if(sessions.delete(id)){ended=Math.max(ended,now());notify();}},
  remaining,
  /** `settle:false` waits only for open captures, for take review work that the settle period exists to favour. */
  async idle(signal,settle=true){for(let wait=remaining(settle);wait>0;wait=remaining(settle))await change(wait,signal);signal?.throwIfAborted();},
  /** Resolves on the next capture open or close. */
  changed(signal){return change(undefined,signal);},
 };
}
export const captureActivity=createCaptureActivity();
