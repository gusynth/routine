# Pure network selection and XAML parsing; no adapter reads or windows are opened.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Add-Type -Path (Join-Path $root 'desktop/controller/launcher-network.cs') -ReferencedAssemblies @('System.dll','System.Core.dll')
foreach($ip in @('192.168.1.50','10.0.0.2','172.16.1.5')){if(-not [RoutineLan]::IsUsableIPv4($ip)){throw ('Rejected LAN address '+$ip)}}
foreach($ip in @('127.0.0.1','169.254.1.3','0.0.0.0','224.0.0.1','::1','192.168.0.1/evil')){if([RoutineLan]::IsUsableIPv4($ip)){throw ('Accepted invalid address '+$ip)}}
$candidates=@(
 [RoutineLanAddress]@{Address='172.20.0.2';Name='Virtual';Priority=50},
 [RoutineLanAddress]@{Address='192.168.1.50';Name='Wi-Fi';Priority=0},
 [RoutineLanAddress]@{Address='10.0.0.2';Name='Ethernet';Priority=5},
 [RoutineLanAddress]@{Address='192.168.1.50';Name='Duplicate';Priority=60}
)
$ordered=[RoutineLan]::Sort([RoutineLanAddress[]]$candidates)
if($ordered.Count -ne 3 -or $ordered[0].Name -ne 'Wi-Fi' -or $ordered[0].Url -ne 'http://192.168.1.50:3000'){throw 'Incorrect network ordering or URL'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'desktop/controller/launcher-phone.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Phone helper syntax failed'}
$markup=$ast.Find({param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.StartsWith('<Window')},$true)
[xml]$xml=$markup.Value
if($xml.DocumentElement.LocalName -ne 'Window'){throw 'Phone XAML is not a Window'}
foreach($name in @('PhoneQr','PhoneCopy','PhoneNetworks','PhoneRefresh','PhoneClose')){if(-not $xml.SelectSingleNode("//*[@*[local-name()='Name']='$name']")){throw ('Missing control '+$name)}}
# Validate WPF properties/templates without showing a window or creating a UI handle.
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$component=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $xml))
if($component.IsVisible){throw 'Headless component unexpectedly visible'}
$component.Close()
[xml]$mainMarkup=Get-Content -LiteralPath (Join-Path $root 'desktop/controller/launcher.xaml') -Raw -Encoding UTF8
$mainComponent=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $mainMarkup))
if(-not $mainComponent.FindName('MobileOnly') -or -not $mainComponent.FindName('Launch')){throw 'Missing PC/phone choices'}
$mainComponent.Close()
'PASS: LAN address validation, network priority, URL and phone XAML; no desktop interaction.'

[xml]$vector=Get-Content -LiteralPath (Join-Path $root 'assets/routine-wordmark.xaml') -Raw -Encoding UTF8
$drawing=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $vector))
if($drawing -isnot [Windows.Media.DrawingImage] -or $drawing.Drawing.Children.Count -ne 7){throw 'Official wordmark vector did not load correctly'}
[xml]$reduced=Get-Content -LiteralPath (Join-Path $root 'desktop/controller/launcher.xaml') -Raw -Encoding UTF8
$reduced.SelectSingleNode("//*[@*[local-name()='Key']='MotionDuration']").InnerText='0:0:0'
$quiet=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $reduced))
if($quiet.Resources['MotionDuration'].TimeSpan -ne [TimeSpan]::Zero){throw 'Reduced-motion duration failed'}
$quiet.Close()
'PASS: official wordmark drawing and reduced-motion resources load without showing a window.'
