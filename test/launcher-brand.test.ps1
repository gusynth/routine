$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $root 'desktop/controller/launcher-brand.ps1')
[xml]$xml=Get-Content -LiteralPath (Join-Path $root 'desktop/controller/launcher.xaml') -Raw -Encoding UTF8
$window=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $xml))
[xml]$drawing=Get-Content -LiteralPath (Join-Path $root 'assets\routine-wordmark.xaml') -Raw -Encoding UTF8
$window.FindName('BrandWordmark').Source=[Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $drawing))
$state=Initialize-RoutineBrandMotion $window
if($state.Layers.Count -ne 3){throw 'RGB layers missing'}
if($window.FindName('BrandWordmarkHost').Children.Count -ne 4){throw 'Original wordmark was replaced or duplicated'}
if($state.Timer.IsEnabled){throw 'Brand effect must wait for visible window or hover'}
if ([Windows.SystemParameters]::ClientAreaAnimation) {
 $window.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.FrameworkElement]::LoadedEvent))
 $frame=New-Object Windows.Threading.DispatcherFrame
 $stop=New-Object Windows.Threading.DispatcherTimer
 $stop.Interval=[TimeSpan]::FromMilliseconds(1200)
 $stop.Add_Tick({$frame.Continue=$false;$stop.Stop()}.GetNewClosure())
 $stop.Start();[Windows.Threading.Dispatcher]::PushFrame($frame)
 if($state.Timer.IsEnabled -or $state.Frame -lt 8){throw 'RGB burst did not stop'}
 if(@($state.Layers|Where-Object {$_.Opacity -ne 0}).Count){throw 'RGB layer remained visible'}
}
$state.Timer.Stop()
$window.Close()
'PASS: native RGB layers initialize without showing a window; idle timer is stopped.'
