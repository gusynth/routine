# Execute production decision functions with fake controls/processes. No windows.
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System.Threading.Tasks;
public static class RoutineProbe { public static Task<string> Check(string url,string id){return Task.FromResult("ready");} }
'@
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\desktop\controller\launcher.ps1'),[ref]$tokens,[ref]$errors)
foreach($name in @('Show-Ready','Request-RoutineStart')){
 $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
 . ([scriptblock]::Create($definition.Extent.Text))
}
$script:openedPhone=0;$script:closedDesktop=0;$script:monitorStopped=0;$script:pollStarted=0
function Get-RoutineDesktopPath { throw 'Phone-only mode must not require the desktop executable' }
function Complete-RoutineLaunch { $script:minimized=$true }
function Show-RoutinePhone { $script:openedPhone++ }
$repair=[pscustomobject]@{Visibility='Visible';IsEnabled=$true}
$launch=[pscustomobject]@{Content='';IsEnabled=$true};$mobileOnly=[pscustomobject]@{IsEnabled=$true}
$phoneButton=[pscustomobject]@{IsEnabled=$false};$phoneHint=[pscustomobject]@{Text=''}
$status=[pscustomobject]@{Text=''};$detail=[pscustomobject]@{Text=''}
$script:browser=New-Object PSObject
$script:browser|Add-Member ScriptMethod Close {$script:closedDesktop++}
$script:desktopMonitor=New-Object PSObject
$script:desktopMonitor|Add-Member ScriptMethod Stop {$script:monitorStopped++}
$script:timer=New-Object PSObject
$script:timer|Add-Member ScriptMethod Start {$script:pollStarted++}
$url='unused';$projectId='unused';$script:manageServer=$false
Request-RoutineStart 'phone'
if($script:launchMode -ne 'phone' -or $script:pollStarted -ne 1){throw 'Phone-only startup failed'}
Show-Ready
if($script:openedPhone -ne 1 -or $script:closedDesktop -ne 1 -or $null -ne $script:browser -or -not $script:manageServer){throw 'Phone-only mode failed to keep only the server and QR flow'}
'PASS: phone-only skips desktop dependencies, closes an existing view and retains managed server/QR access.'

if(-not $script:minimized){throw "Launcher must minimize after phone access closes"}
