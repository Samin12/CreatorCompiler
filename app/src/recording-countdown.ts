export function waitForCountdown(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('Countdown cancelled','AbortError'));return;}const abort=()=>{clearTimeout(timer);reject(new DOMException('Countdown cancelled','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
export async function recordingCountdown(signal:AbortSignal,tick:(value:number)=>void,chime:()=>void,wait=waitForCountdown){
 for(const value of [3,2,1]){if(signal.aborted)throw new DOMException('Countdown cancelled','AbortError');tick(value);chime();await wait(1000,signal);}
 if(signal.aborted)throw new DOMException('Countdown cancelled','AbortError');
}
export function countdownChime(){
 const context=new AudioContext();void context.resume().catch(()=>{});
 return {play:()=>{const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;oscillator.frequency.value=740;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.14,now+.012);gain.gain.exponentialRampToValueAtTime(.001,now+.17);oscillator.connect(gain).connect(context.destination);oscillator.start(now);oscillator.stop(now+.18);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};},close:()=>context.close().catch(()=>{})};
}
