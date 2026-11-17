$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archive=Get-ChildItem -LiteralPath (Join-Path $root 'releases') -Filter '*.zip'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('routine-update-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary|Out-Null
try{
 $source=Join-Path $temporary 'source';$target=Join-Path $temporary 'target'
 [IO.Compression.ZipFile]::ExtractToDirectory($archive.FullName,$source)
 foreach($forbidden in @('database.json','.runtime','backups','node_modules')){if(Test-Path -LiteralPath (Join-Path $source $forbidden)){throw ('Private data in package: '+$forbidden)}}
 New-Item -ItemType Directory -Force -Path (Join-Path $target '.runtime'),(Join-Path $target 'backups'),(Join-Path $target 'public')|Out-Null
 Set-Content -LiteralPath (Join-Path $target 'package.json') -Value '{"name":"routine"}'
 Set-Content -LiteralPath (Join-Path $target 'database.json') -Value 'PRIVATE-DATABASE'
 Set-Content -LiteralPath (Join-Path $target '.runtime/preferences.json') -Value 'PRIVATE-PREFERENCES'
 Set-Content -LiteralPath (Join-Path $target 'backups/example.json') -Value 'PRIVATE-BACKUP'
 Set-Content -LiteralPath (Join-Path $target 'public/app.js') -Value 'OLD-APP'
 function global:Get-NetTCPConnection {param($LocalPort,$State,$ErrorAction) return $null}
 function global:npm { $global:LASTEXITCODE=0 }
 & (Join-Path $source 'Aplicar atualizacao.ps1') -Target $target
 if((Get-Content -LiteralPath (Join-Path $target 'database.json')) -ne 'PRIVATE-DATABASE'){throw 'Database changed'}
 if((Get-Content -LiteralPath (Join-Path $target '.runtime/preferences.json')) -ne 'PRIVATE-PREFERENCES'){throw 'Preferences changed'}
 if((Get-Content -LiteralPath (Join-Path $target 'backups/example.json')) -ne 'PRIVATE-BACKUP'){throw 'Backup changed'}
 if((Get-FileHash (Join-Path $target 'public/app.js')).Hash -ne (Get-FileHash (Join-Path $source 'public/app.js')).Hash){throw 'App was not updated'}
 if(Test-Path -LiteralPath (Join-Path $target 'public/public')){throw 'Nested copy error'}
 'PASS: package excludes private data; updating replaces application files and preserves database/backups/preferences. Dependency installation mocked.'
}finally{
 Remove-Item Function:\npm -ErrorAction SilentlyContinue
 Remove-Item Function:\Get-NetTCPConnection -ErrorAction SilentlyContinue
 $resolved=[IO.Path]::GetFullPath($temporary)
 if($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path $resolved -Leaf) -like 'routine-update-test-*'){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
