import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function buildMcpLauncher(app){
 const source=fileURLToPath(new URL('./mcp-launcher.c',import.meta.url));
 const target=path.join(app,'Contents/MacOS/creator-compiler-mcp');
 await promisify(execFile)('/usr/bin/clang',['-O2','-Wall','-Wextra','-Werror','-target','arm64-apple-macos14.0',source,'-o',target]);
 return target;
}
