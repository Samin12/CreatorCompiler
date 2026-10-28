#!/usr/bin/env node
// Build Creator Compiler's relocatable arm64 media command-line programs from pinned sources.
// Prerequisites: macOS, Xcode command-line tools, Node >=22, CMake >=3.21, pkg-config.
// Run from anywhere: node app/scripts/build-runtime.mjs (RUNTIME_JOBS defaults to 32).
import { mkdir, readFile, writeFile, copyFile, cp, readdir, stat, lstat, rm, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const script=fileURLToPath(import.meta.url), appDir=path.resolve(path.dirname(script),'..');
const runtime=path.join(appDir,'runtime'), work=path.join('/tmp',`sceneforge-runtime-build-${process.getuid()}`), sourceRoot=path.join(work,'source');
const prefix=path.join(work,'prefix'), sources=path.join(runtime,'sources'), logs=path.join(runtime,'logs');
const release=path.resolve(appDir,'../release'), jobs=Math.max(1,Math.min(32,Number(process.env.RUNTIME_JOBS)||32));
const pins=[
 {name:'ffmpeg',version:'9.0.2',file:'ffmpeg-9.0.2.tar.xz',url:'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',sha256:'8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',license:'GPL-2.0-or-later',dir:'ffmpeg-9.0.2',licenses:['COPYING.GPLv2','LICENSE.md']},
 {name:'x264',version:'r3222',revision:'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',file:'x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',url:'https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',sha256:'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',license:'GPL-2.0-or-later',dir:'x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55',licenses:['COPYING']},
 {name:'libvpx',version:'1.17.0',file:'libvpx-1.17.0.tar.gz',url:'https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz',sha256:'1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a',license:'BSD-3-Clause',dir:'libvpx-1.17.0',licenses:['LICENSE','PATENTS']},
 {name:'opus',version:'1.6.1',file:'opus-1.6.1.tar.gz',url:'https://ftp.osuosl.org/pub/xiph/releases/opus/opus-1.6.1.tar.gz',sha256:'6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1',license:'BSD-3-Clause',dir:'opus-1.6.1',licenses:['COPYING']},
 {name:'whisper.cpp',version:'1.9.4',file:'whisper.cpp-1.9.4.tar.gz',url:'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz',sha256:'57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae',license:'MIT',dir:'whisper.cpp-1.9.4',licenses:['LICENSE']},
];
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This recipe targets an arm64 macOS build host.');
const sdk=execFileSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
const tool=name=>{for(const dir of (process.env.PATH+':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin').split(':')){try{execFileSync('/bin/test',['-x',path.join(dir,name)]);return path.join(dir,name)}catch{}}throw new Error(`Build prerequisite missing: ${name}`)};
const cmake=tool('cmake'),pkgConfig=tool('pkg-config');
const cflags=`-O3 -arch arm64 -mmacosx-version-min=14.0 -ffile-prefix-map=${work}=/sceneforge-runtime`;
// Do not inherit credentials, developer-specific include paths, or a private HOME into configure logs.
const env={HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),LANG:'C',PATH:'/usr/bin:/bin:/usr/sbin:/sbin:'+path.dirname(cmake)+':'+path.dirname(pkgConfig),CC:'/usr/bin/clang',CXX:'/usr/bin/clang++',AR:'/usr/bin/ar',RANLIB:'/usr/bin/ranlib',MACOSX_DEPLOYMENT_TARGET:'14.0',SDKROOT:sdk,CFLAGS:cflags,CXXFLAGS:cflags,LDFLAGS:'-arch arm64 -mmacosx-version-min=14.0',PKG_CONFIG:pkgConfig,PKG_CONFIG_PATH:'',PKG_CONFIG_LIBDIR:path.join(prefix,'lib/pkgconfig'),COPYFILE_DISABLE:'1',COPY_EXTENDED_ATTRIBUTES_DISABLE:'1'};
await mkdir(work,{recursive:true,mode:0o700});
const workInfo=await lstat(work);if(workInfo.isSymbolicLink()||workInfo.uid!==process.getuid())throw new Error('Refusing a build directory owned by another user or a symbolic link.');
await chmod(work,0o700);
for(const dir of [runtime,sourceRoot,prefix,sources,logs,env.HOME,env.TMPDIR,path.join(runtime,'bin'),path.join(runtime,'licenses'),release])await mkdir(dir,{recursive:true});
const publicText=text=>String(text).replaceAll(appDir,'${SCENEFORGE_APP}').replaceAll(process.env.HOME||'/nonexistent-home','${BUILDER_HOME}').replaceAll(hostname(),'${BUILDER_HOST}').replaceAll(hostname().replace(/\.local$/,''),'${BUILDER_HOST}');
const publicJson=value=>publicText(JSON.stringify(value,null,2))+'\n';
// Preserve full compilation commands when a resumed invocation reuses completed objects.
const commands=await readFile(path.join(runtime,'build-commands.json'),'utf8').then(JSON.parse).catch(()=>[]);
async function run(name,command,args,cwd=work){
 const record={step:name,command,args,cwd},previous=commands.findIndex(c=>c.step===name);if(previous<0)commands.push(record);else commands[previous]=record;
 console.log(`[runtime] ${name}`);
 const log=createWriteStream(path.join(logs,name+'.log'),{flags:'w'});
 log.write(JSON.stringify({command,args,cwd})+'\n');
 await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',reject);child.once('close',code=>{log.end();code===0?resolve():reject(new Error(`${name} exited ${code}; see ${path.join(logs,name+'.log')}`))})});
}
async function sha(file){return createHash('sha256').update(await readFile(file)).digest('hex')}
const exists=async file=>stat(file).then(()=>true,()=>false);
async function source(pin){
 const archive=path.join(sources,pin.file);
 if(!await exists(archive))await run('download-'+pin.name,'/usr/bin/curl',['--fail','--location','--retry','3','--output',archive+'.tmp',pin.url]).then(()=>copyFile(archive+'.tmp',archive)).then(()=>rm(archive+'.tmp'));
 if(await sha(archive)!==pin.sha256)throw new Error(`${pin.file}: SHA256 mismatch; remove corrupt archive and retry.`);
 const dir=path.join(sourceRoot,pin.dir);
 const extracted=path.join(work,pin.name+'.extracted');
 if(!await exists(extracted)){await rm(dir,{recursive:true,force:true});await run('extract-'+pin.name,'/usr/bin/tar',['-xf',archive,'-C',sourceRoot]);await writeFile(extracted,pin.sha256)}
 const licenseDir=path.join(runtime,'licenses',pin.name);await mkdir(licenseDir,{recursive:true});
 for(const file of pin.licenses)await copyFile(path.join(dir,file),path.join(licenseDir,file.replaceAll('/','-')));
 return dir;
}
const dirs=Object.fromEntries(await Promise.all(pins.map(async p=>[p.name,await source(p)])));
const done=async(name,fn)=>{const marker=path.join(work,name+'.built');if(await exists(marker)){console.log(`[runtime] reuse ${name}`);return}await fn();await writeFile(marker,new Date().toISOString())};
const dependencyJobs=Math.max(1,Math.floor(jobs/3));
await Promise.all([
 done('x264',async()=>{await run('configure-x264','./configure',[`--prefix=${prefix}`,'--host=aarch64-apple-darwin','--enable-static','--enable-pic','--disable-cli','--disable-opencl','--disable-lsmash','--disable-swscale','--disable-ffms',`--extra-cflags=${env.CFLAGS}`,`--extra-ldflags=${env.LDFLAGS}`],dirs.x264);await run('build-x264','/usr/bin/make',['-j',String(dependencyJobs),'install'],dirs.x264)}),
 done('libvpx',async()=>{await run('configure-libvpx','./configure',[`--prefix=${prefix}`,'--target=arm64-darwin20-gcc','--disable-shared','--enable-static','--enable-pic','--enable-runtime-cpu-detect','--enable-vp9-highbitdepth','--disable-examples','--disable-tools','--disable-docs','--disable-unit-tests'],dirs.libvpx);await run('build-libvpx','/usr/bin/make',['-j',String(dependencyJobs),'install'],dirs.libvpx)}),
 done('opus',async()=>{await run('configure-opus','./configure',[`--prefix=${prefix}`,'--host=aarch64-apple-darwin','--disable-shared','--enable-static','--with-pic','--disable-doc','--disable-extra-programs'],dirs.opus);await run('build-opus','/usr/bin/make',['-j',String(dependencyJobs),'install'],dirs.opus)}),
]);
const ffmpegArgs=[`--prefix=${prefix}`,'--arch=arm64','--target-os=darwin','--cc=/usr/bin/clang','--cxx=/usr/bin/clang++','--disable-autodetect','--disable-shared','--enable-static','--enable-pic','--disable-doc','--disable-debug','--disable-ffplay','--enable-gpl','--enable-libx264','--enable-libvpx','--enable-libopus','--enable-videotoolbox','--enable-audiotoolbox','--enable-pthreads','--enable-zlib',`--pkg-config=${pkgConfig}`,'--pkg-config-flags=--static',`--extra-cflags=${env.CFLAGS} -I${path.join(prefix,'include')}`,`--extra-ldflags=${env.LDFLAGS} -L${path.join(prefix,'lib')}`];
const whisperBuild=path.join(work,'whisper-build');
const whisperArgs=['-S',dirs['whisper.cpp'],'-B',whisperBuild,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0',`-DCMAKE_OSX_SYSROOT=${sdk}`,'-DBUILD_SHARED_LIBS=OFF','-DWHISPER_BUILD_IS_DEV=OFF','-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_BUILD_SERVER=OFF','-DWHISPER_BUILD_EXAMPLES=ON','-DWHISPER_USE_SYSTEM_GGML=OFF','-DWHISPER_USE_SYSTEM_LLAMA=OFF','-DWHISPER_CURL=OFF','-DWHISPER_SDL2=OFF','-DGGML_NATIVE=OFF','-DGGML_CPU_ARM_ARCH=armv8-a','-DGGML_BACKEND_DL=OFF','-DGGML_METAL=ON','-DGGML_METAL_EMBED_LIBRARY=ON','-DGGML_BLAS=ON','-DGGML_BLAS_VENDOR=Apple','-DGGML_ACCELERATE=ON','-DGGML_OPENMP=OFF','-DGGML_CCACHE=OFF'];
await Promise.all([
 done('ffmpeg',async()=>{await run('configure-ffmpeg','./configure',ffmpegArgs,dirs.ffmpeg);await run('build-ffmpeg','/usr/bin/make',['-j',String(Math.max(1,jobs-8)),'ffmpeg','ffprobe'],dirs.ffmpeg)}),
 done('whisper',async()=>{await run('configure-whisper',cmake,whisperArgs);await run('build-whisper',cmake,['--build',whisperBuild,'--target','whisper-cli','-j',String(Math.min(jobs,8))])}),
]);
const binaries=[];
for(const [name,sourceFile] of [['ffmpeg',path.join(dirs.ffmpeg,'ffmpeg')],['ffprobe',path.join(dirs.ffmpeg,'ffprobe')],['whisper-cli',path.join(whisperBuild,'bin/whisper-cli')]]){
 const file=path.join(runtime,'bin',name);await copyFile(sourceFile,file);await chmod(file,0o755);
 await run('strip-'+name,'/usr/bin/strip',['-x',file]);await run('sign-'+name,'/usr/bin/codesign',['--force','--sign','-',file]);
 const linked=execFileSync('/usr/bin/otool',['-L',file],{encoding:'utf8'});
 const dependencies=linked.split('\n').slice(1).map(s=>s.trim().split(' (')[0]).filter(Boolean);
 if(dependencies.some(dep=>!dep.startsWith('/usr/lib/')&&!dep.startsWith('/System/Library/')))throw new Error(`${name} has a non-system dynamic dependency: ${dependencies.join(', ')}`);
 const buildVersion=execFileSync('/usr/bin/otool',['-l',file],{encoding:'utf8'}).match(/cmd LC_BUILD_VERSION[\s\S]*?minos ([^\n]+)/)?.[1]?.trim();
 if(buildVersion!=='14.0')throw new Error(`${name} minimum macOS is ${buildVersion}, expected 14.0`);
 const binaryBytes=await readFile(file);for(const privatePath of [appDir,process.env.HOME].filter(Boolean))if(binaryBytes.includes(Buffer.from(privatePath)))throw new Error(`${name} embeds a personal build path.`);
 binaries.push({name,sha256:await sha(file),size:(await stat(file)).size,architecture:execFileSync('/usr/bin/lipo',['-archs',file],{encoding:'utf8'}).trim(),minimumMacOS:buildVersion,dependencies});
}
const manifest={target:'arm64-apple-macos14.0',builtAt:new Date().toISOString(),compiler:execFileSync('/usr/bin/clang',['--version'],{encoding:'utf8'}).split('\n')[0],sdk,cmake:execFileSync(cmake,['--version'],{encoding:'utf8'}).split('\n')[0],sources:pins,binaries,configuration:{ffmpeg:ffmpegArgs,whisper:whisperArgs},patches:[],notes:['Third-party codec and inference libraries are statically linked; Apple system frameworks remain dynamic.','FFmpeg is GPL-2.0-or-later because libx264 is enabled; no --enable-version3 or nonfree components.','GGML_NATIVE is disabled and CPU baseline is armv8-a; Metal kernels are embedded.','Source archive hashes are pinned; bit-for-bit binary reproducibility across different Apple SDK/toolchain versions is not claimed.']};
await writeFile(path.join(runtime,'manifest.json'),publicJson(manifest));
await writeFile(path.join(runtime,'build-commands.json'),publicJson(commands));
await writeFile(path.join(runtime,'THIRD-PARTY-NOTICES.txt'),`Creator Compiler media runtime\n\n${pins.map(p=>`${p.name} ${p.version}: ${p.license}\n${p.url}\nFull license: licenses/${p.name}/\n`).join('\n')}\nFFmpeg and linked x264 are distributed under GPL version 2 or later. This runtime is provided without warranty. Corresponding unmodified source archives, exact build recipe and configuration are supplied alongside the app in Creator-Compiler-runtime-sources.zip.\n`);
const sourceBundle=path.join(work,'Creator-Compiler-runtime-sources');await rm(sourceBundle,{recursive:true,force:true});await mkdir(sourceBundle,{recursive:true});
await cp(sources,path.join(sourceBundle,'archives'),{recursive:true});await cp(path.join(runtime,'licenses'),path.join(sourceBundle,'licenses'),{recursive:true});
await copyFile(script,path.join(sourceBundle,'build-runtime.mjs'));for(const f of ['manifest.json','build-commands.json','THIRD-PARTY-NOTICES.txt'])await copyFile(path.join(runtime,f),path.join(sourceBundle,f));
const configs=[['ffmpeg',path.join(dirs.ffmpeg,'ffbuild/config.mak')],['x264',path.join(dirs.x264,'config.mak')],['libvpx',path.join(dirs.libvpx,'config.mk')],['opus',path.join(dirs.opus,'config.log')],['whisper',path.join(whisperBuild,'CMakeCache.txt')]];
await mkdir(path.join(sourceBundle,'configuration'));for(const [name,file] of configs)if(await exists(file))await writeFile(path.join(sourceBundle,'configuration',name+'-'+path.basename(file)),publicText(await readFile(file,'utf8')));
await writeFile(path.join(sourceBundle,'README.md'),'# Creator Compiler runtime corresponding source\n\nThe archives directory contains unmodified upstream source archives matching manifest.json. No upstream source patches are applied. To rebuild on Apple silicon macOS with Xcode, Node, CMake and pkg-config: create app/scripts and app/runtime/sources, copy build-runtime.mjs into app/scripts, copy archives/* into app/runtime/sources, then run `node app/scripts/build-runtime.mjs`. The build downloads only archives that are missing and always verifies SHA256. Build files use /tmp/sceneforge-runtime-build-<uid> with isolated HOME/TMPDIR; finished executables are in app/runtime/bin. Delete that temporary build directory for a clean rebuild after changing flags.\n\nPublished command/configuration metadata replaces the checkout application directory with ${SCENEFORGE_APP}, any builder home directory with ${BUILDER_HOME}, and the build host name with ${BUILDER_HOST}. These are documented path substitutions, not source-code modifications. Compiler file-prefix mapping changes embedded source paths to /sceneforge-runtime. Full commands and generated configurations from the distributed build are included. Apple system SDK/frameworks and the compiler are build prerequisites, not bundled source. No shell environment or credentials are exported.\n');
// Archive only source/configuration/license files; exclude Apple resource forks and raw host logs.
const zip=path.join(release,'Creator-Compiler-runtime-sources.zip');await rm(zip,{force:true});await run('package-sources','/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',sourceBundle,zip]);
console.log(JSON.stringify({runtime,binaries,sourceArchive:zip,sourceSha256:await sha(zip)},null,2));
