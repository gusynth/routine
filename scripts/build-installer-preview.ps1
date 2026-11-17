param([string]$DotNetRuntimeVersion='10.0.15')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=Join-Path $root 'artifacts\installer-web-preview'
& dotnet publish (Join-Path $root 'installer\preview\Routine.Setup.Preview.csproj') -c Release -r win-x64 --self-contained true ('-p:RuntimeFrameworkVersion='+$DotNetRuntimeVersion) -p:DebugType=None -p:DebugSymbols=false -p:NuGetAudit=false -o $output
if($LASTEXITCODE -ne 0){throw 'Falha ao compilar previa WebView2.'}
$release=Join-Path $root 'releases';New-Item -ItemType Directory -Force -Path $release|Out-Null
$file=Join-Path $release 'Routine-Installer-Preview.exe'
Copy-Item -LiteralPath (Join-Path $output 'Routine.Setup.Preview.exe') -Destination $file -Force
$stream=[IO.File]::OpenRead($file);$sha=[Security.Cryptography.SHA256]::Create()
try{$hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
[IO.File]::WriteAllText(($file+'.sha256'),$hash+'  '+[IO.Path]::GetFileName($file)+[Environment]::NewLine,[Text.Encoding]::ASCII)
$cache=if($env:NUGET_PACKAGES){$env:NUGET_PACKAGES}else{Join-Path $env:USERPROFILE '.nuget\packages'}
$licenseFiles=@(
 (Join-Path $root 'LICENSE'),(Join-Path $root 'installer\Fonts\OFL.txt'),(Join-Path $root 'installer\web\lucide-LICENSE.txt'),
 (Join-Path $cache ('microsoft.netcore.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\LICENSE.TXT')),
 (Join-Path $cache ('microsoft.netcore.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\THIRD-PARTY-NOTICES.TXT')),
 (Join-Path $cache ('microsoft.windowsdesktop.app.runtime.win-x64\'+$DotNetRuntimeVersion+'\LICENSE')),
 (Join-Path $cache 'microsoft.web.webview2\1.0.4314.35\LICENSE.txt'),
 (Join-Path $cache 'microsoft.web.webview2\1.0.4314.35\NOTICE.txt')
)
$text='Routine installer visual preview - simulation only.'+[Environment]::NewLine
foreach($license in $licenseFiles){$text+=[Environment]::NewLine+[IO.Path]::GetFileName($license)+[Environment]::NewLine+[IO.File]::ReadAllText($license)+[Environment]::NewLine}
[IO.File]::WriteAllText((Join-Path $release 'Routine-Installer-Preview-NOTICES.txt'),$text,[Text.UTF8Encoding]::new($false))
Write-Output ('PREVIEW: '+$file)
Write-Output ('SHA256: '+$hash)
