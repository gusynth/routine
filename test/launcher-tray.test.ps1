$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\desktop\controller\launcher.ps1'),[ref]$tokens,[ref]$errors)
foreach($name in @('Hide-RoutineLauncher','Restore-RoutineLauncher')){
 $definition=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 . ([scriptblock]::Create($definition.Extent.Text))
}
$window=[pscustomobject]@{ShowInTaskbar=$true;WindowState='Minimized';Hidden=$false;Activated=$false}
$window|Add-Member ScriptMethod Hide {$this.Hidden=$true}
$window|Add-Member ScriptMethod Show {$this.Hidden=$false}
$window|Add-Member ScriptMethod Activate {$this.Activated=$true;return $true}
$script:tray=[pscustomobject]@{Visible=$false}
$script:manageServer=$true
Hide-RoutineLauncher
if($window.ShowInTaskbar -or -not $window.Hidden -or -not $script:tray.Visible -or -not $script:manageServer){throw 'Tray hide must preserve the managed server and remove taskbar entry'}
Restore-RoutineLauncher
if(-not $window.ShowInTaskbar -or $window.Hidden -or $script:tray.Visible -or -not $window.Activated -or $window.WindowState -ne 'Normal'){throw 'Tray restore failed'}
'PASS: taskbar hide and tray restore preserve the server; fake controls only, no notification icon created.'
