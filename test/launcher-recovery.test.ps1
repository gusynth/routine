# Headless regression: execute only the launcher's timer callback with fake
# controls, fake processes and a fake probe. No windows, network or process stops.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System.Threading.Tasks;
public static class RoutineProbe {
    public static string Result="occupied";
    public static Task<string> Check(string url,string id){return Task.FromResult(Result);}
}
'@
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\desktop\controller\launcher.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Launcher parse failed'}
$registration=$ast.Find({param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Value -eq 'Add_Tick' -and $node.Expression.Extent.Text -eq '$script:timer'},$true)
$tick=$registration.Arguments[0].ScriptBlock.GetScriptBlock()
$script:starts=0; $script:shown=0; $script:stopped=0
function Start-RoutineServer { $script:starts++ }
function Show-Ready { $script:shown++ }
$status=[pscustomobject]@{Text=''}; $detail=[pscustomobject]@{Text=''}
$launch=[pscustomobject]@{IsEnabled=$false}; $repair=[pscustomobject]@{IsEnabled=$false;Visibility='Collapsed'}
$script:timer=New-Object PSObject
$script:timer|Add-Member ScriptMethod Stop { $script:stopped++ }
$script:recovery=[pscustomobject]@{IsCompleted=$true}
$script:recoveryWorker=New-Object PSObject
$script:recoveryWorker|Add-Member ScriptMethod EndInvoke {param($handle) [pscustomobject]@{Status='cleared';Message='Porta livre.'}}
$script:recoveryWorker|Add-Member ScriptMethod Dispose {}
$script:phase='repairing'; $script:probe=$null
$script:serverProcess=[pscustomobject]@{HasExited=$false}
$url='unused'; $projectId='unused'
& $tick
if($script:starts -ne 1 -or $script:phase -ne 'starting'){throw 'Repair must start the server directly'}
& $tick # creates fake completed probe
& $tick # occupied while starting must keep waiting, not report a conflict
if($script:stopped -ne 0 -or $status.Text -ne ''){throw 'Starting server incorrectly returned to conflict handling'}
[RoutineProbe]::Result='ready'
& $tick
& $tick
if($script:shown -ne 1 -or $script:stopped -ne 1){throw 'Ready server must open the app once'}
'PASS: free -> start -> occupied while warming up -> ready; no duplicate start or false conflict.'
