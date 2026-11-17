param([switch]$SkipDesktopBuild)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $SkipDesktopBuild){
 & dotnet publish (Join-Path $root 'desktop\RoutineDesktop.csproj') -c Release -o (Join-Path $root 'desktop\app') --no-self-contained -p:NuGetAudit=false
 if($LASTEXITCODE -ne 0){throw 'Desktop build failed.'}
}
$destination=Join-Path $root 'desktop\dev'
New-Item -ItemType Directory -Force -Path $destination|Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /define:DEVELOPMENT /reference:System.Windows.Forms.dll ('/win32icon:'+(Join-Path $root 'assets\routine.ico')) ('/out:'+(Join-Path $destination 'Routine.exe')) (Join-Path $root 'desktop\LauncherBootstrap.cs')
if($LASTEXITCODE -ne 0){throw 'Development entry point build failed.'}
Write-Output ('Development entry point: '+(Join-Path $destination 'Routine.exe'))
