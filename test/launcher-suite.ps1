$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach($file in @('desktop/controller/launcher-brand.ps1','desktop/controller/launcher-paths.ps1','scripts/build-install-payload.ps1','desktop/controller/launcher.ps1','desktop/controller/launcher-phone.ps1','desktop/controller/Resolve-RoutinePort.ps1','scripts/prepare-development.ps1')){
 $tokens=$null;$errors=$null
 [Management.Automation.Language.Parser]::ParseFile((Join-Path $root $file),[ref]$tokens,[ref]$errors)|Out-Null
 if($errors.Count){throw ($errors|Out-String)}
}
'PASS: launcher and helper PowerShell syntax.'
foreach($testFile in @('launcher-layout.test.ps1','launcher-brand.test.ps1','launcher-recovery.test.ps1','native-lifecycle.test.ps1','mobile-launcher.test.ps1','launcher-modes.test.ps1','launcher-pending.test.ps1','launcher-tray.test.ps1')){
 & powershell.exe -NoProfile -STA -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $testFile)
 if($LASTEXITCODE -ne 0){throw ('Failed: '+$testFile)}
}
