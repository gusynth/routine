using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace RoutineSetup;

public static class Entry {
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [STAThread]
    public static int Main(string[] args) {
        string? Value(string key)=>args.FirstOrDefault(a=>a.StartsWith(key+"=",StringComparison.Ordinal))?[(key.Length+1)..];
        bool uninstall=args.Contains("--uninstall")||Value("--uninstall-root")!=null;
        string? tempRoot=null;
        try {
            SetCurrentProcessExplicitAppUserModelID("Routine.Setup");
            if(args.Contains("--uninstall")) {
                string root=InstallEngine.Full(Path.Combine(AppContext.BaseDirectory,".."));InstallEngine.ReadManifest(root);
                tempRoot=Path.Combine(Path.GetTempPath(),"Routine-maintenance",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(tempRoot);
                string clone=Path.Combine(tempRoot,"Routine.Setup.exe");File.Copy(Environment.ProcessPath!,clone);
                var info=new ProcessStartInfo(clone){UseShellExecute=false,WorkingDirectory=Path.GetTempPath()};
                info.ArgumentList.Add("--uninstall-root="+root);info.ArgumentList.Add("--wait-pid="+Environment.ProcessId);info.ArgumentList.Add("--wait-ticks="+Process.GetCurrentProcess().StartTime.Ticks);info.ArgumentList.Add("--cleanup-temp");
                Process.Start(info);return 0;
            }
            if(int.TryParse(Value("--wait-pid"),out int parent)&&long.TryParse(Value("--wait-ticks"),out long start)) {
                try {using var previous=Process.GetProcessById(parent);if(previous.StartTime.Ticks==start&&!previous.WaitForExit(15000))throw new SetupFailure("R-UN-005","O desinstalador anterior ainda está encerrando. Aguarde e tente novamente.");}catch(ArgumentException){}
            }
            if(args.Contains("--cleanup-temp"))tempRoot=InstallEngine.Full(AppContext.BaseDirectory);
            using var gate=new Mutex(false,"Local\\RoutineSetup-Installer");
            bool acquired;try{acquired=gate.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
            if(!acquired)return 2;
            try {
                var app=new Application{ShutdownMode=ShutdownMode.OnMainWindowClose};
                if(Value("--render-preview") is string image) {
                    var window=new SetupWindow(uninstall,Value("--uninstall-root"));
                    var view=window.PreviewRoot;view.Measure(new Size(760,552));view.Arrange(new Rect(0,0,760,552));view.UpdateLayout();
                    var bitmap=new RenderTargetBitmap(1520,1104,192,192,PixelFormats.Pbgra32);bitmap.Render(view);
                    var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var output=File.Create(image);encoder.Save(output);return 0;
                }
                app.Run(new WebSetupWindow(uninstall,Value("--uninstall-root")));
            } finally {gate.ReleaseMutex();}
            return 0;
        } catch(Exception error) {
            if(Value("--render-preview") is string renderError){File.WriteAllText(renderError+".error.txt",error.ToString());return 1;}
            MessageBox.Show("R-SETUP-001 · Não foi possível abrir o instalador. "+error.GetBaseException().Message,"Routine",MessageBoxButton.OK,MessageBoxImage.Error);return 1;
        } finally {if(tempRoot!=null&&args.Contains("--cleanup-temp"))ScheduleCleanup(tempRoot);}
    }
    static void ScheduleCleanup(string root) {
        try {
            string owner=InstallEngine.Full(Path.Combine(Path.GetTempPath(),"Routine-maintenance"));
            if(!InstallEngine.Inside(root,owner)||!Guid.TryParseExact(Path.GetFileName(root),"N",out _))return;
            InstallEngine.NoLinks(root);
            string script=Path.Combine(root,"cleanup.ps1");
            File.WriteAllText(script,"""
param([string]$Root,[int]$ParentId,[long]$StartTicks)
$ErrorActionPreference='Stop'
$base=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'Routine-maintenance')).TrimEnd('\')
$target=[IO.Path]::GetFullPath($Root).TrimEnd('\')
if(-not $target.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $target -Leaf) -notmatch '^[a-f0-9]{32}$'){exit 1}
if((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){exit 1}
try{$parent=[Diagnostics.Process]::GetProcessById($ParentId);if($parent.StartTime.Ticks -eq $StartTicks){$parent.WaitForExit(60000)|Out-Null;if(-not $parent.HasExited){exit 1}}}catch [ArgumentException]{}
foreach($name in @('Routine.Setup.exe','cleanup.ps1')){$file=Join-Path $target $name;if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}}
if(-not @(Get-ChildItem -LiteralPath $target -Force).Count){Remove-Item -LiteralPath $target -Force}
""");
            var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe")){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=Path.GetTempPath()};
            foreach(var arg in new[]{"-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",script,"-Root",root,"-ParentId",Environment.ProcessId.ToString(),"-StartTicks",Process.GetCurrentProcess().StartTime.Ticks.ToString()})info.ArgumentList.Add(arg);
            Process.Start(info);
        }catch{}
    }
}
