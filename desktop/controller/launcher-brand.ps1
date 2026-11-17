function Initialize-RoutineBrandMotion([Windows.Window]$Target) {
    $hostPanel = $Target.FindName('BrandWordmarkHost')
    $wordmark = $Target.FindName('BrandWordmark')
    if (-not $hostPanel -or -not $wordmark.Source) { return }
    $state = [pscustomobject]@{ Frame=0; Layers=@(); Timer=(New-Object Windows.Threading.DispatcherTimer) }
    foreach ($color in @('#FF4058','#67FFA5','#608AFF')) {
        $layer = New-Object Windows.Shapes.Rectangle
        $layer.Fill = New-Object Windows.Media.SolidColorBrush([Windows.Media.ColorConverter]::ConvertFromString($color))
        $layer.OpacityMask = New-Object Windows.Media.ImageBrush($wordmark.Source)
        $layer.OpacityMask.Stretch = 'Uniform'
        $layer.RenderTransform = New-Object Windows.Media.TranslateTransform
        $layer.IsHitTestVisible = $false; $layer.Opacity = 0
        $hostPanel.Children.Add($layer) | Out-Null
        $state.Layers += $layer
    }
    $state.Timer.Add_Tick({
        $state.Frame++
        if ($state.Frame -gt 7 -or -not [Windows.SystemParameters]::ClientAreaAnimation) {
            $state.Timer.Stop(); foreach ($layer in $state.Layers) { $layer.Opacity=0 }; return
        }
        $state.Timer.Interval = [TimeSpan]::FromMilliseconds(65)
        $direction = if ($state.Frame % 2) { 1 } else { -1 }
        for ($index=0; $index -lt 3; $index++) {
            $layer = $state.Layers[$index]
            $layer.Opacity = if ($state.Frame -eq 7) { 0.2 } else { 0.7 }
            $layer.RenderTransform.X = ($index - 1) * $direction * 1.4
            $layer.RenderTransform.Y = if ($index -eq 1) { -0.4 } else { 0.2 }
            $row = @(0.23,0.63,0.44)[$index] * 35
            $layer.Clip = New-Object Windows.Media.RectangleGeometry([Windows.Rect]::new(0,$row,142,2))
        }
    }.GetNewClosure())
    $run = {
        if ([Windows.SystemParameters]::ClientAreaAnimation -and -not $state.Timer.IsEnabled) {
            $state.Frame=0; $state.Timer.Interval=[TimeSpan]::FromMilliseconds(350); $state.Timer.Start()
        }
    }.GetNewClosure()
    $Target.Add_Loaded($run)
    $hostPanel.Add_MouseEnter($run)
    $Target.Add_Closed({ $state.Timer.Stop() }.GetNewClosure())
    return $state
}
