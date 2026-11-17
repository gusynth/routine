param([Parameter(Mandatory=$true)][string]$MaintenancePath,[string]$NodeRuntime = (Get-Command node.exe -ErrorAction Stop).Source, [string]$DotNetRuntimeVersion = '10.0.15')
$ErrorActionPreference = 'Stop'
function Get-RoutineBuildHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$release = Join-Path $root 'artifacts\installer-payload'
$staging = Join-Path $release ('windows-' + [Guid]::NewGuid().ToString('N'))
$destination = Join-Path $staging 'Routine'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$nodeInfo = (& $NodeRuntime -p 'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $nodeInfo.platform -ne 'win32' -or $nodeInfo.arch -ne 'x64' -or [int]($nodeInfo.version.Split('.')[0].TrimStart('v')) -lt 22) { throw 'Use um runtime Node.js Windows x64 >= 22.' }
$files = @('server.js','package.json','package-lock.json','lib','public','assets','desktop/controller','LICENSE','README.md','SECURITY.md','THIRD_PARTY_NOTICES.md')
foreach ($relative in $files) {
    $target=Join-Path $destination $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $target -Recurse
}
[IO.File]::WriteAllText((Join-Path $destination 'routine.install.json'), (@{ appId='Routine';layoutVersion=1;dataMode='user';version=$version } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$nodeDirectory = Join-Path $destination 'runtime\node'
New-Item -ItemType Directory -Force -Path $nodeDirectory | Out-Null
Copy-Item -LiteralPath $NodeRuntime -Destination (Join-Path $nodeDirectory 'node.exe')
# Preserve the license for the exact runtime shipped, not a license from HEAD.
Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/nodejs/node/' + $nodeInfo.version + '/LICENSE') -OutFile (Join-Path $nodeDirectory 'LICENSE.txt')
Push-Location $destination
try { & npm.cmd ci --omit=dev --ignore-scripts; if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar dependencias de producao.' } } finally { Pop-Location }
& dotnet publish (Join-Path $root 'desktop\RoutineDesktop.csproj') -c Release -r win-x64 --self-contained true ('-p:RuntimeFrameworkVersion=' + $DotNetRuntimeVersion) -p:DebugType=None -p:DebugSymbols=false -p:NuGetAudit=false -o (Join-Path $destination 'desktop\app')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar desktop autocontido.' }
$runtimeConfig = Get-Content -LiteralPath (Join-Path $destination 'desktop\app\RoutineDesktop.runtimeconfig.json') -Raw | ConvertFrom-Json
if (@($runtimeConfig.runtimeOptions.includedFrameworks | Where-Object { $_.version -ne $DotNetRuntimeVersion }).Count) { throw 'Runtime publicado difere da versao solicitada.' }
$licenseRoot=Join-Path $destination 'runtime\licenses';New-Item -ItemType Directory -Force -Path $licenseRoot|Out-Null
Copy-Item -LiteralPath (Join-Path $root 'installer\web\lucide-LICENSE.txt') -Destination (Join-Path $licenseRoot 'lucide-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $root 'installer\Fonts\OFL.txt') -Destination (Join-Path $licenseRoot 'inter-OFL.txt')
$nugetCache=if($env:NUGET_PACKAGES){$env:NUGET_PACKAGES}else{Join-Path $env:USERPROFILE '.nuget\packages'}
$runtimeLicenses=@{
 'dotnet-LICENSE.txt'=('microsoft.netcore.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\LICENSE.TXT');
 'dotnet-THIRD-PARTY-NOTICES.txt'=('microsoft.netcore.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\THIRD-PARTY-NOTICES.TXT');
 'windowsdesktop-LICENSE.txt'=('microsoft.windowsdesktop.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\LICENSE');
 'webview2-LICENSE.txt'='microsoft.web.webview2\1.0.4314.35\LICENSE.txt';
 'webview2-NOTICE.txt'='microsoft.web.webview2\1.0.4314.35\NOTICE.txt'
}
foreach($name in $runtimeLicenses.Keys){Copy-Item -LiteralPath (Join-Path $nugetCache $runtimeLicenses[$name]) -Destination (Join-Path $licenseRoot $name)}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $root 'assets\routine.ico')) ('/out:' + (Join-Path $destination 'Routine.exe')) (Join-Path $root 'desktop\LauncherBootstrap.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar abertura Routine.exe.' }
if(-not(Test-Path -LiteralPath $MaintenancePath)){throw 'Desinstalador compilado ausente.'}
New-Item -ItemType Directory -Force -Path (Join-Path $destination 'maintenance')|Out-Null
Copy-Item -LiteralPath $MaintenancePath -Destination (Join-Path $destination 'maintenance\Routine.Setup.exe')
$hashes = @{}
Get-ChildItem -LiteralPath $destination -Recurse -File | ForEach-Object { $name=$_.FullName.Substring($destination.Length+1).Replace('\','/'); $hashes[$name]=Get-RoutineBuildHash $_.FullName }
$manifest = @{ version=$version;layoutVersion=1;architecture='win-x64';node=$nodeInfo.version;dotNet=$DotNetRuntimeVersion;webView2='Evergreen Runtime required';files=$hashes } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $destination 'PROGRAM-MANIFEST.json'),$manifest,[Text.UTF8Encoding]::new($false))
$archive = Join-Path $staging 'Routine-payload.zip'
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$payloadZip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
try {
 Get-ChildItem -LiteralPath $destination -Recurse -File|ForEach-Object {
  $entry='Routine/'+$_.FullName.Substring($destination.Length+1).Replace('\','/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($payloadZip,$_.FullName,$entry,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }
} finally {$payloadZip.Dispose()}
((Get-RoutineBuildHash $archive) + '  ' + [IO.Path]::GetFileName($archive)) | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ASCII
Write-Output ('Program directory: ' + $destination)
Write-Output ('Internal installer payload (not a portable release): ' + $archive)
