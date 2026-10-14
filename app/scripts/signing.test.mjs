import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir,symlink,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {parseIdentities,chooseIdentity,resolveSigningIdentity,signedRuntimeManifest} from './signing.mjs';
import {signingDescription} from './create-dmg.mjs';
import {buildMcpLauncher} from './build-mcp-launcher.mjs';
const a={sha1:'A'.repeat(40),name:'Apple Development: Test One (ONE)'};
const b={sha1:'B'.repeat(40),name:'Apple Development: Test Two (TWO)'};
const listing=items=>items.map((item,i)=>`  ${i+1}) ${item.sha1} "${item.name}"`).join('\n');

test('installer signing description distinguishes actual certificate and explicit ad-hoc builds',()=>{
 assert.match(signingDescription('Authority=Apple Development: Test'),/Apple Development signed/);
 assert.match(signingDescription('Authority=Developer ID Application: Test'),/Developer ID signed/);
 assert.match(signingDescription('Signature=adhoc'),/ad hoc signed/);
 assert.throws(()=>signingDescription('unsigned'),/unrecognized/);
});

test('native MCP launcher preserves spaces, literal arguments, environment and symlink location',{skip:process.platform!=='darwin'},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'sceneforge launcher '));
 const app=path.join(directory,'App With Spaces.app'),bin=path.join(app,'Contents/MacOS'),run=promisify(execFile);
 try{
  await mkdir(bin,{recursive:true});
  const source=path.join(directory,'engine.c');
  await writeFile(source,'#include <stdio.h>\n#include <stdlib.h>\nint main(int argc,char **argv){printf("%s\\n",getenv("ELECTRON_RUN_AS_NODE"));for(int i=0;i<argc;i++)puts(argv[i]);return 0;}\n');
  await run('/usr/bin/clang',['-target','arm64-apple-macos14.0',source,'-o',path.join(bin,'SceneForge')]);
  const launcher=await buildMcpLauncher(app),alias=path.join(directory,'launcher alias');await symlink(launcher,alias);
  const actualBin=await realpath(bin);
  const args=['--name','a b','$(never-run)','--','unicode café'];
  for(const command of [launcher,alias]){
   const {stdout}=await run(command,args,{env:{...process.env,ELECTRON_RUN_AS_NODE:'0'}});
   assert.deepEqual(stdout.trimEnd().split('\n'),['1',path.join(actualBin,'SceneForge'),actualBin+'/../Resources/app/server-dist/mcp-entry.mjs',...args]);
  }
  await rm(path.join(bin,'SceneForge'));
  await assert.rejects(run(launcher,[]),error=>error.code===127&&/could not start the bundled service/.test(error.stderr));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('identity parsing accepts valid Apple app identities, not installer or arbitrary certificates',()=>{
 assert.deepEqual(parseIdentities(listing([a,{sha1:b.sha1,name:'Developer ID Installer: Test'}, {sha1:'C'.repeat(40),name:'Other Certificate'}])+'\n  3 valid identities found'),[a]);
});

test('missing/ambiguous identity fails closed and a missing pinned identity never falls back',()=>{
 assert.throws(()=>chooseIdentity({identities:[]}),/Choose a valid/);
 assert.throws(()=>chooseIdentity({identities:[a,b]}),/Choose a valid/);
 assert.throws(()=>chooseIdentity({identities:[b],pin:{version:1,sha1:a.sha1}}),/pinned signing identity is unavailable/);
 assert.equal(chooseIdentity({identities:[a,b],pin:{version:1,sha1:a.sha1}}).sha1,a.sha1);
 assert.equal(chooseIdentity({identities:[a,b],override:b.name}).sha1,b.sha1);
});

test('ad-hoc mode needs explicit fixture opt-in and cannot silently override a certificate choice',()=>{
 assert.throws(()=>chooseIdentity({identities:[a],override:'-'}),/only available/);
 assert.equal(chooseIdentity({identities:[],allowAdhoc:'1'}).mode,'adhoc');
 assert.throws(()=>chooseIdentity({identities:[a],allowAdhoc:'1',override:a.sha1}),/Do not combine/);
});

test('first identity is pinned; adding a certificate does not switch it and explicit rotation persists',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'sceneforge-sign-policy-'));
 try{
  let identities=[a];const run=async()=>({stdout:listing(identities)});
  assert.equal((await resolveSigningIdentity({directory,env:{},run})).sha1,a.sha1);
  identities=[b,a];assert.equal((await resolveSigningIdentity({directory,env:{},run})).sha1,a.sha1);
  assert.equal((await resolveSigningIdentity({directory,env:{SCENEFORGE_SIGN_IDENTITY:b.sha1},run})).sha1,b.sha1);
  assert.equal(JSON.parse(await readFile(path.join(directory,'signing-identity.json'),'utf8')).sha1,b.sha1);
  assert.equal((await resolveSigningIdentity({directory,env:{},run})).sha1,b.sha1);
  identities=[a];await assert.rejects(resolveSigningIdentity({directory,env:{},run}),/pinned signing identity is unavailable/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('corrupt pins fail safely; fixture mode never queries keychain or writes a pin',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'sceneforge-sign-corrupt-'));
 try{
  await writeFile(path.join(directory,'signing-identity.json'),'broken');
  await assert.rejects(resolveSigningIdentity({directory,env:{},run:async()=>({stdout:listing([a])})}));
  assert.equal((await resolveSigningIdentity({directory,env:{SCENEFORGE_ALLOW_ADHOC:'1'},run:()=>{throw Error('Keychain should not run');}})).mode,'adhoc');
  assert.equal(await readFile(path.join(directory,'signing-identity.json'),'utf8'),'broken');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('signed manifest preserves original build digest, reports signed digest and rejects stale build bytes',()=>{
 const original={sources:[{name:'ffmpeg',sha256:'source'}],binaries:[{name:'ffmpeg',sha256:'before',size:10}]};
 const files=[{path:'runtime/bin/ffmpeg',identifier:'com.samin.sceneforge.ffmpeg',buildSha256:'before',sha256:'after',size:20}];
 const result=signedRuntimeManifest(original,files,{mode:'development',sha1:a.sha1});
 assert.equal(original.binaries[0].sha256,'before');
 assert.deepEqual(result.binaries[0],{...original.binaries[0],buildSha256:'before',buildSize:10,sha256:'after',size:20,signingIdentifier:'com.samin.sceneforge.ffmpeg'});
 assert.deepEqual(result.sources,original.sources);
 assert.throws(()=>signedRuntimeManifest(original,[{...files[0],buildSha256:'wrong'}],a),/does not match/);
});
