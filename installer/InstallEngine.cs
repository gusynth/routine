using System.IO.Compression;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace RoutineSetup;

public sealed class SetupFailure(string code, string message, Exception? inner = null) : Exception(message, inner) { public string Code { get; } = code; }
public record InstallProgress(string Stage, double? Fraction = null);
public sealed class ProgramManifest {
    public string Version { get; set; } = "";
    public int LayoutVersion { get; set; }
    public Dictionary<string, string> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

// No registry, UI or process mutations here. Tests exercise real archive and file operations in disposable fixtures.
public static class InstallEngine {
    public static string InstallAction(string? installedVersion,string targetVersion) {
        if(!Version.TryParse(targetVersion,out var target))throw new SetupFailure("R-IN-002","Versão do pacote inválida.");
        if(installedVersion==null)return "install";
        if(!Version.TryParse(installedVersion,out var installed))throw new SetupFailure("R-IN-004","A versão instalada não foi reconhecida.");
        return target>installed?"update":target==installed?"repair":"downgrade";
    }
    public const string ManifestName = "PROGRAM-MANIFEST.json";
    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    public static string Full(string path) => Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
    public static bool Inside(string child, string parent) => Full(child).StartsWith(Full(parent) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    public static void NoLinks(string path) {
        for (var p = Full(path); !string.IsNullOrEmpty(p); p = Path.GetDirectoryName(p))
            if ((File.Exists(p) || Directory.Exists(p)) && (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0)
                throw new SetupFailure("R-IN-003", "Esta pasta usa um link ou redirecionamento. Escolha uma pasta local comum.");
    }
    static IEnumerable<string> ProgramFiles(string root) {
        NoLinks(root);
        foreach(var entry in Directory.EnumerateFileSystemEntries(root)) {
            NoLinks(entry);
            if(Directory.Exists(entry)){foreach(var file in ProgramFiles(entry))yield return file;}
            else yield return entry;
        }
    }
    public static string SafeFile(string root, string relative) {
        if (string.IsNullOrWhiteSpace(relative) || relative.Contains('\\') || relative.Contains(':') || relative.StartsWith('/') || relative.Split('/').Any(p => p is "" or "." or ".." || p.EndsWith('.') || p.EndsWith(' ')))
            throw new SetupFailure("R-IN-002", "O pacote contém um caminho inválido.");
        var result = Full(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!Inside(result, root)) throw new SetupFailure("R-IN-002", "Um arquivo está fora da pasta do programa.");
        NoLinks(result); return result;
    }
    public static ProgramManifest ReadManifest(string root) {
        NoLinks(root);
        using var marker = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "routine.install.json")));
        if (marker.RootElement.GetProperty("appId").GetString() != "Routine" || marker.RootElement.GetProperty("layoutVersion").GetInt32() != 1)
            throw new SetupFailure("R-IN-004", "A pasta não é uma instalação reconhecida do Routine.");
        var manifest = JsonSerializer.Deserialize<ProgramManifest>(File.ReadAllText(Path.Combine(root, ManifestName)), Json)!;
        if (manifest.LayoutVersion != 1 || manifest.Files.Count is < 3 or > 10000 || !Version.TryParse(manifest.Version, out _))
            throw new SetupFailure("R-IN-002", "O manifesto do programa é inválido.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, hash) in manifest.Files) {
            SafeFile(root, name);
            if (!names.Add(name) || !System.Text.RegularExpressions.Regex.IsMatch(hash, "^[a-fA-F0-9]{64}$"))
                throw new SetupFailure("R-IN-002", "O manifesto contém entradas inválidas.");
        }
        return manifest;
    }
    public static void ValidateTarget(string target, string data) {
        target = Full(target); data = Full(data); NoLinks(target);
        if (target.Length < 8 || target == Full(Path.GetPathRoot(target)!) || target.StartsWith("\\\\") || Inside(data, target) || Inside(target, data) || target.Equals(data, StringComparison.OrdinalIgnoreCase))
            throw new SetupFailure("R-IN-003", "Escolha uma pasta exclusiva para o programa, separada dos seus registros.");
        foreach (var special in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) }.Where(p => p.Length > 0))
            if (Full(special).Equals(target, StringComparison.OrdinalIgnoreCase) || (special == Environment.GetFolderPath(Environment.SpecialFolder.Windows) && Inside(target, special)))
                throw new SetupFailure("R-IN-003", "Esta pasta é reservada pelo Windows ou contém seus arquivos pessoais.");
        if (Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any()) {
            var existing = ReadManifest(target);
            var allowed = existing.Files.Keys.Append(ManifestName).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var file in ProgramFiles(target)) {
                NoLinks(file);
                if (!allowed.Contains(Path.GetRelativePath(target,file).Replace('\\','/')))
                    throw new SetupFailure("R-IN-008", "Esta instalação contém arquivos adicionais. Guarde-os fora da pasta do programa antes de atualizar.");
            }
        }
    }
    static void DeleteOwnedTree(string root, string parent, string prefix) {
        if (!Inside(root, parent) || !Path.GetFileName(root).StartsWith(prefix, StringComparison.Ordinal)) throw new SetupFailure("R-IN-003", "Limpeza fora do escopo recusada.");
        NoLinks(root);
        if (!Directory.Exists(root)) return;
        // Refuse reparse points throughout; never traverse a junction while cleaning staging.
        foreach (var file in Directory.EnumerateFileSystemEntries(root)) {
            NoLinks(file);
            if (Directory.Exists(file)) DeleteOwnedTree(file, root, ""); else File.Delete(file);
        }
        Directory.Delete(root);
    }
    public static void CheckNotLocked(string root) {
        if (!Directory.Exists(root) || !File.Exists(Path.Combine(root, ManifestName))) return;
        var manifest = ReadManifest(root);
        foreach (var name in manifest.Files.Keys.Append(ManifestName)) {
            var file = SafeFile(root, name);
            if (!File.Exists(file)) continue;
            try { using var handle = File.Open(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException error) { throw new SetupFailure("R-IN-005", "Feche o Routine, inclusive o ícone perto do relógio, e tente novamente. Há um arquivo em uso.", error); }
        }
    }
    public static void Install(Stream zipStream, string target, string data, Action<string> integrate, Action undoIntegration, IProgress<InstallProgress>? progress, CancellationToken cancel) {
        target = Full(target); ValidateTarget(target, data); CheckNotLocked(target);
        var parent = Path.GetDirectoryName(target)!; Directory.CreateDirectory(parent);
        var prefix = ".routine-stage-"; var stage = Path.Combine(parent, prefix + Guid.NewGuid().ToString("N"));
        var previous = Path.Combine(parent, ".routine-previous-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage); bool oldMoved = false, newMoved = false, integrated = false;
        try {
            progress?.Report(new("Conferindo o pacote…"));
            using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);
            const string zipRoot = "Routine/";
            var manifestEntry = archive.GetEntry(zipRoot + ManifestName) ?? throw new SetupFailure("R-IN-002", "O pacote de instalação está incompleto.");
            if (manifestEntry.Length > 4_000_000) throw new SetupFailure("R-IN-002", "Manifesto muito grande.");
            using (var src = manifestEntry.Open()) using (var dst = File.Create(Path.Combine(stage, ManifestName))) src.CopyTo(dst);
            var markerEntry = archive.GetEntry(zipRoot + "routine.install.json") ?? throw new SetupFailure("R-IN-002", "Identificação do pacote ausente.");
            if (markerEntry.Length > 4096) throw new SetupFailure("R-IN-002", "Identificação inválida.");
            using (var src = markerEntry.Open()) using (var dst = File.Create(Path.Combine(stage, "routine.install.json"))) src.CopyTo(dst);
            var manifest = ReadManifest(stage);
            var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = archive.Entries.Sum(e => e.Length), done = 0;
            if (total > 4_000_000_000 || archive.Entries.Count > 12000) throw new SetupFailure("R-IN-002", "O pacote excede o tamanho esperado.");
            var drive = new DriveInfo(Path.GetPathRoot(stage)!);
            if (drive.AvailableFreeSpace < total + 100_000_000) throw new SetupFailure("R-IN-006", "Falta espaço no disco para instalar. Libere espaço e tente novamente.");
            foreach (var entry in archive.Entries) {
                cancel.ThrowIfCancellationRequested();
                if (!entry.FullName.StartsWith(zipRoot, StringComparison.Ordinal)) throw new SetupFailure("R-IN-002", "Entrada fora do pacote Routine.");
                if (entry.FullName.EndsWith('/')) continue;
                var name = entry.FullName[zipRoot.Length..]; var file = SafeFile(stage, name);
                if (!actual.Add(name) || name != ManifestName && !manifest.Files.ContainsKey(name)) throw new SetupFailure("R-IN-002", "O pacote contém um arquivo não identificado.");
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                using (var src = entry.Open()) using (var dst = File.Create(file)) src.CopyTo(dst);
                if (name != ManifestName) {
                    using var src = File.OpenRead(file);
                    if (!Convert.ToHexString(SHA256.HashData(src)).Equals(manifest.Files[name], StringComparison.OrdinalIgnoreCase)) throw new SetupFailure("R-IN-007", "A integridade do pacote não confere. Baixe o instalador novamente.");
                }
                done += entry.Length; progress?.Report(new("Preparando os arquivos…", (double)done / total));
            }
            if (actual.Count != manifest.Files.Count + 1) throw new SetupFailure("R-IN-002", "Há arquivos ausentes no pacote.");
            cancel.ThrowIfCancellationRequested(); progress?.Report(new("Finalizando sua instalação…"));
            // Commit is short and not cancellable. Keep the old directory for rollback until integration succeeds.
            if (Directory.Exists(target)) { Directory.Move(target, previous); oldMoved = true; }
            Directory.Move(stage, target); newMoved = true;
            integrated = true; integrate(target);
        } catch {
            try { if (integrated) undoIntegration(); }
            finally {
                if (newMoved) DeleteOwnedTree(target, parent, Path.GetFileName(target));
                if (oldMoved) Directory.Move(previous, target);
            }
            throw;
        } finally { if (Directory.Exists(stage)) DeleteOwnedTree(stage, parent, prefix); }
        // A failed old-version cleanup is reported, never rolled back over a committed installation.
        if (oldMoved) DeleteOwnedTree(previous, parent, ".routine-previous-");
    }
    public static IReadOnlyList<string> RemoveProgram(string root, IProgress<InstallProgress>? progress) {
        root = Full(root); var manifest = ReadManifest(root); CheckNotLocked(root);
        var failed = new List<string>(); int count = 0;
        // Marker and manifest survive partial deletion so retry remains possible.
        foreach (var name in manifest.Files.Keys.Where(n => n != "routine.install.json")) {
            var path = SafeFile(root, name);
            try { File.Delete(path); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { failed.Add(name); }
            progress?.Report(new("Removendo os arquivos do Routine…", (double)++count / manifest.Files.Count));
        }
        if (failed.Count > 0) return failed;
        File.Delete(Path.Combine(root, "routine.install.json")); File.Delete(Path.Combine(root, ManifestName));
        RemoveEmpty(root); return failed;
    }
    static void RemoveEmpty(string root) {
        if((File.GetAttributes(root)&FileAttributes.ReparsePoint)!=0)return;
        foreach (var dir in Directory.EnumerateDirectories(root)) RemoveEmpty(dir);
        if (!Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root);
    }
    public static void RemoveData(string data) {
        var allowed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Routine");
        if (!Full(data).Equals(Full(allowed), StringComparison.OrdinalIgnoreCase)) throw new SetupFailure("R-UN-003", "Pasta de dados fora do escopo; exclusão recusada.");
        DeleteOwnedTree(data, Path.GetDirectoryName(allowed)!, "Routine");
    }
}
