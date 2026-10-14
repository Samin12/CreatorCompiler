type Waiter={resolve:(stream:MediaStream)=>void;reject:(error:unknown)=>void;detach:()=>void};
type Pending={key:string;audio:boolean;video:boolean;waiters:Set<Waiter>};
const cancelled=()=>new DOMException('Media access cancelled','AbortError');

/** Keep unresolved browser requests across view lifetimes. Cancelling a waiter
 * cannot dismiss an OS prompt; it must not allow a second prompt to be queued. */
export class PendingMediaRequests {
 private pending=new Set<Pending>();
 constructor(private acquire:(constraints:MediaStreamConstraints)=>Promise<MediaStream>){}
 request(constraints:MediaStreamConstraints,signal?:AbortSignal):Promise<MediaStream>{
  if(signal?.aborted)return Promise.reject(cancelled());
  const key=JSON.stringify(constraints),audio=Boolean(constraints.audio),video=Boolean(constraints.video);
  let entry=[...this.pending].find(value=>value.key===key);
  if(!entry&&[...this.pending].some(value=>(audio&&value.audio)||(video&&value.video)))return Promise.reject(new Error('A request for this device is still open. Respond to the existing access prompt, then try your new settings again.'));
  const fresh=!entry;
  if(!entry){entry={key,audio,video,waiters:new Set()};this.pending.add(entry);}
  const request=entry;
  const result=new Promise<MediaStream>((resolve,reject)=>{
   const abort=()=>{request.waiters.delete(waiter);waiter.detach();reject(cancelled());};
   const waiter:Waiter={resolve,reject,detach:()=>signal?.removeEventListener('abort',abort)};
   request.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});
  });
  if(fresh)void Promise.resolve().then(()=>{
   // An unmounted caller may have cancelled before any browser request began.
   if(!request.waiters.size)return null;
   return this.acquire(constraints);
  }).then(stream=>{
   this.pending.delete(request);
   const waiters=[...request.waiters];request.waiters.clear();
   for(const waiter of waiters)waiter.detach();
   if(!stream)return;
   if(waiters.length===1){waiters[0].resolve(stream);return;}
   // Separate tracks ensure closing one view cannot stop another view's preview.
   for(const waiter of waiters){try{waiter.resolve(stream.clone());}catch(error){waiter.reject(error);}}
   stream.getTracks().forEach(track=>track.stop());
  },error=>{
   this.pending.delete(request);
   for(const waiter of request.waiters){waiter.detach();waiter.reject(error);}request.waiters.clear();
  });
  return result;
 }
}

const pools=new WeakMap<Pick<MediaDevices,'getUserMedia'>,PendingMediaRequests>();
export function requestUserMedia(constraints:MediaStreamConstraints,signal?:AbortSignal,devices:Pick<MediaDevices,'getUserMedia'>=navigator.mediaDevices):Promise<MediaStream>{
 if(!devices?.getUserMedia)return Promise.reject(new Error('Media capture requires the desktop app or a secure browser.'));
 let pool=pools.get(devices);if(!pool){pool=new PendingMediaRequests(value=>devices.getUserMedia(value));pools.set(devices,pool);}
 return pool.request(constraints,signal);
}

const displayPending=new WeakSet<Pick<MediaDevices,'getDisplayMedia'>>();
/** A display result belongs to one explicit source selection. Never coalesce it
 * with a later selection or enqueue a new OS request behind an unresolved one. */
export async function requestDisplayMedia(constraints:DisplayMediaStreamOptions,devices:Pick<MediaDevices,'getDisplayMedia'>=navigator.mediaDevices):Promise<MediaStream>{
 if(!devices?.getDisplayMedia)throw new Error('Screen sharing is unavailable in this browser.');
 if(displayPending.has(devices))throw new Error('A screen-sharing request is still open. Respond to the existing access prompt or chooser, then try again.');
 displayPending.add(devices);
 try{return await devices.getDisplayMedia(constraints);}finally{displayPending.delete(devices);}
}
