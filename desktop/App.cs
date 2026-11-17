using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shell;
using System.Windows.Markup;
using System.Windows.Automation;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace RoutineDesktop;

public sealed class App : Application
{
    [STAThread]
    public static void Main(string[] args)
    {
        var app = new App { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new RoutineWindow(args));
    }
}

public sealed class RoutineWindow : Window
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    private WebView2 web = new();
    private readonly Grid viewRoot = new();
    private readonly StackPanel noticePanel = new() { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
    private readonly Button recover = new() { Content = "Reabrir visualização", Padding = new Thickness(20,12,20,12), Margin = new Thickness(24), Visibility = Visibility.Collapsed };
    private readonly string dataDirectory;
    private readonly Uri origin;
    private readonly TextBlock notice;
    private bool closing;
    private bool pendingWork;
    private bool launcherClosing;
    private readonly string controllerId;

    public RoutineWindow(string[] args)
    {
        string Arg(string key, string fallback) => args.FirstOrDefault(a => a.StartsWith(key + "="))?[(key.Length + 1)..] ?? fallback;
        origin = new Uri(Arg("--url", "http://localhost:3000"));
        controllerId = Arg("--controller-id", "");
        if (!origin.IsLoopback || origin.Scheme != "http") throw new ArgumentException("Routine aceita somente o servidor local.");
        dataDirectory = Path.GetFullPath(Arg("--data-dir", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Routine", ".runtime", "webview2")));
        Title = "Routine";
        Width = Math.Min(1320, SystemParameters.WorkArea.Width - 40);
        Height = Math.Min(900, SystemParameters.WorkArea.Height - 40);
        MinWidth = 360; MinHeight = 520;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(12, 14, 19));
        var root = viewRoot;
        notice = new TextBlock { Text = "Preparando seu espaço…", Foreground = Brushes.LightSteelBlue, FontSize = 18, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(32), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 12, 14, 19);
        web.Visibility = Visibility.Hidden;
        noticePanel.Children.Add(notice); noticePanel.Children.Add(recover);
        root.Children.Add(noticePanel); root.Children.Add(web); Content = root;
        recover.Click += async (_, _) => {
            recover.IsEnabled = false;
            try {
                var previous = web; root.Children.Remove(previous); previous.Dispose();
                web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255,12,14,19), Visibility = Visibility.Hidden };
                root.Children.Add(web);
                await Initialize();
            } finally { recover.IsEnabled = true; }
        };
        var icon = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "assets", "routine.ico"));
        if (File.Exists(icon)) Icon = BitmapFrame.Create(new Uri(icon));
        BuildFrame(root);
        SourceInitialized += (_, _) => {
            SetTheme();
            var handle = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            System.Windows.Interop.HwndSource.FromHwnd(handle)?.AddHook((IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam,ref bool handled) => {
                if(message == 0x8052 && wParam == new IntPtr(0x52544e)) { launcherClosing = true; handled = true; }
                return IntPtr.Zero;
            });
        };
        Activated += (_, _) => SetTheme();
        Loaded += async (_, _) => await Initialize();
        Closing += (_, e) => {
            if (!launcherClosing && pendingWork && MessageBox.Show(this,"Há treino, preenchimento ou sincronização pendente. Volte para salvar antes de sair. Fechar agora mantém apenas a recuperação disponível neste aparelho. Deseja fechar?","Routine · Registros pendentes",MessageBoxButton.YesNo,MessageBoxImage.Warning,MessageBoxResult.No) != MessageBoxResult.Yes) { e.Cancel = true; return; }
            closing = true; web.Dispose();
        };
    }

    private void BuildFrame(Grid browserContent)
    {
        // WindowChrome retains the system move/resize areas and caption menu.
        WindowChrome.SetWindowChrome(this, new WindowChrome {
            CaptionHeight = 46, ResizeBorderThickness = new Thickness(6),
            GlassFrameThickness = new Thickness(0), CornerRadius = new CornerRadius(10),
            UseAeroCaptionButtons = false
        });
        var frame = (Grid)XamlReader.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "WindowFrame.xaml")));
        ((Image)frame.FindName("FrameIcon")).Source = Icon;
        ((Button)frame.FindName("MinimizeWindow")).Click += (_, _) => SystemCommands.MinimizeWindow(this);
        var maximize = (Button)frame.FindName("MaximizeWindow");
        maximize.Click += (_, _) => { if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this); else SystemCommands.MaximizeWindow(this); };
        ((Button)frame.FindName("CloseWindow")).Click += (_, _) => SystemCommands.CloseWindow(this);
        var host = new Grid { Background = Background };
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) });
        host.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Content = null;
        Grid.SetRow(browserContent, 1); host.Children.Add(frame); host.Children.Add(browserContent); Content = host;
        StateChanged += (_, _) => {
            bool maximized = WindowState == WindowState.Maximized;
            // Keep content inside the invisible resize frame when maximized.
            host.Margin = maximized ? new Thickness(SystemParameters.WindowResizeBorderThickness.Left + 2) : new Thickness(0);
            maximize.ToolTip = maximized ? "Restaurar" : "Maximizar";
            AutomationProperties.SetName(maximize, maximized ? "Restaurar" : "Maximizar");
            ((System.Windows.Shapes.Path)frame.FindName("MaximizeGlyph")).Data = Geometry.Parse(maximized ? "M2,0 L10,0 10,8 M0,2 L8,2 8,10 0,10 Z" : "M0,0 L10,0 10,10 0,10 Z");
        };
        Activated += (_, _) => frame.Opacity = 1;
        Deactivated += (_, _) => frame.Opacity = 0.72;
    }

    private void SetTheme()
    {
        int dark = (int?)Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 0) == 0 ? 1 : 0;
        var handle = new System.Windows.Interop.WindowInteropHelper(this).Handle;
        if (DwmSetWindowAttribute(handle, 20, ref dark, 4) != 0) DwmSetWindowAttribute(handle, 19, ref dark, 4);
    }

    private async Task Initialize()
    {
        try
        {
            Directory.CreateDirectory(dataDirectory);
            var options = new CoreWebView2EnvironmentOptions { AllowSingleSignOnUsingOSPrimaryAccount = false };
            var environment = await CoreWebView2Environment.CreateAsync(null, dataDirectory, options);
            if (closing) return;
            await web.EnsureCoreWebView2Async(environment);
            if (closing) return;
            var core = web.CoreWebView2;
            core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            if (System.Text.RegularExpressions.Regex.IsMatch(controllerId, "^[a-f0-9]{64}$"))
                await core.AddScriptToExecuteOnDocumentCreatedAsync("window.routineDesktopPhoneOnly = true;");
            core.WebMessageReceived += (_, e) => {
                try {
                    if (new Uri(e.Source).GetLeftPart(UriPartial.Authority) != origin.GetLeftPart(UriPartial.Authority)) return;
                    using var message = System.Text.Json.JsonDocument.Parse(e.WebMessageAsJson);
                    if (message.RootElement.GetProperty("type").GetString() == "routine-pending") pendingWork = message.RootElement.GetProperty("pending").GetBoolean();
                    if (message.RootElement.GetProperty("type").GetString() == "routine-phone-only" && System.Text.RegularExpressions.Regex.IsMatch(controllerId, "^[a-f0-9]{64}$")) {
                        using var signal = EventWaitHandle.OpenExisting("Local\\RoutinePhone-" + controllerId);
                        signal.Set(); launcherClosing = true; Close();
                    }
                } catch { }
            };
            core.DownloadStarting += (_, e) => {
                if (e.DownloadOperation.Uri != new Uri(origin,"/api/backups/export").AbsoluteUri) { e.Cancel = true; return; }
                var destination = new SaveFileDialog { Filter = "Backup Routine (*.json)|*.json", FileName = "routine-backup-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json", AddExtension = true, DefaultExt = ".json" };
                if (destination.ShowDialog(this) == true) { e.ResultFilePath = destination.FileName; e.Handled = true; } else e.Cancel = true;
            };
            core.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target.GetLeftPart(UriPartial.Authority) != origin.GetLeftPart(UriPartial.Authority)) e.Cancel = true;
            };
            core.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess) { noticePanel.Visibility = Visibility.Collapsed; recover.Visibility = Visibility.Collapsed; web.Visibility = Visibility.Visible; }
                else { LogFailure("R-WV-004", e.WebErrorStatus.ToString()); ShowFailure("R-WV-004 · Não foi possível conectar. Confira o servidor e tente reabrir a visualização."); }
            };
            core.ProcessFailed += async (_, e) => {
                var kind = e.ProcessFailedKind;
                var recoverable = kind == CoreWebView2ProcessFailedKind.GpuProcessExited || kind == CoreWebView2ProcessFailedKind.FrameRenderProcessExited;
                var critical = kind == CoreWebView2ProcessFailedKind.BrowserProcessExited || kind == CoreWebView2ProcessFailedKind.RenderProcessExited || kind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive;
                var code = recoverable ? "R-WV-002" : critical ? "R-WV-003" : "R-WV-006";
                LogFailure(code, $"{kind}; reason={e.Reason}; exit={e.ExitCode}");
                if (recoverable) {
                    try {
                        await Task.Delay(300);
                        if (!closing) await core.ExecuteScriptAsync("window.dispatchEvent(new Event('routine:graphics-safe-mode'))");
                    } catch { LogFailure("R-WV-005", "graphics recovery unavailable"); }
                    return;
                }
                if (!critical) return;
                ShowFailure("R-WV-003 · A visualização foi interrompida. Reabra aqui para recuperar os registros disponíveis neste aparelho.");
            };
            core.Navigate(origin.AbsoluteUri);
        }
        catch (Exception error)
        {
            if (closing) return;
            LogFailure("R-WV-001", error.GetType().Name);
            ShowFailure("R-WV-001 · Não foi possível abrir o WebView2. Confira o Runtime e tente novamente.");
            try { File.WriteAllText(Path.Combine(dataDirectory, "desktop-error.log"), error.ToString()); } catch { }
        }
    }
    private void ShowFailure(string text) {
        if (closing) return;
        web.Visibility = Visibility.Hidden;
        notice.Text = text; noticePanel.Visibility = Visibility.Visible; recover.Visibility = Visibility.Visible;
    }
    private void LogFailure(string code, string detail) {
        try {
            Directory.CreateDirectory(dataDirectory);
            var file = Path.Combine(dataDirectory, "desktop-diagnostics.jsonl");
            if (File.Exists(file) && new FileInfo(file).Length > 65536) File.WriteAllText(file, "");
            File.AppendAllText(file, System.Text.Json.JsonSerializer.Serialize(new { time=DateTimeOffset.Now, code, detail }) + Environment.NewLine);
        } catch { }
    }

}
