# No browser or windows: exercise the ownership job using two dummy Node processes.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Add-Type -Path (Join-Path $root 'desktop/controller/launcher-native.cs') -ReferencedAssemblies @('System.dll','System.Core.dll',[Net.Http.HttpClient].Assembly.Location)
$dir=Join-Path ([IO.Path]::GetTempPath()) ('routine-job-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
$job=$null; $child=$null
try {
 $state=Join-Path $dir 'state.json';$fixture=Join-Path $root 'scripts\job-child.fixture.cjs'
 $job=New-Object RoutineBrowser((Get-Command node.exe).Source,('"'+$fixture+'" --parent "'+$state+'"'),$root)
 $deadline=[DateTime]::UtcNow.AddSeconds(5)
 while(-not(Test-Path -LiteralPath $state)){if([DateTime]::UtcNow -gt $deadline){throw 'Fixture did not start'};Start-Sleep -Milliseconds 40}
 $ids=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
 $child=[Diagnostics.Process]::GetProcessById($ids.child)
 if(-not $job.IsRunning -or $child.HasExited){throw 'Owned process tree is not running'}
 $job.Dispose()
 if($job.IsRunning -or -not $child.WaitForExit(3000)){throw 'Job failed to stop its process tree'}
 'PASS: closing ownership job stopped the dummy parent and child; no browser or desktop interaction.'
} finally {
 if($job){$job.Dispose()};if($child){$child.Dispose()}
 $resolved=[IO.Path]::GetFullPath($dir)
 $allowed=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\routine-job-'
 if($resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
