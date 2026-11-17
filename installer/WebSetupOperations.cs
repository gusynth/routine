using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace RoutineSetup;
public sealed partial class WebSetupWindow {
    string view="welcome",folder;
    bool busy,commandPending,closeAfterWork,programRemoved,deleteData;
    CancellationTokenSource? cancellation;
    TaskCompletionSource<bool>? decision;
    string? decisionId;
    readonly DispatcherTimer carousel=new(){Interval=TimeSpan.FromSeconds(3.4)};
    int benefitIndex;
    void Send(object message){if(!closing&&web.CoreWebView2!=null)web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));}
    string ReleaseVersion=>typeof(WebSetupWindow).Assembly.GetName().Version!.ToString(3);
    void State(string next,bool initial=false,string? title=null,string? description=null,string? code=null){view=next;Send(new{type="state",view,initial,removing,folder,deleteData,title,description,code,version=ReleaseVersion,installedVersion,installAction=InstallEngine.InstallAction(installedVersion,ReleaseVersion)});}
    static bool RuntimePresent(){try{return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());}catch(WebView2RuntimeNotFoundException){return false;}}
    async Task Prepare() {
        carousel.Tick+=(_,_)=>{
            if(!busy||decision!=null)return;
            benefitIndex=(benefitIndex+1)%3;
            var variants=new[]{("No seu ritmo.\nTodos os dias.","Treinos por tempo ou repetições.\nVocê escolhe como seguir."),("Seu progresso.\nSempre à mão.","Treinos e diário alimentar.\nUma história que você constrói."),("Do seu PC.\nPara o seu treino.","Abra no celular pelo QR Code.\nSem APK. Sem complicação.")};
            Send(new{type="benefit",title=variants[benefitIndex].Item1,description=variants[benefitIndex].Item2,index=benefitIndex});
        };
        if(RuntimePresent()){try{await Initialize();}catch(Exception error){BootstrapError(error);}return;}
        // WebView2 cannot display its own installation prompt. This small native
        // preflight is shown only when the runtime is absent, before the HTML UI.
        var panel=new StackPanel{Margin=new Thickness(40),VerticalAlignment=VerticalAlignment.Center};
        panel.Children.Add(new TextBlock{Text="Prepare a janela do Routine",FontSize=25,Foreground=Brushes.White,TextWrapping=TextWrapping.Wrap});
        panel.Children.Add(new TextBlock{Text="Para exibir este instalador, precisamos preparar o Microsoft Edge WebView2. O componente será baixado da Microsoft e poderá ser compartilhado com outros aplicativos. Seus registros não serão alterados. É necessária conexão com a internet.",Foreground=Brushes.LightGray,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,20,0,20),FontSize=14});
        var status=new TextBlock{Foreground=Brushes.LightGray,TextWrapping=TextWrapping.Wrap};panel.Children.Add(status);
        var prepare=new Button{Content="Preparar WebView2 e continuar",Padding=new Thickness(20,12,20,12),HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,20,0,0)};panel.Children.Add(prepare);Content=panel;
        prepare.Click+=async(_,_)=>{
            if(busy)return;busy=true;prepare.IsEnabled=false;cancellation=new();
            try {
                await WindowsIntegration.InstallWebView(new Progress<InstallProgress>(p=>status.Text=p.Stage),cancellation.Token);
                busy=false;if(closeAfterWork){await FinishClose();return;}
                Content=web;await Initialize();
            }catch(Exception error){busy=false;if(closeAfterWork){await FinishClose();return;}status.Text=(error.GetBaseException() as SetupFailure)?.Code+" · "+error.GetBaseException().Message;prepare.IsEnabled=true;}
        };
    }
    void BootstrapError(Exception error){MessageBox.Show(this,"R-SETUP-002 · Não foi possível abrir a interface. "+error.GetBaseException().Message,"Routine",MessageBoxButton.OK,MessageBoxImage.Error);_=FinishClose();}
    async Task Command(string json) {
        if(json.Length>8192)return;
        using var doc=JsonDocument.Parse(json);var data=doc.RootElement;
        if(data.ValueKind!=JsonValueKind.Object||!data.TryGetProperty("action",out var value)||value.ValueKind!=JsonValueKind.String)return;
        var action=value.GetString();
        if(action=="answer") {
            if(decision!=null&&data.TryGetProperty("id",out var id)&&id.GetString()==decisionId&&data.TryGetProperty("accept",out var accept)&&accept.ValueKind is JsonValueKind.True or JsonValueKind.False){var pending=decision;decision=null;decisionId=null;pending.TrySetResult(accept.GetBoolean());}return;
        }
        if(action=="ready"){State(view,true);return;}
        if(action=="drag"){if(System.Windows.Input.Mouse.LeftButton==System.Windows.Input.MouseButtonState.Pressed)try{DragMove();}catch(InvalidOperationException){}return;}
        if(action=="close"){await RequestClose();return;}
        if(busy||commandPending||decision!=null)return;
        commandPending=true;
        try {
            switch(action) {
                case "primary":
                    if(view=="welcome"&&!removing&&installedVersion==null&&data.TryGetProperty("folder",out var target)&&target.ValueKind==JsonValueKind.String)folder=target.GetString()!;
                    if(view=="welcome"&&removing)deleteData=data.TryGetProperty("deleteData",out var remove)&&remove.ValueKind==JsonValueKind.True;
                    bool desktop=!data.TryGetProperty("desktop",out var shortcut)||shortcut.ValueKind==JsonValueKind.True;
                    await Primary(desktop);break;
                case "back":
                    if(view=="success") {
                        if(removing&&Directory.Exists(WindowsIntegration.DataDirectory))Process.Start(new ProcessStartInfo(WindowsIntegration.DataDirectory){UseShellExecute=true});
                        else await FinishClose();
                    }else State("welcome");break;
                case "browse":
                    if(view!="welcome"||removing||installedVersion!=null)return;
                    var picker=new OpenFolderDialog{Title="Escolha onde instalar o Routine"};
                    if(picker.ShowDialog(this)==true){folder=string.Equals(Path.GetFileName(picker.FolderName),"Routine",StringComparison.OrdinalIgnoreCase)?picker.FolderName:Path.Combine(picker.FolderName,"Routine");Send(new{type="folder",path=folder});}break;
                case "backup":if(removing&&view=="welcome")await ExportBackup();break;
                case "ui-error":throw new SetupFailure("R-SETUP-003","A interface não conseguiu concluir uma transição. Feche e tente novamente.");
            }
        }finally{commandPending=false;}
    }
    async Task Primary(bool shortcut) {
        if(view=="success"){
            if(!removing)Process.Start(new ProcessStartInfo(Path.Combine(folder,"Routine.exe")){WorkingDirectory=folder,UseShellExecute=true});
            await FinishClose();return;
        }
        if(!removing&&InstallEngine.InstallAction(installedVersion,ReleaseVersion)=="downgrade"&&!await Confirm("Instalar uma versão anterior?",$"A versão instalada é {installedVersion} e este pacote é {ReleaseVersion}. Faça um backup antes de continuar: versões anteriores podem não compreender dados de uma versão mais recente. Deseja substituir os arquivos do programa?","Instalar esta versão")){State("welcome");return;}
        if(removing&&deleteData&&!programRemoved&&!await Confirm("Apagar também seus registros?","Isso remove treinos, alimentação, progresso, backups e recuperação local da pasta de dados do Routine. Essa ação não pode ser desfeita.","Apagar e desinstalar",true)){State("welcome");return;}
        if(view=="error"&&(WindowsIntegration.Running(installationRoot)||await Task.Run(WindowsIntegration.DataServerRunning))) {
            if(!await Confirm("Encerrar o Routine?","O aplicativo e o servidor serão encerrados. Celulares conectados perderão acesso. Sincronize registros pendentes antes de continuar.","Fechar e continuar")){State("welcome");return;}
            WindowsIntegration.RequestClose(installationRoot);WindowsIntegration.RequestDataServerClose();await Task.Delay(1200);
        }
        busy=true;closeAfterWork=false;cancellation?.Dispose();cancellation=new();var token=cancellation.Token;
        benefitIndex=0;State("progress");if(!removing)carousel.Start();
        var progress=new Progress<InstallProgress>(p=>Send(new{type="progress",label=p.Stage,fraction=p.Fraction}));
        try {
            if(WindowsIntegration.Running(installationRoot)||await Task.Run(WindowsIntegration.DataServerRunning))throw new SetupFailure("R-IN-005","O Routine ainda está aberto. Feche o aplicativo e o ícone perto do relógio para continuar. O acesso pelo celular também será encerrado.");
            if(removing) {
                if(!programRemoved){var failures=await Task.Run(()=>InstallEngine.RemoveProgram(installationRoot,progress));if(failures.Count>0)throw new SetupFailure("R-UN-002","Alguns arquivos ainda estão em uso. Feche o Routine e tente novamente. Os registros foram mantidos.");WindowsIntegration.Unregister(installationRoot);programRemoved=true;}
                if(deleteData)await Task.Run(()=>InstallEngine.RemoveData(WindowsIntegration.DataDirectory));
            }else {
                var target=Path.GetFullPath(folder);folder=target;
                var registered=WindowsIntegration.InstalledDirectory;
                if(registered!=null&&Directory.Exists(registered)&&!InstallEngine.Full(registered).Equals(InstallEngine.Full(target),StringComparison.OrdinalIgnoreCase))throw new SetupFailure("R-IN-014","O Routine já está instalado em outra pasta. Atualize no mesmo local ou desinstale a versão anterior primeiro.");
                var snapshot=new WindowsIntegration.IntegrationSnapshot();
                await Task.Run(()=>{
                    using var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("Routine.Payload.zip")??throw new SetupFailure("R-IN-002","Este arquivo é o desinstalador. Abra o Setup completo para instalar o Routine.");
                    InstallEngine.Install(payload,target,WindowsIntegration.DataDirectory,r=>Dispatcher.Invoke(()=>WindowsIntegration.Register(r,shortcut)),()=>Dispatcher.Invoke(snapshot.Restore),progress,token);
                });
            }
            carousel.Stop();if(decision!=null)await decision.Task;
            busy=false;if(closeAfterWork){await FinishClose();return;}State("success");
        }catch(OperationCanceledException){busy=false;if(closeAfterWork)await FinishClose();else State("welcome");}
        catch(Exception error){busy=false;await Fail(error);}
        finally{carousel.Stop();}
    }
    async Task<bool> Confirm(string title,string description,string action,bool danger=false) {
        if(decision!=null)return false;
        decision=new(TaskCreationOptions.RunContinuationsAsynchronously);decisionId=Guid.NewGuid().ToString("N");var pending=decision;
        Send(new{type="dialog",id=decisionId,title,description,action,danger});return await pending.Task;
    }
    async Task RequestClose() {
        if(closing||decision!=null)return;
        if(busy) {
            bool accept=web.CoreWebView2==null?MessageBox.Show(this,"A preparação do componente pode levar alguns instantes para encerrar com segurança. Deseja sair quando ela terminar?","Routine",MessageBoxButton.YesNo,MessageBoxImage.Question)==MessageBoxResult.Yes:await Confirm("Interromper a preparação?","Os arquivos temporários da instalação serão limpos quando possível e seus registros existentes serão mantidos. Uma etapa já concluída não é desfeita ao fechar.","Interromper");
            if(!accept)return;closeAfterWork=true;cancellation?.Cancel();if(busy)return;
        }
        await FinishClose();
    }
    async Task ExportBackup() {
        if(await Task.Run(WindowsIntegration.DataServerRunning)){await Confirm("Salve seus registros primeiro","Feche o Routine para exportar uma cópia consistente. Se houver alterações pendentes no celular, sincronize antes.","Entendi");return;}
        var picker=new SaveFileDialog{Title="Guardar backup do Routine",Filter="Backup Routine (*.zip)|*.zip",FileName="Routine-registros-"+DateTime.Now.ToString("yyyy-MM-dd")+".zip",OverwritePrompt=true};
        if(picker.ShowDialog(this)!=true)return;
        try{if(File.Exists(picker.FileName)){await Confirm("Escolha outro nome","Já existe um arquivo nesse local. Escolha outro nome para preservar seu backup anterior.","Entendi");return;}WindowsIntegration.ExportData(picker.FileName);Send(new{type="backup"});}
        catch(Exception error){await Confirm("Não foi possível exportar",error.GetBaseException().Message,"Entendi");}
    }
    async Task Fail(Exception error) {
        if(decision!=null)await decision.Task;
        var known=error.GetBaseException() as SetupFailure;
        try{var directory=Path.Combine(WindowsIntegration.DataDirectory,".runtime");Directory.CreateDirectory(directory);var file=Path.Combine(directory,"setup-diagnostics.log");if(File.Exists(file)&&new FileInfo(file).Length>131072)File.WriteAllText(file,"");File.AppendAllText(file,DateTimeOffset.Now.ToString("O")+" "+error+Environment.NewLine);}catch{}
        State("error",title:known?.Code=="R-IN-005"?"O Routine ainda\nestá aberto.":programRemoved?"Aplicativo removido.\nHá dados pendentes.":"Vamos tentar\nmais uma vez.",description:known?.Message??"Não foi possível concluir a operação. Confira as permissões e tente novamente. Seus registros foram preservados.",code:known?.Code??(removing?"R-UN-001":"R-IN-001"));
    }
}
