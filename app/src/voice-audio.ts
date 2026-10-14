import {requestUserMedia} from './media-access';
/** Bounded microphone PCM batches. Audio is never sent to an external origin. */
export function pcmWave(samples:Float32Array,sampleRate:number):ArrayBuffer{
 const rate=16000,length=Math.floor(samples.length*rate/sampleRate),buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
 const ascii=(offset:number,text:string)=>{for(let n=0;n<text.length;n++)view.setUint8(offset+n,text.charCodeAt(n));};
 ascii(0,'RIFF');view.setUint32(4,36+length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,length*2,true);
 const ratio=sampleRate/rate;for(let i=0;i<length;i++){const from=Math.floor(i*ratio),to=Math.max(from+1,Math.floor((i+1)*ratio));let total=0;for(let j=from;j<Math.min(to,samples.length);j++)total+=samples[j];const v=Math.max(-1,Math.min(1,total/(to-from)));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}return buffer;
}
export async function captureSpeech(onBatch:(wav:ArrayBuffer)=>void,signal?:AbortSignal):Promise<()=>void>{
 const stream=await requestUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false},signal);
 if(signal?.aborted){stream.getTracks().forEach(track=>track.stop());signal.throwIfAborted();}
 let context:AudioContext|undefined,node:AudioWorkletNode|undefined,url:string|undefined,closed=false;
 const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',close);if(node){node.port.onmessage=null;node.disconnect();}stream.getTracks().forEach(track=>track.stop());void context?.close().catch(()=>{});if(url)URL.revokeObjectURL(url);};
 signal?.addEventListener('abort',close,{once:true});
 const source=`class SpeechChunks extends AudioWorkletProcessor { constructor(){super();this.buffer=new Float32Array(Math.round(sampleRate*3));this.offset=0;} process(inputs){const a=inputs[0]?.[0];if(a)for(let i=0;i<a.length;i++){this.buffer[this.offset++]=a[i];if(this.offset===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(Math.round(sampleRate*3));this.offset=0;}}return true;}} registerProcessor('speech-chunks',SpeechChunks);`;
 try{context=new AudioContext({sampleRate:16000});url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));await context.audioWorklet.addModule(url);signal?.throwIfAborted();node=new AudioWorkletNode(context,'speech-chunks');const mute=context.createGain();mute.gain.value=0;context.createMediaStreamSource(stream).connect(node).connect(mute).connect(context.destination);node.port.onmessage=e=>{if(!closed)onBatch(pcmWave(e.data,context!.sampleRate));};await context.resume();signal?.throwIfAborted();return close;}
 catch(e){close();throw e;}
}
