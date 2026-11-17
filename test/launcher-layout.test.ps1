$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\desktop\controller\launcher-paths.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('routine-layout-'+[Guid]::NewGuid().ToString('N'))
$oldLocal=$env:LOCALAPPDATA;$oldData=$env:ROUTINE_DATA_DIR
New-Item -ItemType Directory -Path $fixture|Out-Null
try {
 Remove-Item Env:ROUTINE_DATA_DIR -ErrorAction SilentlyContinue
 $env:LOCALAPPDATA=Join-Path $fixture 'fake-user'
 if((Get-RoutineDataRoot $fixture) -ne (Join-Path $env:LOCALAPPDATA 'Routine')){throw 'Development data must be outside code'}
 [IO.File]::WriteAllText((Join-Path $fixture 'routine.install.json'),'ABORT-INVALID-MARKER')
 $rejected=$false;try{Get-RoutineDataRoot $fixture|Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Invalid marker accepted'}
 [IO.File]::WriteAllText((Join-Path $fixture 'routine.install.json'),'{"appId":"Routine","layoutVersion":1}')
 $env:LOCALAPPDATA=Join-Path $fixture 'fake-user'
 if((Get-RoutineDataRoot $fixture) -ne (Join-Path $env:LOCALAPPDATA 'Routine')){throw 'Installed data path wrong'}
 $env:ROUTINE_DATA_DIR=Join-Path $fixture 'override'
 if((Get-RoutineDataRoot $fixture) -ne $env:ROUTINE_DATA_DIR){throw 'Explicit data root ignored'}
 $rejected=$false;try{Get-RoutineNodePath $fixture|Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Installed package used global Node'}
 New-Item -ItemType Directory -Path (Join-Path $fixture 'runtime\node')|Out-Null
 [IO.File]::WriteAllText((Join-Path $fixture 'runtime\node\node.exe'),'fixture only, never executed')
 if((Get-RoutineNodePath $fixture) -ne (Join-Path $fixture 'runtime\node\node.exe')){throw 'Bundled runtime not preferred'}
 'PASS: source/installed data layout, custom data root and bundled runtime selection; no program started.'
} finally {
 $env:LOCALAPPDATA=$oldLocal;$env:ROUTINE_DATA_DIR=$oldData
 $resolved=[IO.Path]::GetFullPath($fixture)
 if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path $resolved -Leaf) -like 'routine-layout-*'){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
