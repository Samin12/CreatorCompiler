export type MCPInfo={command:string;args:string[];toolCount:number};
export type MCPApp='chatgpt'|'claude'|'other';
const quote=(text:string)=>/^[\w@%+=:,./-]+$/.test(text)?text:`'${text.replace(/'/g,`'\\''`)}'`;
/** Connection steps and copyable text per AI app, built from the launcher the running service advertises. */
export function mcpSetup(app:MCPApp,info:MCPInfo){
 const args=info.args||[],command=[info.command,...args].map(quote).join(' '),json=JSON.stringify({mcpServers:{sceneforge:{command:info.command,args}}},null,2);
 if(app==='claude')return {steps:['Claude Code: run this command in Terminal, then start a new Claude Code session.','Claude Desktop: open Settings › Developer › Edit Config, add the sceneforge entry to claude_desktop_config.json, then restart Claude.'],blocks:[{label:'Claude Code command',text:`claude mcp add sceneforge -- ${command}`},{label:'Claude Desktop configuration',text:json}]};
 if(app==='chatgpt')return {steps:['ChatGPT connects to MCP servers through connectors, which need a remote HTTPS server, so the ChatGPT app cannot launch this local MCP directly. Use a ChatGPT client with local MCP support, such as Codex on this Mac.','Codex: run the command in Terminal, or add the entry to ~/.codex/config.toml, then start a new session.'],blocks:[{label:'Codex command',text:`codex mcp add sceneforge -- ${command}`},{label:'Codex configuration (config.toml)',text:`[mcp_servers.sceneforge]\ncommand = ${JSON.stringify(info.command)}\nargs = ${JSON.stringify(args)}`}]};
 return {steps:['Add this entry to your AI app’s MCP configuration, using the stdio transport, then refresh its tool list.','The launcher starts the local SceneForge studio service when needed.'],blocks:[{label:'MCP configuration',text:json}]};
}
