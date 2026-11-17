// This fixture is launched only by the explicit PowerShell lifecycle test.
if (process.argv[2] === '--child') setInterval(()=>{},1000);
else if (process.argv[2] === '--parent') {
  const child=require('node:child_process').spawn(process.execPath,[__filename,'--child'],{windowsHide:true,stdio:'ignore'});
  require('node:fs').writeFileSync(process.argv[3],JSON.stringify({parent:process.pid,child:child.pid}));
  setInterval(()=>{},1000);
}
