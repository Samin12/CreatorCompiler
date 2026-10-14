import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sign} from '@electron/osx-sign';

const execute=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const emptyEntitlements='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict/></plist>\n';
export const customCode=Object.freeze([
 ['server-dist/sceneforge-screen-recorder','com.samin.sceneforge.screen-recorder'],
 ['server-dist/sceneforge-vision','com.samin.sceneforge.vision'],
 ['server-dist/sceneforge-text-renderer','com.samin.sceneforge.text-renderer'],
 ['runtime/bin/ffmpeg','com.samin.sceneforge.ffmpeg'],
 ['runtime/bin/ffprobe','com.samin.sceneforge.ffprobe'],
 ['runtime/bin/whisper-cli','com.samin.sceneforge.whisper'],
]);

export function parseIdentities(output){
 return [...output.matchAll(/^\s*\d+\)\s+([a-f\d]{40})\s+"([^"]+)"\s*$/gim)]
  .filter(([, ,name])=>/^(Apple Development:|Mac Developer:|Developer ID Application:)/.test(name))
  .map(([,sha1,name])=>({sha1:sha1.toUpperCase(),name}));
}

export function chooseIdentity({identities,pin,override,allowAdhoc}){
 if(allowAdhoc==='1'){
  if(override&&!['-','adhoc'].includes(override))throw Error('Do not combine SCENEFORGE_ALLOW_ADHOC=1 with a certificate override.');
  return {mode:'adhoc',sha1:'-',name:'Explicit ad-hoc fixture signing',source:'explicit-fixture-opt-in'};
 }
 if(override&&['-','adhoc'].includes(override))throw Error('Ad-hoc signing is only available with SCENEFORGE_ALLOW_ADHOC=1 for disposable fixtures.');
 if(pin&&(pin.version!==1||!/^[A-F\d]{40}$/.test(pin.sha1||'')))throw Error('Invalid .local/signing-identity.json; restore the intended signing identity explicitly.');
 const requested=override||pin?.sha1;
 let identity;
 if(requested){
  const matches=identities.filter(item=>item.sha1===requested.toUpperCase()||item.name===requested);
  if(matches.length!==1)throw Error(`The ${override?'requested':'pinned'} signing identity is unavailable or ambiguous. Run security find-identity -v -p codesigning and set SCENEFORGE_SIGN_IDENTITY to the intended valid certificate SHA-1. No ad-hoc fallback was used.`);
  identity=matches[0];
 }else{
  if(identities.length!==1)throw Error('Choose a valid Apple signing identity using SCENEFORGE_SIGN_IDENTITY (certificate SHA-1). SceneForge requires one explicit identity when none or several are available; ad-hoc fixture builds require SCENEFORGE_ALLOW_ADHOC=1.');
  identity=identities[0];
 }
 return {...identity,mode:identity.name.startsWith('Developer ID Application:')?'developer-id':'development',source:override?'override':pin?'local-pin':'first-use'};
}

export async function resolveSigningIdentity({directory=path.resolve('.local'),env=process.env,run=execute}={}){
 if(env.SCENEFORGE_ALLOW_ADHOC==='1')return chooseIdentity({identities:[],allowAdhoc:'1',override:env.SCENEFORGE_SIGN_IDENTITY});
 const pinFile=path.join(directory,'signing-identity.json');
 let pin;
 try{pin=JSON.parse(await readFile(pinFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const {stdout}=await run('/usr/bin/security',['find-identity','-v','-p','codesigning']);
 const chosen=chooseIdentity({identities:parseIdentities(stdout),pin,override:env.SCENEFORGE_SIGN_IDENTITY});
 if(!pin){
  await mkdir(directory,{recursive:true,mode:0o700});
  try{await writeFile(pinFile,JSON.stringify({version:1,sha1:chosen.sha1,name:chosen.name},null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const competing=JSON.parse(await readFile(pinFile,'utf8'));
   if(competing.sha1!==chosen.sha1)throw Error('A concurrent package build selected a different signing identity. Retry with the intended local pin.');
  }
 }else if(env.SCENEFORGE_SIGN_IDENTITY&&pin.sha1!==chosen.sha1){
  // An explicit, validated identity change is persistent: a later ordinary
  // package build must not silently switch back to the previous signer.
  const temporary=pinFile+'.'+randomUUID()+'.tmp';
  try{
   await writeFile(temporary,JSON.stringify({version:1,sha1:chosen.sha1,name:chosen.name},null,2)+'\n',{flag:'wx',mode:0o600});
   await rename(temporary,pinFile);
  }finally{await rm(temporary,{force:true});}
 }
 return chosen;
}

export function signedRuntimeManifest(original,files,identity){
 const result=structuredClone(original);
 result.signing={mode:identity.mode,identitySha1:identity.sha1,buildManifest:'build-manifest.json',provenance:'signing-provenance.json'};
 result.binaries=result.binaries.map(binary=>{
  const file=files.find(item=>item.path===`runtime/bin/${binary.name}`);
  if(!file||file.buildSha256!==binary.sha256)throw Error('Runtime build manifest does not match the unsigned input: '+binary.name);
  return {...binary,buildSha256:binary.sha256,buildSize:binary.size,sha256:file.sha256,size:file.size,signingIdentifier:file.identifier};
 });
 return result;
}

// Sign only fresh package output. Source runtime files and their corresponding-source
// build manifest are never changed. The outer bundle is sealed after provenance.
export async function signPackage(app,identity,{directory=path.resolve('.local/signing')}={}){
 await mkdir(directory,{recursive:true,mode:0o700});
 const entitlements=path.join(directory,'empty-entitlements.plist');
 await writeFile(entitlements,emptyEntitlements,{mode:0o600});
 const resource=path.join(app,'Contents/Resources/app');
 const originalBytes=await readFile(path.join(resource,'runtime/manifest.json'));
 const original=JSON.parse(originalBytes);
 const files=[];
 const signCode=async(target,identifier)=>{
  const before=await readFile(target);
  await execute('/usr/bin/codesign',['--force','--sign',identity.sha1,'--timestamp=none','--identifier',identifier,'--entitlements',entitlements,target],{timeout:120000});
  await execute('/usr/bin/codesign',['--verify','--strict',target]);
  const after=await readFile(target);
  return {identifier,buildSha256:hash(before),buildSize:before.length,sha256:hash(after),size:after.length};
 };
 for(const [relative,identifier] of customCode){
  const target=path.join(resource,relative),before=await readFile(target);
  if(relative.startsWith('runtime/bin/')){
   const entry=original.binaries.find(item=>item.name===path.basename(relative));
   if(!entry||entry.sha256!==hash(before))throw Error('Refusing to sign a runtime binary that differs from its build manifest: '+relative);
  }
  files.push({path:relative,...await signCode(target,identifier)});
 }
 const launcherPath=path.join(app,'Contents/MacOS/sceneforge-mcp');
 const launcher={path:'Contents/MacOS/sceneforge-mcp',...await signCode(launcherPath,'com.samin.sceneforge.mcp')};
 await writeFile(path.join(resource,'runtime/build-manifest.json'),originalBytes);
 await writeFile(path.join(resource,'runtime/manifest.json'),JSON.stringify(signedRuntimeManifest(original,files,identity),null,2)+'\n');
 await writeFile(path.join(resource,'runtime/signing-provenance.json'),JSON.stringify({version:1,mode:identity.mode,identitySha1:identity.sha1,originalManifestSha256:hash(originalBytes),files,launcher},null,2)+'\n');
 const signedCustom=new Set(customCode.map(([relative])=>path.join(resource,relative)));
 signedCustom.add(launcherPath);
 await sign({app,identity:identity.sha1,identityValidation:identity.mode!=='adhoc',platform:'darwin',type:identity.mode==='developer-id'?'distribution':'development',
  preAutoEntitlements:false,preEmbedProvisioningProfile:false,ignore:file=>signedCustom.has(file),
  optionsForFile:()=>({hardenedRuntime:false,entitlements,timestamp:'none'})});
 await execute('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 // The signing library must not rewrite the already-accounted-for runtime bytes.
 for(const file of files)if(hash(await readFile(path.join(resource,file.path)))!==file.sha256)throw Error('Signed runtime provenance changed while sealing: '+file.path);
 if(hash(await readFile(launcherPath))!==launcher.sha256)throw Error('Signed MCP launcher changed while sealing.');
 return {mode:identity.mode,identitySha1:identity.sha1,notarized:false,customBinaries:files.length,nativeLaunchers:1};
}
