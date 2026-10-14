// Builds `~/Applications/SceneForge Dev.app` (override with SCENEFORGE_DEV_APP_DIR): the local Electron runtime with its own name, icon and
// bundle identifier, running this source tree. macOS keys camera, microphone and screen
// permissions to the signing identity, so sign it with a persistent certificate
// (SCENEFORGE_DEV_SIGN_IDENTITY) to keep grants across rebuilds; ad-hoc signing works
// but macOS asks again after every rebuild.
import {execFileSync} from 'node:child_process';
import {cp,rm,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if(process.platform!=='darwin')throw Error('The development app bundle is macOS only.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'node_modules/electron/dist/Electron.app');
const target=path.join(process.env.SCENEFORGE_DEV_APP_DIR||path.join(os.homedir(),'Applications'),'SceneForge Dev.app');
const plist=path.join(target,'Contents/Info.plist');
const identity=process.env.SCENEFORGE_DEV_SIGN_IDENTITY||'-';
const run=(command,args)=>execFileSync(command,args,{stdio:['ignore','pipe','inherit']}).toString().trim();
const set=(key,value)=>run('plutil',['-replace',key,'-string',value,plist]);

await rm(target,{recursive:true,force:true});
await mkdir(path.dirname(target),{recursive:true});
await cp(source,target,{recursive:true,verbatimSymlinks:true});
set('CFBundleName','SceneForge Dev');
set('CFBundleDisplayName','SceneForge Dev');
set('CFBundleIdentifier','com.samin.sceneforge.dev');
set('CFBundleIconFile','sceneforge.icns');
set('NSCameraUsageDescription','SceneForge records your camera for the scenes you capture.');
set('NSMicrophoneUsageDescription','SceneForge records your microphone for the scenes you capture.');
await copyFile(path.join(root,'assets/icon.icns'),path.join(target,'Contents/Resources/sceneforge.icns'));
// Electron loads Resources/app before its default app. A stub that requires the source
// entry runs the live tree and keeps the bundle sealed (no symlink out of the bundle).
const stub=path.join(target,'Contents/Resources/app'),{name,version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await mkdir(stub);
await writeFile(path.join(stub,'package.json'),JSON.stringify({name,version,main:'main.cjs'})+'\n');
await writeFile(path.join(stub,'main.cjs'),`require(${JSON.stringify(path.join(root,'desktop/main.cjs'))});\n`);
run('codesign',['--force','--deep','--sign',identity,target]);
run('codesign',['--verify','--deep','--strict',target]);
console.log(`Built ${target} (${identity==='-'?'ad-hoc signed: macOS will ask for permissions again after each rebuild':`signed with ${identity}`}).`);
if(process.argv.includes('--open'))run('open',['-n',target,'--args','--force-renderer-accessibility']);
