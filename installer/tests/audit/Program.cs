using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

// Read-only artifact verification. Does not load or execute the installer assembly.
if(args.Length==2&&args[0]=="--preview") {
 using var file=File.OpenRead(args[1]);using var pe=new PEReader(file);var metadata=pe.GetMetadataReader();
 var names=metadata.ManifestResources.Select(h=>metadata.GetString(metadata.GetManifestResource(h).Name)).ToArray();
 if(!names.Any(n=>n.EndsWith(".web.index.html",StringComparison.OrdinalIgnoreCase))||!names.Any(n=>n.EndsWith(".web.lucide.min.js",StringComparison.OrdinalIgnoreCase)))throw new Exception("Preview UI resources missing");
 if(names.Any(n=>n=="Routine.Payload.zip"))throw new Exception("Preview contains installation payload");
 if(metadata.TypeDefinitions.Any(h=>metadata.GetString(metadata.GetTypeDefinition(h).Name) is "InstallEngine" or "WindowsIntegration"))throw new Exception("Preview includes installation engine");
 Console.WriteLine(JsonSerializer.Serialize(new{preview=true,resources=names,noInstallationEngine=true,noPayload=true,scope="Read-only metadata; UI not executed"}));return;
}
if(args.Length!=3)throw new ArgumentException("build-root payload-zip setup-exe");
string build=args[0],payload=args[1],setup=args[2];
using(var file=File.OpenRead(Path.Combine(build,"obj-maintenance","Routine.Setup.dll")))using(var pe=new PEReader(file)){
 var metadata=pe.GetMetadataReader();
 if(!metadata.ManifestResources.Any(h=>metadata.GetString(metadata.GetManifestResource(h).Name).EndsWith("web.setup.html",StringComparison.OrdinalIgnoreCase)))throw new Exception("Production web interface missing from maintenance binary");
 if(metadata.ManifestResources.Any(h=>metadata.GetString(metadata.GetManifestResource(h).Name)=="Routine.Payload.zip"))throw new Exception("Uninstaller contains nested installation payload");
}
using(var file=File.OpenRead(Path.Combine(build,"obj-setup","Routine.Setup.dll")))using(var pe=new PEReader(file)){
 var metadata=pe.GetMetadataReader();
 var resource=metadata.ManifestResources.Select(h=>metadata.GetManifestResource(h)).Single(r=>metadata.GetString(r.Name)=="Routine.Payload.zip");
 var block=pe.GetSectionData(pe.PEHeaders.CorHeader!.ResourcesDirectory.RelativeVirtualAddress).GetReader((int)resource.Offset,4);
 if(block.ReadInt32()!=new FileInfo(payload).Length)throw new Exception("Embedded payload size mismatch");
}
using var archive=ZipFile.OpenRead(payload);
using var manifest=JsonDocument.Parse(archive.GetEntry("Routine/PROGRAM-MANIFEST.json")!.Open());
int verified=0;
foreach(var entry in manifest.RootElement.GetProperty("files").EnumerateObject()){
 var parts=entry.Name.Split('/');
 if(parts.Any(p=>p is ".private" or ".runtime" or "backups")||entry.Name.EndsWith("database.json"))throw new Exception("User data in payload");
 using var stream=archive.GetEntry("Routine/"+entry.Name)!.Open();
 if(!Convert.ToHexString(SHA256.HashData(stream)).Equals(entry.Value.GetString(),StringComparison.OrdinalIgnoreCase))throw new Exception("Hash mismatch: "+entry.Name);
 verified++;
}
using var config=JsonDocument.Parse(archive.GetEntry("Routine/desktop/app/RoutineDesktop.runtimeconfig.json")!.Open());
if(config.RootElement.GetProperty("runtimeOptions").GetProperty("includedFrameworks").EnumerateArray().Any(f=>f.GetProperty("version").GetString()!="10.0.15"))throw new Exception("Runtime version mismatch");
foreach(var name in new[]{"dotnet-LICENSE.txt","dotnet-THIRD-PARTY-NOTICES.txt","windowsdesktop-LICENSE.txt","webview2-LICENSE.txt","webview2-NOTICE.txt","lucide-LICENSE.txt","inter-OFL.txt"})if(archive.GetEntry("Routine/runtime/licenses/"+name)==null)throw new Exception("Runtime license missing");
using var executable=File.OpenRead(setup);var hash=Convert.ToHexString(SHA256.HashData(executable)).ToLowerInvariant();
if(File.ReadAllText(setup+".sha256").Split(' ')[0]!=hash)throw new Exception("Setup checksum mismatch");
Console.WriteLine(JsonSerializer.Serialize(new{verifiedFiles=verified,payloadPrivateData=false,uninstallerNestedPayload=false,dotNet="10.0.15",sha256=hash,scope="Read-only artifact audit; installer not executed"}));
