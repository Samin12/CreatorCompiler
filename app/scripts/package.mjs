import {packager} from '@electron/packager';
import {cp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDmg,sha256File} from './create-dmg.mjs';
import {resolveSigningIdentity,signPackage} from './signing.mjs';
import {buildMcpLauncher} from './build-mcp-launcher.mjs';
const staging=path.resolve('.local/package');
const requestedOutput=process.env.SCENEFORGE_PACKAGE_OUT;
if(requestedOutput&&!path.isAbsolute(requestedOutput))throw Error('SCENEFORGE_PACKAGE_OUT must be an absolute directory path.');
const packageOutput=path.resolve(requestedOutput||'../release');
if(process.platform!=='darwin')throw Error('macOS packaging and signing must run on macOS.');
const signingIdentity=await resolveSigningIdentity();
console.log(JSON.stringify({signingMode:signingIdentity.mode,identitySource:signingIdentity.source,identitySha1:signingIdentity.sha1}));
for(const file of ['runtime/bin/ffmpeg','runtime/bin/ffprobe','runtime/bin/whisper-cli','runtime/manifest.json','dist/index.html','server-dist/index.mjs'])await access(file).catch(()=>{throw Error(`Missing ${file}. Build the runtime and app before packaging.`)});
const modelFile='runtime/models/ggml-base.en.bin',modelHash='a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';
const modelURL='https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
await mkdir('runtime/models',{recursive:true});
try{await access(modelFile);}catch{
 if(process.env.SCENEFORGE_MODEL_SOURCE)await cp(process.env.SCENEFORGE_MODEL_SOURCE,modelFile);
 else{const response=await fetch(modelURL);if(!response.ok)throw Error('Model download failed: '+response.status);await writeFile(modelFile,Buffer.from(await response.arrayBuffer()));}
}
if(createHash('sha256').update(await readFile(modelFile)).digest('hex')!==modelHash)throw Error('Bundled model SHA256 does not match the pinned base.en model.');
const modelLicense=await fetch('https://raw.githubusercontent.com/openai/whisper/main/LICENSE');if(!modelLicense.ok)throw Error('Could not retrieve Whisper model license.');
await writeFile('runtime/models/LICENSE.txt',await modelLicense.text());
await writeFile('runtime/models/model.json',JSON.stringify({name:'Whisper base.en',language:'English',url:modelURL,sha256:modelHash,license:'MIT',licenseURL:'https://github.com/openai/whisper/blob/main/LICENSE'},null,2));
await rm(staging,{recursive:true,force:true});
await mkdir(staging,{recursive:true});
for(const dir of ['desktop','dist','server-dist'])await cp(dir,path.join(staging,dir),{recursive:true});
for(const entry of ['bin','licenses','models','manifest.json','THIRD-PARTY-NOTICES.txt'])await cp(path.join('runtime',entry),path.join(staging,'runtime',entry),{recursive:true});
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await cp(path.resolve('..',name),path.join(staging,name));
await cp('../docs',path.join(staging,'docs'),{recursive:true});
await writeFile(path.join(staging,'package.json'),JSON.stringify({name:'sceneforge',productName:'SceneForge',version:'0.1.0',main:'desktop/main.cjs',description:'Local-first script, recording and video editing studio',author:'Samin Yasar'},null,2));
const version=JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version;
const result=await packager({dir:staging,name:'SceneForge',platform:'darwin',arch:'arm64',electronVersion:version,out:packageOutput,overwrite:true,asar:false,icon:path.resolve('assets/icon.icns'),appBundleId:'com.samin.sceneforge',appCategoryType:'public.app-category.video',extendInfo:{LSMinimumSystemVersion:'14.0',NSCameraUsageDescription:'Record camera video for your scenes.',NSMicrophoneUsageDescription:'Record narration for your scenes.',NSAudioCaptureUsageDescription:'Record system audio from the screen or window you choose.',NSScreenCaptureUsageDescription:'Record the screen or window you choose.'}});
for(const dir of result){
 const resources=path.join(dir,'SceneForge.app/Contents/Resources');
 // Electron Packager excludes these distribution files by default. Retain
 // their exact vendor bytes in the final bundle before signing it.
 for(const license of ['LICENSE','LICENSES.chromium.html']){
  const source=path.resolve('node_modules/electron/dist',license),target=path.join(resources,license);
  await cp(source,target);
  if(await sha256File(source)!==await sha256File(target))throw Error('Electron license copy failed: '+license);
 }
 await buildMcpLauncher(path.join(dir,'SceneForge.app'));
}
for(const dir of result)await signPackage(path.join(dir,'SceneForge.app'),signingIdentity);
for(const dir of result){
 const app=path.join(dir,'SceneForge.app'),zip=path.join(packageOutput,'SceneForge-macOS-arm64.zip');
 await rm(zip,{force:true});
 await promisify(execFile)('ditto',['--norsrc','--noextattr','-c','-k','--keepParent',app,zip]);
 const sha=await sha256File(zip);
 await writeFile(zip+'.sha256',sha+'  '+path.basename(zip)+'\n');
 console.log(JSON.stringify({zip,sha256:sha,signing:signingIdentity.mode,notarized:false}));
 console.log(JSON.stringify(await createDmg(app,path.join(packageOutput,'SceneForge-macOS-arm64.dmg'))));
}
console.log(result.join('\n'));
