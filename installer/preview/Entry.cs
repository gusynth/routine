using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RoutineSetupPreview;

// Deliberately no reference to InstallEngine or WindowsIntegration.
// This executable can only display the approved simulation, drag and close.
public static class Entry {
    [STAThread] public static int Main() {
        try { _=CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch(WebView2RuntimeNotFoundException) {
            MessageBox.Show("R-PREVIEW-001 · Esta prévia precisa do Microsoft Edge WebView2 Runtime. Ela não instalará componentes automaticamente.\n\nA versão final terá uma etapa anterior, com confirmação, para preparar o componente quando estiver ausente.","Routine · Componente necessário",MessageBoxButton.OK,MessageBoxImage.Information);
            return 1;
        }
        var app=new Application();
        app.DispatcherUnhandledException+=(_,e)=>{MessageBox.Show("R-PREVIEW-002 · "+e.Exception.GetBaseException().Message,"Routine · Prévia",MessageBoxButton.OK,MessageBoxImage.Error);e.Handled=true;app.Shutdown(1);};
        return app.Run(new PreviewWindow());
    }
}

sealed class PreviewWindow:Window {
    const string Origin="https://routine-setup.invalid/";
    readonly string scratch=Path.Combine(Path.GetTempPath(),"Routine-setup-preview",Guid.NewGuid().ToString("N"));
    readonly WebView2 web=new(){DefaultBackgroundColor=System.Drawing.Color.FromArgb(255,13,14,17)};
    bool closing,allowClose;
    CoreWebView2Environment? environment;
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
    public PreviewWindow() {
        Title="Routine · Prévia HTML do instalador (simulação)";
        Width=Math.Min(772,SystemParameters.WorkArea.Width-24);Height=Math.Min(736,SystemParameters.WorkArea.Height-24);
        MinWidth=360;MinHeight=420;WindowStartupLocation=WindowStartupLocation.CenterScreen;
        WindowStyle=WindowStyle.None;ResizeMode=ResizeMode.CanResize;Background=new SolidColorBrush(Color.FromRgb(13,14,17));
        WindowChrome.SetWindowChrome(this,new WindowChrome{CaptionHeight=0,ResizeBorderThickness=new Thickness(5),GlassFrameThickness=new Thickness(0),UseAeroCaptionButtons=false});
        Icon=BitmapFrame.Create(new Uri("pack://application:,,,/Routine.Setup.Preview;component/Art/routine.ico"));
        Content=web;
        SourceInitialized+=(_,_)=>{int dark=1,round=2;var hwnd=new System.Windows.Interop.WindowInteropHelper(this).Handle;DwmSetWindowAttribute(hwnd,20,ref dark,4);DwmSetWindowAttribute(hwnd,33,ref round,4);};
        Loaded+=async(_,_)=>await Initialize();
        Closing+=async(_,e)=>{
            if(allowClose)return;
            e.Cancel=true;
            if(closing)return;
            closing=true;
            var exited=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            if(environment!=null)environment.BrowserProcessExited+=(_,_)=>exited.TrySetResult();
            web.Dispose();
            await Task.WhenAny(exited.Task,Task.Delay(4000));
            Cleanup();
            allowClose=true;Close();
        };
    }
    async Task Initialize() {
        Directory.CreateDirectory(scratch);
        var assets=Path.Combine(scratch,"ui");Directory.CreateDirectory(assets);
        foreach(var file in new[]{"index.html","lucide.min.js"}) {
            var assembly=Assembly.GetExecutingAssembly();
            var resource=assembly.GetManifestResourceNames().Single(n=>n.EndsWith(".web."+file,StringComparison.OrdinalIgnoreCase)||n.EndsWith(".Web."+file,StringComparison.OrdinalIgnoreCase));
            using var input=assembly.GetManifestResourceStream(resource)!;using var output=File.Create(Path.Combine(assets,file));input.CopyTo(output);
        }
        var options=new CoreWebView2EnvironmentOptions{AllowSingleSignOnUsingOSPrimaryAccount=false};
        environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(scratch,"profile"),options);
        if(closing)return;
        await web.EnsureCoreWebView2Async(environment);if(closing)return;
        var core=web.CoreWebView2;
        core.Profile.PreferredColorScheme=CoreWebView2PreferredColorScheme.Dark;
        core.Settings.AreHostObjectsAllowed=false;core.Settings.AreDevToolsEnabled=false;
        core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.IsStatusBarEnabled=false;
        core.Settings.IsGeneralAutofillEnabled=false;core.Settings.IsPasswordAutosaveEnabled=false;
        core.Settings.IsZoomControlEnabled=false;
        core.SetVirtualHostNameToFolderMapping("routine-setup.invalid",assets,CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting+=(_,e)=>{if(e.Uri!=Origin+"index.html")e.Cancel=true;};
        core.NewWindowRequested+=(_,e)=>e.Handled=true;
        core.DownloadStarting+=(_,e)=>e.Cancel=true;
        core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        core.WebResourceRequested+=(_,e)=>{
            if(e.Request.Uri!=Origin+"index.html"&&e.Request.Uri!=Origin+"lucide.min.js")
                e.Response=core.Environment.CreateWebResourceResponse(null,403,"Blocked","");
        };
        core.AddWebResourceRequestedFilter("http*",CoreWebView2WebResourceContext.All);
        core.WebMessageReceived+=(_,e)=>{
            if(e.Source!=Origin+"index.html")return;
            string action;try{action=e.TryGetWebMessageAsString();}catch(ArgumentException){return;}
            if(action=="close")Close();
            else if(action=="drag"&&System.Windows.Input.Mouse.LeftButton==System.Windows.Input.MouseButtonState.Pressed)try{DragMove();}catch(InvalidOperationException){}
        };
        core.Navigate(Origin+"index.html");
    }
    void Cleanup() {
        try {
            string owner=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"Routine-setup-preview"));
            if(!Path.GetFullPath(scratch).StartsWith(owner+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!Guid.TryParseExact(Path.GetFileName(scratch),"N",out _))return;
            void Delete(string directory) {
                if((File.GetAttributes(directory)&FileAttributes.ReparsePoint)!=0)return;
                foreach(var item in Directory.EnumerateFileSystemEntries(directory)) {
                    var attributes=File.GetAttributes(item);if((attributes&FileAttributes.ReparsePoint)!=0)continue;
                    if((attributes&FileAttributes.Directory)!=0)Delete(item);else File.Delete(item);
                }
                if(!Directory.EnumerateFileSystemEntries(directory).Any())Directory.Delete(directory);
            }
            if(Directory.Exists(scratch))Delete(scratch);
        }catch(IOException){}catch(UnauthorizedAccessException){}
    }
}
