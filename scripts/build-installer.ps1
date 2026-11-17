param([string]$DotNetRuntimeVersion='10.0.15')
$ErrorActionPreference='Stop'
function Get-RoutineBuildHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}}
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
try { & node scripts/build-installer-web.cjs; if($LASTEXITCODE -ne 0){throw 'Falha ao preparar interface web do instalador.'} } finally { Pop-Location }
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw|ConvertFrom-Json).version
$buildRoot=Join-Path $root ('artifacts\installer-build\'+[Guid]::NewGuid().ToString('N'))
$maintenance=Join-Path $buildRoot 'maintenance'
$setup=Join-Path $buildRoot 'setup'
$project=Join-Path $root 'installer\Routine.Setup.csproj'
$publish=@('publish',$project,'-c','Release','-r','win-x64','--self-contained','true',('-p:RuntimeFrameworkVersion='+$DotNetRuntimeVersion),'-p:DebugType=None','-p:DebugSymbols=false','-p:NuGetAudit=false')
& dotnet @publish ('-p:IntermediateOutputPath='+ (Join-Path $buildRoot 'obj-maintenance\')) '-p:PayloadPath=' -o $maintenance
if($LASTEXITCODE -ne 0){throw 'Falha ao compilar desinstalador.'}
$payloadLog=Join-Path $buildRoot 'payload.log'
New-Item -ItemType Directory -Force -Path $buildRoot|Out-Null
& (Join-Path $PSScriptRoot 'build-install-payload.ps1') -MaintenancePath (Join-Path $maintenance 'Routine.Setup.exe') -DotNetRuntimeVersion $DotNetRuntimeVersion | Tee-Object -FilePath $payloadLog
if($LASTEXITCODE -ne 0){throw 'Falha no payload.'}
$payloadLine=Get-Content -LiteralPath $payloadLog|Where-Object {$_ -like 'Internal installer payload*'}|Select-Object -Last 1
if(-not $payloadLine){throw 'Payload nao identificado.'}
$payload=$payloadLine.Substring($payloadLine.IndexOf(': ')+2)
& dotnet @publish ('-p:IntermediateOutputPath='+ (Join-Path $buildRoot 'obj-setup\')) ('-p:PayloadPath='+$payload) -o $setup
if($LASTEXITCODE -ne 0){throw 'Falha ao compilar Setup completo.'}
$release=Join-Path $root 'releases';New-Item -ItemType Directory -Force -Path $release|Out-Null
$output=Join-Path $release ('Routine-'+$version+'-Setup.exe')
try { Copy-Item -LiteralPath (Join-Path $setup 'Routine.Setup.exe') -Destination $output -Force }
catch [System.IO.IOException] {
    # Do not interrupt a user's open installer just to replace the build.
    $output=Join-Path $release ('Routine-'+$version+'-Setup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.exe')
    Copy-Item -LiteralPath (Join-Path $setup 'Routine.Setup.exe') -Destination $output
}
$hash=Get-RoutineBuildHash $output
[IO.File]::WriteAllText(($output+'.sha256'),$hash+'  '+[IO.Path]::GetFileName($output)+[Environment]::NewLine,[Text.Encoding]::ASCII)
$report=@{version=$version;architecture='win-x64';dotNet=$DotNetRuntimeVersion;sha256=$hash;bytes=(Get-Item -LiteralPath $output).Length;payloadSha256=(Get-RoutineBuildHash $payload);signed=$false;type='installer'}
[IO.File]::WriteAllText(($output+'.build.json'),($report|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output ('INSTALLER: '+$output)
Write-Output ('BUILD WORKSPACE: '+$buildRoot)
Write-Output ('PAYLOAD: '+$payload)
