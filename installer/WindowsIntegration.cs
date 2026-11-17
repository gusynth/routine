using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32;

namespace RoutineSetup;

public static class WindowsIntegration {
    const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Routine";
    public static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Routine");
    public static string DefaultDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Routine");
    public static string? InstalledDirectory { get { using var key=Registry.CurrentUser.OpenSubKey(RegistryPath); return key?.GetValue("InstallLocation") as string; } }
    public static string ProjectId(string root) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(InstallEngine.Full(root).ToLowerInvariant()))).ToLowerInvariant();
    public static bool Running(string root) {
        try { using var mutex = Mutex.OpenExisting("Local\\RoutineLauncher-" + ProjectId(root)); return true; }
        catch (WaitHandleCannotBeOpenedException) { return false; }
    }
    public static void RequestClose(string root) {
        try { using var signal = EventWaitHandle.OpenExisting("Local\\RoutineStop-" + ProjectId(root)); signal.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
    }
    public static bool WebViewPresent() {
        const string key = @"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            foreach (var view in new[] { RegistryView.Registry32, RegistryView.Registry64 }) {
                using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                using var runtime = baseKey.OpenSubKey(key);
                if (Version.TryParse(runtime?.GetValue("pv") as string, out var v) && v > new Version(0,0,0,0)) return true;
            }
        return false;
    }
    [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)] static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, IntPtr data);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct TrustFile { public uint Size; public IntPtr Path; public IntPtr File; public IntPtr Known; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct TrustData {
        public uint Size; public IntPtr Policy, Sip; public uint Ui, Revocation, Choice; public IntPtr File; public uint State; public IntPtr StateData, Url; public uint Flags, Context;
    }
    public static void VerifyMicrosoft(string file) {
        var path = Marshal.StringToCoTaskMemUni(file); var info = new TrustFile { Size = (uint)Marshal.SizeOf<TrustFile>(), Path = path };
        var infoPtr = Marshal.AllocHGlobal(Marshal.SizeOf<TrustFile>()); Marshal.StructureToPtr(info, infoPtr, false);
        var data = new TrustData { Size = (uint)Marshal.SizeOf<TrustData>(), Ui = 2, Choice = 1, File = infoPtr, Flags = 0x1000 };
        var dataPtr = Marshal.AllocHGlobal(Marshal.SizeOf<TrustData>()); Marshal.StructureToPtr(data, dataPtr, false);
        try {
            var status = WinVerifyTrust(new IntPtr(-1), new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE"), dataPtr);
#pragma warning disable SYSLIB0057 // Authenticode signer extraction; certificate validity is checked by WinVerifyTrust.
            using var cert = new System.Security.Cryptography.X509Certificates.X509Certificate2(System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(file));
#pragma warning restore SYSLIB0057
            if (status != 0 || !cert.Subject.Split(',').Any(p => p.Trim() == "O=Microsoft Corporation")) throw new SetupFailure("R-IN-010", "A assinatura do componente Microsoft não pôde ser confirmada. Nada foi executado.");
        } finally { Marshal.FreeCoTaskMem(path); Marshal.FreeHGlobal(infoPtr); Marshal.FreeHGlobal(dataPtr); }
    }
    public static async Task InstallWebView(IProgress<InstallProgress> progress, CancellationToken token) {
        progress.Report(new("Baixando WebView2 da Microsoft…"));
        var folder = Path.Combine(Path.GetTempPath(), "Routine-prerequisite-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "MicrosoftEdgeWebview2Setup.exe");
        try {
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
            using var response = await client.GetAsync("https://go.microsoft.com/fwlink/p/?LinkId=2124703", HttpCompletionOption.ResponseHeadersRead, token);
            response.EnsureSuccessStatusCode();
            using (var src = await response.Content.ReadAsStreamAsync(token)) using (var dst = File.Create(file)) {
                var buffer = new byte[65536]; int read; long total = 0;
                while ((read = await src.ReadAsync(buffer, token)) > 0) { total += read; if (total > 20_000_000) throw new SetupFailure("R-IN-010", "O componente recebido excede o tamanho esperado."); await dst.WriteAsync(buffer.AsMemory(0,read), token); }
            }
            token.ThrowIfCancellationRequested(); VerifyMicrosoft(file);
            progress.Report(new("Instalando WebView2… Aguarde a Microsoft concluir."));
            using var process = Process.Start(new ProcessStartInfo(file, "/silent /install") { UseShellExecute = false, CreateNoWindow = true })!;
            // Don't cancel a third-party installer mid-transaction. Routine cancellation resumes after it exits.
            await process.WaitForExitAsync();
            if (!WebViewPresent()) throw new SetupFailure("R-IN-011", "WebView2 ainda não está disponível. Verifique sua conexão e tente novamente.");
            token.ThrowIfCancellationRequested();
        } catch (HttpRequestException e) { throw new SetupFailure("R-IN-009", "Não foi possível baixar WebView2. Confira a internet e tente novamente.", e); }
        finally { if (File.Exists(file)) File.Delete(file); Directory.Delete(folder); }
    }
    static string StartMenuLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Routine.lnk");
    static string DesktopLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Routine.lnk");
    static void Shortcut(string path, string root) {
        // Refuse to overwrite another app's identically named shortcut.
        Type t = Type.GetTypeFromProgID("WScript.Shell")!; dynamic shell = Activator.CreateInstance(t)!;
        try {
            dynamic link = shell.CreateShortcut(path);
            try {
                if (File.Exists(path) && !string.Equals((string)link.TargetPath, Path.Combine(root,"Routine.exe"), StringComparison.OrdinalIgnoreCase) && !LegacyShortcut(link)) throw new SetupFailure("R-IN-012", "Já existe outro atalho chamado Routine. Renomeie-o ou desmarque o atalho da área de trabalho.");
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                link.TargetPath = Path.Combine(root, "Routine.exe"); link.WorkingDirectory = root; link.IconLocation = Path.Combine(root, "assets", "routine.ico"); link.Description = "Seu ritmo. Sua evolução."; link.Save();
            } finally { Marshal.FinalReleaseComObject(link); }
        } finally { Marshal.FinalReleaseComObject(shell); }
    }
    static bool LegacyShortcut(dynamic link) {
        try {
            string directory=(string)link.WorkingDirectory;
            if (!string.Equals((string)link.TargetPath,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"wscript.exe"),StringComparison.OrdinalIgnoreCase)) return false;
            string script=((string)link.Arguments).Trim().Trim('"');
            if (!string.Equals(script,Path.Combine(directory,"Iniciar Routine.vbs"),StringComparison.OrdinalIgnoreCase)) return false;
            using var package=JsonDocument.Parse(File.ReadAllText(Path.Combine(directory,"package.json")));
            return package.RootElement.GetProperty("name").GetString()=="routine" && File.Exists(Path.Combine(directory,"assets","routine.ico"));
        } catch { return false; }
    }
    public sealed class IntegrationSnapshot {
        readonly Dictionary<string,(object value,RegistryValueKind kind)> values=new();
        readonly Dictionary<string,byte[]?> links=new();
        readonly bool existed;
        public IntegrationSnapshot() {
            using var key=Registry.CurrentUser.OpenSubKey(RegistryPath); existed=key!=null;
            if(key!=null) foreach(var name in key.GetValueNames()) values[name]=(key.GetValue(name)!,key.GetValueKind(name));
            foreach(var file in new[]{StartMenuLink,DesktopLink}) links[file]=File.Exists(file)?File.ReadAllBytes(file):null;
        }
        public void Restore() {
            Registry.CurrentUser.DeleteSubKeyTree(RegistryPath,false);
            if(existed) { using var key=Registry.CurrentUser.CreateSubKey(RegistryPath); foreach(var (name,v) in values)key.SetValue(name,v.value,v.kind); }
            foreach(var (file,bytes) in links) { if(bytes==null)File.Delete(file);else File.WriteAllBytes(file,bytes); }
        }
    }
    public static bool DataServerRunning() {
        try {
            using var control=JsonDocument.Parse(File.ReadAllText(Path.Combine(DataDirectory,".runtime","server-control.json")));
            var project=control.RootElement.GetProperty("projectId").GetString();
            if(System.Text.RegularExpressions.Regex.IsMatch(project??"","^[a-f0-9]{64}$")) {
                try{using var controller=Mutex.OpenExisting("Local\\RoutineLauncher-"+project);return true;}catch(WaitHandleCannotBeOpenedException){}
            }
            using var client=new HttpClient{Timeout=TimeSpan.FromSeconds(1)};
            int port=control.RootElement.GetProperty("port").GetInt32();
            if(port!=3000)return false;
            using var health=JsonDocument.Parse(client.GetStringAsync("http://127.0.0.1:3000/api/health").GetAwaiter().GetResult());
            return health.RootElement.GetProperty("app").GetString()=="routine" && health.RootElement.GetProperty("pid").GetInt32()==control.RootElement.GetProperty("pid").GetInt32() && health.RootElement.GetProperty("projectId").GetString()==control.RootElement.GetProperty("projectId").GetString();
        } catch{return false;}
    }
    public static void RequestDataServerClose() {
        if(!DataServerRunning())return;
        using var control=JsonDocument.Parse(File.ReadAllText(Path.Combine(DataDirectory,".runtime","server-control.json")));
        var id=control.RootElement.GetProperty("projectId").GetString()!;
        if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-f0-9]{64}$"))return;
        try{using var signal=EventWaitHandle.OpenExisting("Local\\RoutineStop-"+id);signal.Set();}catch(WaitHandleCannotBeOpenedException){}
    }
    static void RemoveShortcut(string path, string root) {
        if (!File.Exists(path)) return;
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        try { dynamic link = shell.CreateShortcut(path); try { if (string.Equals((string)link.TargetPath, Path.Combine(root,"Routine.exe"), StringComparison.OrdinalIgnoreCase)) File.Delete(path); } finally { Marshal.FinalReleaseComObject(link); } }
        finally { Marshal.FinalReleaseComObject(shell); }
    }
    public static void Register(string root, bool desktop) {
        var manifest = InstallEngine.ReadManifest(root);
        Shortcut(StartMenuLink, root); if (desktop) Shortcut(DesktopLink, root);
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath);
        key.SetValue("DisplayName", "Routine"); key.SetValue("DisplayVersion", manifest.Version); key.SetValue("Publisher", "Routine contributors");
        key.SetValue("InstallLocation", root); key.SetValue("DisplayIcon", Path.Combine(root,"assets","routine.ico"));
        key.SetValue("UninstallString", "\"" + Path.Combine(root,"maintenance","Routine.Setup.exe") + "\" --uninstall");
        key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
        long bytes = Directory.EnumerateFiles(root,"*",SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
        key.SetValue("EstimatedSize", (int)(bytes/1024), RegistryValueKind.DWord);
    }
    public static void Unregister(string root) {
        RemoveShortcut(StartMenuLink, root); RemoveShortcut(DesktopLink, root);
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath);
        if (string.Equals(key?.GetValue("InstallLocation") as string, root, StringComparison.OrdinalIgnoreCase)) Registry.CurrentUser.DeleteSubKeyTree(RegistryPath);
    }
    public static void ExportData(string destination) {
        if (InstallEngine.Inside(destination, DataDirectory)) throw new SetupFailure("R-UN-004", "Salve o backup fora da pasta de dados do Routine.");
        InstallEngine.NoLinks(DataDirectory);
        using var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Create);
        foreach (var dir in new[] { DataDirectory, Path.Combine(DataDirectory,"backups") }) {
            if (!Directory.Exists(dir)) continue; InstallEngine.NoLinks(dir);
            foreach (var file in Directory.EnumerateFiles(dir, "*.json")) {
                InstallEngine.NoLinks(file);
                if (dir == DataDirectory && Path.GetFileName(file) != "database.json") continue;
                zip.CreateEntryFromFile(file, Path.GetRelativePath(DataDirectory,file).Replace('\\','/'));
            }
        }
    }
}
