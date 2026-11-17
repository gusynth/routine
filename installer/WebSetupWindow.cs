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
namespace RoutineSetup;
public sealed partial class WebSetupWindow:Window {
    const string Origin="https://routine-setup.invalid/";
    readonly bool removing;
    readonly string installationRoot;
    readonly string scratch=Path.Combine(Path.GetTempPath(),"Routine-setup-web",Guid.NewGuid().ToString("N"));
    readonly WebView2 web=new(){DefaultBackgroundColor=System.Drawing.Color.FromArgb(255,13,14,17)};
    bool closing,allowClose;
    CoreWebView2Environment? environment;
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
    public WebSetupWindow(bool uninstall=false,string? root=null) {
        removing=uninstall;installationRoot=root??WindowsIntegration.InstalledDirectory??WindowsIntegration.DefaultDirectory;folder=installationRoot;
        Title=removing?"Routine · Desinstalar":"Routine · Instalação";
        Width=Math.Min(772,SystemParameters.WorkArea.Width-24);Height=Math.Min(650,SystemParameters.WorkArea.Height-24);
        MinWidth=360;MinHeight=420;WindowStartupLocation=WindowStartupLocation.CenterScreen;
        WindowStyle=WindowStyle.None;ResizeMode=ResizeMode.NoResize;Background=new SolidColorBrush(Color.FromRgb(13,14,17));
        WindowChrome.SetWindowChrome(this,new WindowChrome{CaptionHeight=0,ResizeBorderThickness=new Thickness(0),GlassFrameThickness=new Thickness(0),UseAeroCaptionButtons=false});
        Icon=BitmapFrame.Create(new Uri("pack://application:,,,/Routine.Setup;component/Art/routine.ico"));
        Content=web;
        SourceInitialized+=(_,_)=>{int dark=1,round=2;var hwnd=new System.Windows.Interop.WindowInteropHelper(this).Handle;DwmSetWindowAttribute(hwnd,20,ref dark,4);DwmSetWindowAttribute(hwnd,33,ref round,4);};
        Loaded+=async(_,_)=>await Prepare();
        Closing+=async(_,e)=>{if(allowClose)return;e.Cancel=true;if(!closing)await RequestClose();};
    }
    async Task FinishClose() {
        if(closing)return;closing=true;carousel.Stop();
        var exited=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if(environment!=null)environment.BrowserProcessExited+=(_,_)=>exited.TrySetResult();
        web.Dispose();if(environment!=null)await Task.WhenAny(exited.Task,Task.Delay(4000));Cleanup();
        cancellation?.Dispose();allowClose=true;Close();
    }
    async Task Initialize() {
        Directory.CreateDirectory(scratch);
        var assets=Path.Combine(scratch,"ui");Directory.CreateDirectory(assets);
        foreach(var file in new[]{"setup.html","lucide.min.js"}) {
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
        core.NavigationStarting+=(_,e)=>{if(e.Uri!=Origin+"setup.html")e.Cancel=true;};
        core.NewWindowRequested+=(_,e)=>e.Handled=true;
        core.DownloadStarting+=(_,e)=>e.Cancel=true;
        core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        core.WebResourceRequested+=(_,e)=>{
            if(e.Request.Uri!=Origin+"setup.html"&&e.Request.Uri!=Origin+"lucide.min.js")
                e.Response=core.Environment.CreateWebResourceResponse(null,403,"Blocked","");
        };
        core.AddWebResourceRequestedFilter("http*",CoreWebView2WebResourceContext.All);
        core.WebMessageReceived+=async(_,e)=>{
            if(e.Source!=Origin+"setup.html"||closing)return;
            try {await Command(e.WebMessageAsJson);}catch(Exception error){await Fail(error);}
        };
        core.Navigate(Origin+"setup.html");
    }
    void Cleanup() {
        try {
            string owner=Path.GetFullPath(Path.Combine(Path.GetTempPath(),"Routine-setup-web"));
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
