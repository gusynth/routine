using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RoutineSetup;

var root=Path.Combine(Path.GetTempPath(),"routine-install-tests-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);int passed=0;
void Check(bool condition,string message){if(!condition)throw new Exception(message);}
MemoryStream Payload(string version="1.0.0",bool corrupt=false,bool missing=false,bool slip=false) {
    var files=new Dictionary<string,string>{{"routine.install.json","{\"appId\":\"Routine\",\"layoutVersion\":1}"},{"Routine.exe","fixture only "+version},{"desktop/app/library.dll","library "+version},{"assets/icon.txt","icon"}};
    var hashes=files.ToDictionary(p=>p.Key,p=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(p.Value))).ToLowerInvariant());
    if(corrupt)hashes["Routine.exe"]=new string('0',64);
    var output=new MemoryStream();using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true)) {
        foreach(var (name,text) in files){if(missing&&name=="Routine.exe")continue;using var w=new StreamWriter(archive.CreateEntry("Routine/"+name).Open());w.Write(text);}
        using(var w=new StreamWriter(archive.CreateEntry("Routine/PROGRAM-MANIFEST.json").Open()))w.Write(JsonSerializer.Serialize(new{version,layoutVersion=1,files=hashes}));
        if(slip){using var w=new StreamWriter(archive.CreateEntry("Routine/../escape.txt").Open());w.Write("escape");}
    }output.Position=0;return output;
}
void Install(MemoryStream payload,string target,Action<string>? integrate=null,Action? rollback=null,CancellationToken token=default){using(payload)InstallEngine.Install(payload,target,Path.Combine(root,"user-data"),integrate??(_=>{}),rollback??(()=>{}),null,token);}
void MustFail(Action action,string label){bool failed=false;try{action();}catch{failed=true;}Check(failed,label);passed++;}
try {
    foreach(var (installed,target,action) in new (string?,string,string)[]{(null,"1.0.0","install"),("1.0.0","1.0.1","update"),("1.0.0","1.0.0","repair"),("1.3.0","1.0.0","downgrade")}) {Check(InstallEngine.InstallAction(installed,target)==action,"Wrong installation intent");passed++;}
    MustFail(()=>InstallEngine.InstallAction("invalid","1.0.0"),"Invalid installed version accepted");
    var data=Path.Combine(root,"user-data");Directory.CreateDirectory(data);File.WriteAllText(Path.Combine(data,"database.json"),"personal sentinel");
    var app=Path.Combine(root,"installed-app");Install(Payload(),app);Check(InstallEngine.ReadManifest(app).Version=="1.0.0","Install failed");passed++;
    Install(Payload("1.1.0"),app);Check(File.ReadAllText(Path.Combine(app,"Routine.exe"))=="fixture only 1.1.0","Upgrade failed");Check(File.ReadAllText(Path.Combine(data,"database.json"))=="personal sentinel","User data changed");passed++;
    int undone=0;MustFail(()=>Install(Payload("2.0.0"),app,_=>throw new IOException("Integration fixture failure"),()=>undone++),"Rollback didn't fail");Check(undone==1&&InstallEngine.ReadManifest(app).Version=="1.1.0","Old version wasn't restored");passed++;
    foreach(var kind in new[]{"corrupt","missing","slip","cancel"}) {
        var destination=Path.Combine(root,"bad-"+kind);
        MustFail(()=>Install(Payload(corrupt:kind=="corrupt",missing:kind=="missing",slip:kind=="slip"),destination,token:kind=="cancel"?new CancellationToken(true):default),kind);
        Check(!Directory.Exists(destination),"Failed install left application directory");
    }
    Check(!File.Exists(Path.Combine(root,"escape.txt")),"Archive escaped target");passed++;
    File.WriteAllText(Path.Combine(app,"my-notes.txt"),"preserve");MustFail(()=>Install(Payload("2.0.0"),app),"Unknown user file accepted during upgrade");Check(File.Exists(Path.Combine(app,"my-notes.txt")),"Unknown file lost");
    File.Delete(Path.Combine(app,"my-notes.txt"));
    using(var locked=File.Open(Path.Combine(app,"Routine.exe"),FileMode.Open,FileAccess.ReadWrite,FileShare.None))MustFail(()=>Install(Payload("2.0.0"),app),"Locked file accepted");
    MustFail(()=>Install(Payload(),data),"Data folder accepted as program folder");
    MustFail(()=>InstallEngine.RemoveData(data),"Fixture mistaken for actual user data folder");
    MustFail(()=>InstallEngine.SafeFile(app,"../../outside.txt"),"Path traversal accepted");
    File.WriteAllText(Path.Combine(app,"my-notes.txt"),"preserve");
    Check(InstallEngine.RemoveProgram(app,null).Count==0,"Removal failed");Check(File.ReadAllText(Path.Combine(app,"my-notes.txt"))=="preserve","Unknown file deleted");Check(File.ReadAllText(Path.Combine(data,"database.json"))=="personal sentinel","Removal deleted data");passed++;
    Console.WriteLine(JsonSerializer.Serialize(new{passed,scope="Fixture files only; no registry, shortcuts, UI or personal records"}));
} finally {
    var resolved=Path.GetFullPath(root);
    if(!resolved.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(resolved).StartsWith("routine-install-tests-"))throw new Exception("Unexpected cleanup path");
    Directory.Delete(resolved,true);
}
