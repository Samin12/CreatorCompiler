import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpSetup} from './mcp-setup';
const info={command:'/Applications/SceneForge.app/Contents/MacOS/sceneforge-mcp',args:[],toolCount:39};
test('each AI app gets its own connection text built from the advertised launcher',()=>{
 const claude=mcpSetup('claude',info);assert.equal(claude.blocks[0].text,`claude mcp add sceneforge -- ${info.command}`);assert.deepEqual(JSON.parse(claude.blocks[1].text),{mcpServers:{sceneforge:{command:info.command,args:[]}}});
 const chatgpt=mcpSetup('chatgpt',info);assert.ok(chatgpt.steps[0].includes('connectors'));assert.ok(chatgpt.blocks[1].text.includes(`command = "${info.command}"`));
 assert.deepEqual(JSON.parse(mcpSetup('other',info).blocks[0].text),JSON.parse(claude.blocks[1].text));
 assert.equal(mcpSetup('claude',{...info,command:"/Users/me/My Apps/sceneforge-mcp",args:["--it's"]}).blocks[0].text,`claude mcp add sceneforge -- '/Users/me/My Apps/sceneforge-mcp' '--it'\\''s'`);
});
