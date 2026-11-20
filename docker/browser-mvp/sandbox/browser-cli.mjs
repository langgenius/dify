#!/usr/bin/env node
// Deployment configuration is read-only; daemon identity belongs to this Home.
import {readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('/opt/dify-agent-tools/browser.json','utf8'));
const home=process.env.HOME;
if(!home)throw new Error('HOME is required');
const runtime=home+'/.browser';mkdirSync(runtime,{recursive:true});
const session=createHash('sha256').update(home).digest('hex').slice(0,16);
let args=process.argv.slice(2);
if(args[0]==='connect'){
 const endpoint=new URL(config.endpoint);
 if(!['127.0.0.1','localhost'].includes(endpoint.hostname))endpoint.hostname=(await lookup(endpoint.hostname,{family:4})).address;
 args=['start','--browserUrl='+endpoint.href,'--workspace='+process.cwd(),'--usageStatistics=false','--performanceCrux=false'];
}
const r=spawnSync('chrome-devtools',['--sessionId='+session,...args],{stdio:'inherit',env:{...process.env,XDG_RUNTIME_DIR:runtime}});
if(r.error)throw r.error;
process.exit(r.status??1);
