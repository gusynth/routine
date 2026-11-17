// Native end-to-end harness. Refuses to run outside the disposable Windows guest.
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using RoutineSetup;

namespace RoutineSmoke;
static class Program {
 static readonly string Output=@"C:\RoutineSetupOutput";
 static readonly List<string> Checks=new();
 static string Data=>WindowsIntegration.DataDirectory;
 static string Root=>WindowsIntegration.DefaultDirectory;
 static string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
 static WebView2 Web(WebSetupWindow w)=>(WebView2)typeof(WebSetupWindow).GetField("web",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(w)!;
 static void Check(bool condition,string message){if(!condition)throw new Exception(message);Checks.Add(message);File.AppendAllText(Path.Combine(Output,"progress.txt"),message+Environment.NewLine);}
 static async Task Wait(Func<Task<bool>> condition,int seconds=90){var until=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<until){try{if(await condition())return;}catch{}await Task.Delay(150);}throw new TimeoutException("Guest assertion timed out");}
 static async Task<bool> Test(WebSetupWindow w,string expression)=>JsonSerializer.Deserialize<bool>(await Web(w).CoreWebView2.ExecuteScriptAsync("Boolean("+expression+")"));
 static async Task Click(WebSetupWindow w,string selector){string json=JsonSerializer.Serialize(selector);await Wait(()=>Test(w,$"document.querySelector({json})&&!document.querySelector({json}).disabled&&!document.querySelector({json}).closest('[inert]')"));await Web(w).CoreWebView2.ExecuteScriptAsync($"document.querySelector({json}).click()");await Task.Delay(1000);}
 static async Task Shot(WebSetupWindow w,string name){using var file=File.Create(Path.Combine(Output,name+".png"));await Web(w).CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,file);}
 static async Task<WebSetupWindow> Open(bool remove=false){var w=new WebSetupWindow(remove,Root);w.Show();await Wait(()=>Task.FromResult(Web(w).CoreWebView2!=null));await Wait(()=>Test(w,"document.querySelector('#rp-primary')&&getComputedStyle(document.querySelector('#routine-setup-preview')).visibility==='visible'"));return w;}
 static async Task Close(WebSetupWindow w){await Click(w,".rp-close");await Wait(()=>Task.FromResult(!w.IsVisible));}
 static async Task Install(WebSetupWindow w){await Click(w,"#rp-primary");await Wait(()=>Test(w,"document.querySelector('#rp-primary')?.textContent.includes('Abrir Routine')"),240);await Task.Delay(1400);}
 static async Task Run(Application app) {
  WebSetupWindow? current=null;
  try {
   Directory.CreateDirectory(Output);
   // This guest is disposable, but still refuse to overwrite any preexisting records.
   if(Directory.Exists(Data)&&Directory.EnumerateFileSystemEntries(Data).Any())throw new Exception("Expected fresh guest data directory");
   Directory.CreateDirectory(Data);Directory.CreateDirectory(Path.Combine(Data,"backups"));
   File.WriteAllText(Path.Combine(Data,"database.json"),"{\"revision\":1,\"state\":{}}");
   File.WriteAllText(Path.Combine(Data,"backups","sentinel.txt"),"preserved");var sentinel=Hash(Path.Combine(Data,"database.json"));
   current=await Open();await Shot(current,"web-welcome");await Click(current,"#rp-options");await Shot(current,"web-options");
   Check(await Test(current,"document.querySelector('.rp-options-wrap').getBoundingClientRect().height>=document.querySelector('.rp-option-body').getBoundingClientRect().height"),"Real WebView options show the full helper text");
   Check(await Test(current,"document.documentElement.scrollHeight<=innerHeight+1 && document.querySelector('.rp-footerline').getBoundingClientRect().bottom<=innerHeight && document.querySelector('#rp-primary').getBoundingClientRect().bottom<=innerHeight"),"Expanded options keep the footer and primary button inside the window without page overflow");
   Check(await Test(current,"document.querySelector('#rp-browse').getBoundingClientRect().top < document.querySelector('.rp-option-body>.rp-check').getBoundingClientRect().top"),"Folder chooser shares its row with the path field");
   await Click(current,"#rp-options");await Install(current);await Shot(current,"web-installed");
   Check(File.Exists(Path.Combine(Root,"Routine.exe")),"HTML installer copied real program files");
   Check(WindowsIntegration.InstalledDirectory==Root,"Installed application is registered");
   Check(Hash(Path.Combine(Data,"database.json"))==sentinel,"Installation preserved existing records");await Close(current);current=null;
   Process.Start(new ProcessStartInfo(Path.Combine(Root,"Routine.exe")){UseShellExecute=true,WorkingDirectory=Root});
   using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(1)}){
    await Wait(async()=>{try{using var d=JsonDocument.Parse(await client.GetStringAsync("http://127.0.0.1:3000/api/health"));return d.RootElement.GetProperty("app").GetString()=="routine";}catch{return false;}},90);
    Check(true,"Installed entry point starts its bundled local server");
    current=await Open();await Click(current,"#rp-primary");await Wait(()=>Test(current,"document.querySelector('.rp-status-code')?.textContent==='R-IN-005'"));Check(true,"HTML UI displays real application-in-use error");await Close(current);current=null;
    WindowsIntegration.RequestDataServerClose();await Wait(async()=>{try{await client.GetStringAsync("http://127.0.0.1:3000/api/health");return false;}catch{return true;}},30);
   }
   await Task.Delay(1500);sentinel=Hash(Path.Combine(Data,"database.json"));
   current=await Open(true);await Shot(current,"web-uninstall");Check(await Test(current,"!document.querySelector('#rp-delete').checked"),"Uninstall retains data by default");
   await Click(current,"#rp-primary");await Wait(()=>Test(current,"document.querySelector('.rp-status')?.textContent.includes('Dados mantidos')"));await Shot(current,"web-removed");
   Check(!File.Exists(Path.Combine(Root,"Routine.exe")),"Real program files removed");Check(WindowsIntegration.InstalledDirectory==null,"Uninstall registration removed");Check(Hash(Path.Combine(Data,"database.json"))==sentinel,"Uninstall retained records");await Close(current);current=null;
   current=await Open();await Install(current);await Close(current);current=null;
   current=await Open(true);await Click(current,"#rp-delete");await Click(current,"#rp-primary");
   Check(await Test(current,"!document.querySelector('.rp-dialog-host').hidden"),"Deleting data requires real confirmation");await Shot(current,"web-confirm-delete");
   await Click(current,"#rp-dialog-back");Check(Directory.Exists(Data),"Cancelling destructive confirmation retained data");
   await Click(current,"#rp-primary");await Click(current,"#rp-dialog-confirm");await Wait(()=>Test(current,"document.querySelector('.rp-status')?.textContent.includes('Dados selecionados removidos')"));
   Check(!Directory.Exists(Data),"Confirmed deletion removed only the guest Routine records");await Close(current);current=null;
   File.WriteAllText(Path.Combine(Output,"result.json"),JsonSerializer.Serialize(new{passed=true,checks=Checks,scope="Disposable guest only; actual WebView2 interface and synthetic records"}));
  }catch(Exception error){File.WriteAllText(Path.Combine(Output,"result.json"),JsonSerializer.Serialize(new{passed=false,checks=Checks,error=error.ToString()}));if(current!=null)try{await Shot(current,"failure");}catch{}}
  finally{app.Shutdown();}
 }
 [STAThread] public static int Main(){
  if(Environment.UserName!="WDAGUtilityAccount"||!File.Exists(@"C:\RoutineSetupInput\allow-tests.flag"))return 20;
  Application.ResourceAssembly=typeof(WebSetupWindow).Assembly;
  var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};app.Startup+=async(_,_)=>await Run(app);app.Run();return 0;
 }
}
