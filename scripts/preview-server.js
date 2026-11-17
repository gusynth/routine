// Disposable QA server. Never reads or modifies the user's database.json.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'routine-preview-'));
 process.env.ROUTINE_DB=path.join(dir,'database.json');process.env.PORT='0';
 const server=await require('../server').start();
 let ending=false;
 async function stop(){if(ending)return;ending=true;server.closeAllConnections();await new Promise(r=>server.close(r));if(path.resolve(dir).startsWith(path.join(os.tmpdir(),'routine-preview-')))await fs.rm(dir,{recursive:true,force:true});process.exit(0)}
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
})().catch(e=>{console.error(e);process.exitCode=1});
