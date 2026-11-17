using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("Routine")]
[assembly: AssemblyProduct("Routine")]
[assembly: AssemblyDescription("Routine application entry point")]
[assembly: AssemblyVersion("1.3.0.0")]

internal static class LauncherBootstrap {
    [STAThread]
    private static void Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
#if DEVELOPMENT
        root = Path.GetFullPath(Path.Combine(root, "..", ".."));
#endif
        string launcher = Path.Combine(root, "desktop", "controller", "launcher.ps1");
        try {
            if (!File.Exists(launcher)) throw new FileNotFoundException("Os arquivos do Routine estao incompletos. Seus dados pessoais ficam guardados separadamente.");
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            Process.Start(new ProcessStartInfo {
                FileName = powershell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File \"" + launcher + "\" -Direct",
                WorkingDirectory = root,
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
            });
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Routine", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
