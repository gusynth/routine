# Exercise the production pre-close decision without showing any dialog.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\desktop\controller\launcher.ps1'),[ref]$tokens,[ref]$errors)
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-RoutineShutdownWarning'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
$script:manageServer=$true;$script:launchMode='phone';$script:browser=$null
$projectId='fixture';$runtime='unused';$url='http://127.0.0.1:3000';$script:pending=1;$script:identity='fixture'
function Get-Content { param($LiteralPath,[switch]$Raw) '{"projectId":"fixture","pid":123,"port":3000,"token":"test-token"}' }
function Invoke-RestMethod { param($Uri,$TimeoutSec,$Headers)
 if($Uri -like '*/api/health'){return [pscustomobject]@{projectId=$script:identity;pid=123}}
 if($Headers['X-Routine-Token'] -ne 'test-token'){throw 'Missing token'}
 return [pscustomobject]@{pending=$script:pending}
}
if(-not (Get-RoutineShutdownWarning)){throw 'Pending phone must warn before closing'}
$script:pending=0;if(Get-RoutineShutdownWarning){throw 'Clean devices must not warn'}
$script:pending=1;$script:identity='other';if(Get-RoutineShutdownWarning){throw 'Must ignore another project'}
$script:identity='fixture';$script:manageServer=$false;if(Get-RoutineShutdownWarning){throw 'Must ignore an unmanaged server'}
$script:manageServer=$true;$script:launchMode='desktop';$script:browser=[pscustomobject]@{IsRunning=$false}
if(Get-RoutineShutdownWarning){throw 'Desktop already prompts before its own close; avoid a duplicate prompt'}
'PASS: pending work warns, clean/unmanaged devices do not, and desktop close avoids a duplicate prompt.'
