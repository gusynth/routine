param([switch]$Direct,[switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
trap {
    $failure = $_ | Out-String
    try { $failureRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Routine\.runtime'; [IO.Directory]::CreateDirectory($failureRoot)|Out-Null; [IO.File]::WriteAllText((Join-Path $failureRoot 'startup-error.log'),$failure) } catch { }
    if ($ValidateOnly) { Write-Error $failure -ErrorAction Continue } else { try { Add-Type -AssemblyName PresentationFramework; [Windows.MessageBox]::Show('R-START-001 · Não foi possível iniciar o Routine. Seus registros foram preservados. Consulte startup-error.log na pasta de dados do Routine.','Routine')|Out-Null } catch { } }
    exit 1
}
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RoutineWindowTheme {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
'@
Add-Type -Path (Join-Path $PSScriptRoot 'launcher-network.cs') -ReferencedAssemblies @('System.dll','System.Core.dll')
Add-Type -AssemblyName System.Net.Http
Add-Type -Path (Join-Path $PSScriptRoot 'launcher-native.cs') -ReferencedAssemblies @('System.dll', 'System.Core.dll', [Net.Http.HttpClient].Assembly.Location)
[RoutineWindowTheme]::SetCurrentProcessExplicitAppUserModelID("Routine.Launcher") | Out-Null
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'launcher-paths.ps1')
. (Join-Path $PSScriptRoot 'launcher-brand.ps1')
try { $dataRoot = Get-RoutineDataRoot $root }
catch { [Windows.MessageBox]::Show($_.Exception.Message,'Routine') | Out-Null; $ErrorActionPreference='Stop'; throw }
$url = 'http://127.0.0.1:3000'
$hash = [Security.Cryptography.SHA256]::Create()
$projectId = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($root).ToLowerInvariant())))).Replace('-', '').ToLowerInvariant()
$hash.Dispose()
# A named mutex prevents two launcher windows from starting competing servers.
$mutex = New-Object Threading.Mutex($false, ('Local\RoutineLauncher-' + $projectId))
if (-not $mutex.WaitOne(0)) {
    try { $signal = [Threading.EventWaitHandle]::OpenExisting('Local\RoutineOpen-' + $projectId); $signal.Set() | Out-Null; $signal.Dispose() } catch { }
    $mutex.Dispose()
    exit
}

[xml]$xaml = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher.xaml') -Raw -Encoding UTF8
if (-not [Windows.SystemParameters]::ClientAreaAnimation) {
    $motionNode = $xaml.SelectSingleNode("//*[@*[local-name()='Key']='MotionDuration']")
    if ($motionNode) { $motionNode.InnerText = '0:0:0' }
}
$reader = New-Object Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$window.MaxHeight = [Windows.SystemParameters]::WorkArea.Height - 32
$iconFile = Join-Path $root 'assets\routine-launcher-official.ico'
if (Test-Path -LiteralPath $iconFile) {
    $window.Icon = [Windows.Media.Imaging.BitmapFrame]::Create([Uri]::new($iconFile))
}
$brandFile = Join-Path $root 'assets\routine.png'
if (Test-Path -LiteralPath $brandFile) { $window.FindName('BrandMark').Source = [Windows.Media.Imaging.BitmapFrame]::Create([Uri]::new($brandFile)) }
$wordmarkFile = Join-Path $root 'assets\routine-wordmark.xaml'
if (Test-Path -LiteralPath $wordmarkFile) {
    [xml]$wordmarkXaml = Get-Content -LiteralPath $wordmarkFile -Raw -Encoding UTF8
    $window.FindName('BrandWordmark').Source = [Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $wordmarkXaml))
}
$script:brandMotion = Initialize-RoutineBrandMotion $window
$window.Add_Loaded({
    if ([Windows.SystemParameters]::ClientAreaAnimation) {
        $content = $window.FindName('LauncherContent')
        $fade = New-Object Windows.Media.Animation.DoubleAnimation(0,1,[Windows.Duration]::new([TimeSpan]::FromMilliseconds(240)))
        $slide = New-Object Windows.Media.Animation.DoubleAnimation(8,0,[Windows.Duration]::new([TimeSpan]::FromMilliseconds(260)))
        $content.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)
        $content.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty,$slide)
    }
})
function Set-SystemTitleBar([Windows.Window]$target = $window) {
    try {
        $theme = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
        $dark = 0
        if ($null -ne $theme -and $theme.AppsUseLightTheme -eq 0) { $dark = 1 }
        $handle = (New-Object Windows.Interop.WindowInteropHelper($target)).Handle
        if ($handle -ne [IntPtr]::Zero) {
            # Windows 10/11 immersive title bar; older Windows 10 uses attribute 19.
            $result = [RoutineWindowTheme]::DwmSetWindowAttribute($handle, 20, [ref]$dark, 4)
            if ($result -ne 0) { [RoutineWindowTheme]::DwmSetWindowAttribute($handle, 19, [ref]$dark, 4) | Out-Null }
        }
    } catch { } # Unsupported Windows versions retain their native title bar.
}
$window.Add_SourceInitialized({ Set-SystemTitleBar })
$window.Add_Activated({ Set-SystemTitleBar })
$status = $window.FindName('Status'); $detail = $window.FindName('Detail')
$launch = $window.FindName('Launch'); $repair = $window.FindName('Repair')
$mobileOnly = $window.FindName('MobileOnly')
$phoneButton = $window.FindName('Phone'); $phoneHint = $window.FindName('PhoneHint')
$window.FindName('CloseLauncher').Add_Click({ $window.Close() })
$script:timer = $null
$script:browser = $null
$script:probe = $null
$script:serverProcess = $null
$script:launchMode = 'desktop'
$script:manageServer = $false
$runtime = Join-Path $dataRoot '.runtime'
$logFile = Join-Path $runtime 'server.log'
$errorFile = Join-Path $runtime 'server-error.log'
. (Join-Path $PSScriptRoot 'launcher-phone.ps1')
$phoneButton.Add_Click({ Show-RoutinePhone })
function Get-RoutineDesktopPath {
    $executable = Join-Path $root 'desktop\app\RoutineDesktop.exe'
    if (Test-Path -LiteralPath $executable) { return $executable }
    throw 'R-START-002 · O desktop nao esta compilado. No desenvolvimento, execute npm run desktop:prepare. Na instalacao, reinstale o Routine; seus dados ficam separados.'
}
function Restore-RoutineLauncher {
    if ($Direct -and $script:phase -ne 'error') { Request-RoutineStart 'desktop'; return }
    $window.ShowInTaskbar = $true
    $window.Show()
    $window.WindowState = 'Normal'
    $window.Activate() | Out-Null
    if ($script:tray) { $script:tray.Visible = $false }
}
function Hide-RoutineLauncher {
    if (-not $script:tray) {
        try {
            $script:tray = New-Object Windows.Forms.NotifyIcon
            $script:trayIcon = New-Object Drawing.Icon($iconFile)
            $script:tray.Icon = $script:trayIcon
            $script:tray.Text = 'Routine | Servidor ativo'
            $menu = New-Object Windows.Forms.ContextMenuStrip
            $open = $menu.Items.Add('Abrir Routine')
            $open.Add_Click({ Restore-RoutineLauncher })
            $phone = $menu.Items.Add('Ver QR Code do celular')
            $phone.Add_Click({ if ($script:manageServer) { Show-RoutinePhone } })
            $null = $menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
            $exit = $menu.Items.Add('Encerrar Routine')
            $exit.Add_Click({ $window.Close() })
            $script:tray.ContextMenuStrip = $menu
            $script:tray.Add_DoubleClick({ Restore-RoutineLauncher })
        } catch {
            if ($script:tray) { $script:tray.Dispose(); $script:tray = $null }
            if ($script:trayIcon) { $script:trayIcon.Dispose(); $script:trayIcon = $null }
            $window.ShowInTaskbar = $true
            return
        }
    }
    $script:tray.Visible = $true
    $window.ShowInTaskbar = $false
    $window.Hide()
}
$window.Add_StateChanged({ if ($window.WindowState -eq 'Minimized') { Hide-RoutineLauncher } })
function Complete-RoutineLaunch {
    try {
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
        @{mode=$script:launchMode} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'launcher-preferences.json') -Encoding UTF8
        if ($script:launchWatch) { $script:launchWatch.Stop(); $detail.Text += (' Pronto em ' + [Math]::Round($script:launchWatch.Elapsed.TotalSeconds,1) + 's.') }
    } catch { }
    if ($Direct) { Hide-RoutineLauncher } else { $window.WindowState = 'Minimized' }
}
function Show-Ready {
    $repair.Visibility = 'Collapsed'
    $script:manageServer = $true
    $phoneButton.IsEnabled = $true
    $phoneHint.Text = 'Escaneie o QR Code no mesmo Wi-Fi. O PC precisa continuar ligado.'
    $launch.IsEnabled = $true; $repair.IsEnabled = $true; $mobileOnly.IsEnabled = $true
    if ($script:launchMode -eq 'phone') {
        $script:desktopMonitor.Stop()
        if ($script:browser) { $script:browser.Close(); $script:browser = $null }
        $status.Text = 'Pronto para usar no celular'
        $detail.Text = 'Servidor ativo, sem janela do app no PC. Abra pelo QR Code e mantenha este launcher aberto.'
        $launch.Content = 'Abrir também no PC  →'
        Show-RoutinePhone
        Complete-RoutineLaunch
        return
    }
    $status.Text = 'Routine aberto no PC'
    $detail.Text = 'Seu treino está pronto. Você também pode conectar o celular pelo QR Code.'
    if ($script:browser -and $script:browser.IsRunning) { $script:browser.Activate() }
    else {
        if ($script:browser) { $script:browser.Dispose() }
        $browserPath = Get-RoutineDesktopPath
        $profile = Join-Path $runtime 'webview2'
        $browserArguments = '--url=http://localhost:3000 --controller-id=' + $projectId + ' --data-dir="' + $profile + '"'
        $script:browser = New-Object RoutineBrowser($browserPath, $browserArguments, $root)
        $script:desktopMonitor.Start()
    }
    $launch.Content = 'Mostrar Routine  →'
    Complete-RoutineLaunch
}
function Start-RoutineServer {
    $node = Get-RoutineNodePath $root
    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules/express/package.json'))) { throw 'Dependencias ausentes. Execute npm install nesta pasta uma vez antes de usar o launcher.' }
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    $status.Text = 'Iniciando seu espaco...'
    $detail.Text = if ($script:launchMode -eq 'phone') { 'Ligando o acesso pelo celular. O QR Code aparece em instantes.' } else { 'Preparando o servidor e sua janela do Routine.' }
    $oldPort = $env:PORT; $oldDb = $env:ROUTINE_DB
    try {
        $env:PORT = '3000'; Remove-Item Env:ROUTINE_DB -ErrorAction SilentlyContinue
        $script:serverProcess = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'server.js') + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errorFile -PassThru
        $script:manageServer = $true
    } finally { $env:PORT = $oldPort; $env:ROUTINE_DB = $oldDb }
}
$script:recovery = $null
$script:recoveryWorker = $null
$script:desktopMonitor = New-Object Windows.Threading.DispatcherTimer
$script:desktopMonitor.Interval = [TimeSpan]::FromMilliseconds(500)
$script:openSignal = New-Object Threading.EventWaitHandle($false,[Threading.EventResetMode]::AutoReset,('Local\RoutineOpen-' + $projectId))
$script:phoneSignal = New-Object Threading.EventWaitHandle($false,[Threading.EventResetMode]::AutoReset,('Local\RoutinePhone-' + $projectId))
$script:stopSignal = New-Object Threading.EventWaitHandle($false,[Threading.EventResetMode]::AutoReset,('Local\RoutineStop-' + $projectId))
$script:desktopMonitor.Add_Tick({
    if ($script:stopSignal.WaitOne(0)) { $window.Close(); return }
    if ($script:phoneSignal.WaitOne(0)) { $script:launchMode = 'phone'; Hide-RoutineLauncher }
    if ($script:openSignal.WaitOne(0)) { Restore-RoutineLauncher }
    if ($script:launchMode -eq 'desktop' -and $script:browser -and -not $script:browser.IsRunning) { $window.Close() }
})
$script:phase = 'idle'
$script:timer = New-Object Windows.Threading.DispatcherTimer
$script:timer.Interval = [TimeSpan]::FromMilliseconds(100)
$script:timer.Add_Tick({
    try {
        if ($script:phase -eq 'repairing') {
            if (-not $script:recovery.IsCompleted) { return }
            try { $outcome = @($script:recoveryWorker.EndInvoke($script:recovery))[-1] }
            finally { $script:recoveryWorker.Dispose(); $script:recoveryWorker = $null; $script:recovery = $null }
            if (-not $outcome -or $outcome.Status -ne 'cleared') { throw $(if ($outcome) { $outcome.Message } else { 'Nao foi possivel resolver. Tente novamente.' }) }
            # Repair already verified/released the port. Do not return to the
            # initial conflict branch while our replacement server is starting.
            Start-RoutineServer
            $script:phase = 'starting'; $script:deadline = [DateTime]::UtcNow.AddSeconds(20)
            $script:probe = $null
            return
        }
        if (-not $script:probe) { $script:probe = [RoutineProbe]::Check($url, $projectId); return }
        if (-not $script:probe.IsCompleted) { return }
        $result = $script:probe.GetAwaiter().GetResult(); $script:probe = $null
        if ($result -eq 'inspection-error') { throw 'O Windows nao permitiu consultar a porta. Feche e reabra o launcher e tente novamente.' }
        if ($result -eq 'ready') { $script:timer.Stop(); Show-Ready; return }
        if ($script:phase -eq 'checking') {
            if ($result -ne 'free') { throw 'A porta 3000 esta ocupada. Clique em Resolver e iniciar para identificar e corrigir o servidor antigo do Routine.' }
            Start-RoutineServer
            $script:phase = 'starting'; $script:deadline = [DateTime]::UtcNow.AddSeconds(15)
        } elseif ($script:serverProcess -and $script:serverProcess.HasExited) {
            $reason = if (Test-Path -LiteralPath $errorFile) { (Get-Content -LiteralPath $errorFile -Tail 4) -join ' ' } else { 'O processo terminou antes de ficar pronto.' }
            throw ('O servidor nao conseguiu iniciar. ' + $reason)
        } elseif ([DateTime]::UtcNow -gt $script:deadline) { throw 'O servidor iniciou, mas a API nao respondeu a tempo. Clique em Resolver e iniciar para tentar novamente.' }
    } catch {
        $script:timer.Stop(); $script:probe = $null
        $status.Text = 'Precisamos de um ajuste'; $detail.Text = $_.Exception.Message
        $script:phase = 'error'; $window.ShowInTaskbar = $true; $window.Show(); $window.WindowState = 'Normal'
        $launch.IsEnabled = $true; $repair.IsEnabled = $true; $mobileOnly.IsEnabled = $true; $repair.Visibility = 'Visible'
    }
})
$repair.Add_Click({
    try {
        if ($script:launchMode -eq 'desktop') { Get-RoutineDesktopPath | Out-Null }
        $launch.IsEnabled = $false; $repair.IsEnabled = $false; $mobileOnly.IsEnabled = $false
        $status.Text = 'Resolvendo inicializacao...'
        $detail.Text = 'Identificando o servidor antigo desta pasta. Aguarde um instante.'
        $script:recoveryWorker = [PowerShell]::Create()
        $null = $script:recoveryWorker.AddCommand((Join-Path $PSScriptRoot 'Resolve-RoutinePort.ps1')).AddParameter('Root', $root)
        $script:recovery = $script:recoveryWorker.BeginInvoke()
        $script:phase = 'repairing'; $script:probe = $null
        $script:timer.Start()
    } catch { $status.Text = 'Nao foi possivel resolver'; $detail.Text = $_.Exception.Message; $launch.IsEnabled = $true; $repair.IsEnabled = $true; $mobileOnly.IsEnabled = $true }
})
function Request-RoutineStart([string]$mode) {
    try {
        $script:launchWatch = [Diagnostics.Stopwatch]::StartNew()
        $script:launchMode = $mode
        if ($mode -eq 'desktop' -and $script:browser -and $script:browser.IsRunning) { $script:browser.Activate(); Complete-RoutineLaunch; return }
        if ($mode -eq 'desktop') { Get-RoutineDesktopPath | Out-Null }
        $launch.IsEnabled = $false; $repair.IsEnabled = $false; $mobileOnly.IsEnabled = $false
        $status.Text = 'Preparando seu espaço...'; $detail.Text = 'Verificando a conexão em segundo plano.'
        $script:phase = 'checking'
        $script:probe = [RoutineProbe]::Check($url, $projectId)
        $script:timer.Start()
    } catch { $status.Text = 'Precisamos de um ajuste'; $detail.Text = $_.Exception.Message; $launch.IsEnabled = $true; $mobileOnly.IsEnabled = $true; $script:phase='error'; $window.ShowInTaskbar=$true; $window.Show() }
}
try {
    $last = Get-Content -LiteralPath (Join-Path $runtime 'launcher-preferences.json') -Raw | ConvertFrom-Json
    if ($last.mode -eq 'phone') { $mobileOnly.Content = 'Usar somente no celular · última escolha' } elseif ($last.mode -eq 'desktop') { $launch.Content = 'Abrir no PC · última escolha →' }
} catch { }
try { $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version; $window.Title = 'Routine ' + $version + ' | Iniciar'; $window.FindName('Edition').Text = 'LOCAL / ' + $version } catch { }
$launch.Add_Click({ Request-RoutineStart 'desktop' })
$mobileOnly.Add_Click({ Request-RoutineStart 'phone' })
function Stop-RoutineServer {
    if ($script:timer) { $script:timer.Stop() }
    if ($script:recoveryWorker) { $script:recoveryWorker.Stop(); $script:recoveryWorker.Dispose(); $script:recoveryWorker = $null }
    if ($script:desktopMonitor) { $script:desktopMonitor.Stop() }
    if ($script:browser) { $script:browser.Close(); $script:browser = $null }
    if (-not $script:manageServer) { return }
    try {
        $control = Get-Content -LiteralPath (Join-Path $runtime 'server-control.json') -Raw | ConvertFrom-Json
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 1
        if ($health.projectId -eq $projectId -and $control.projectId -eq $projectId -and $health.pid -eq $control.pid -and $control.port -eq 3000) {
            Invoke-RestMethod "$url/api/shutdown" -Method Post -Headers @{'X-Routine-Token' = $control.token} -TimeoutSec 2 | Out-Null
        }
    } catch { }
    # Only the exact child process started by this window can be force-stopped.
    # Never kill other Node processes or a process selected solely by port/PID.
    if ($script:serverProcess) {
        try {
            if (-not $script:serverProcess.WaitForExit(5000)) { $script:serverProcess.Kill(); $script:serverProcess.WaitForExit(1000) | Out-Null }
        } catch { }
        $script:serverProcess.Dispose()
        $script:serverProcess = $null
    }
    $script:manageServer = $false
}
function Get-RoutineShutdownWarning {
    if (-not $script:manageServer) { return $null }
    # Desktop X has its own pending-work prompt before it closes the WebView.
    if ($script:launchMode -eq 'desktop' -and $script:browser -and -not $script:browser.IsRunning) { return $null }
    try {
        $control = Get-Content -LiteralPath (Join-Path $runtime 'server-control.json') -Raw | ConvertFrom-Json
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 1
        if ($health.projectId -ne $projectId -or $control.projectId -ne $projectId -or $health.pid -ne $control.pid -or $control.port -ne 3000) { return $null }
        $check = Invoke-RestMethod "$url/api/shutdown-check" -Headers @{'X-Routine-Token'=$control.token} -TimeoutSec 2
        if ($check.pending -gt 0) { return 'Há treino, preenchimento ou sincronização pendente em um aparelho conectado. Volte ao Routine para salvar. Fechar agora encerra o servidor; o que foi guardado localmente poderá ser recuperado no mesmo aparelho. Deseja fechar mesmo assim?' }
    } catch { }
    return $null
}
$window.Add_Closing({ param($sender,$eventArgs)
    $warning = Get-RoutineShutdownWarning
    if ($warning -and [Windows.MessageBox]::Show($window,$warning,'Routine · Registros pendentes',[Windows.MessageBoxButton]::YesNo,[Windows.MessageBoxImage]::Warning,[Windows.MessageBoxResult]::No) -ne [Windows.MessageBoxResult]::Yes) { $eventArgs.Cancel = $true }
})
$window.Add_Closed({ Stop-RoutineServer; $window.Dispatcher.BeginInvokeShutdown([Windows.Threading.DispatcherPriority]::Background) })
# A modal ShowDialog would return when Hide is called and shut down the server.
# Keep the dispatcher alive until the actual Closed event instead.
if ($ValidateOnly) {
    Get-RoutineDesktopPath | Out-Null
    Get-RoutineNodePath $root | Out-Null
    $script:openSignal.Dispose(); $script:phoneSignal.Dispose(); $script:stopSignal.Dispose()
    $mutex.ReleaseMutex(); $mutex.Dispose()
    'PASS: controller initialized without showing windows or starting server/desktop.'
    return
}
try {
    if ($Direct) { $window.ShowInTaskbar = $false; Request-RoutineStart 'desktop' } else { $window.Show() }
    $script:desktopMonitor.Start()
    [Windows.Threading.Dispatcher]::Run()
} finally {
    Stop-RoutineServer
    if ($script:tray) { $script:tray.Visible = $false; $script:tray.ContextMenuStrip.Dispose(); $script:tray.Dispose() }
    if ($script:trayIcon) { $script:trayIcon.Dispose() }
    $script:openSignal.Dispose(); $script:phoneSignal.Dispose(); $script:stopSignal.Dispose()
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
