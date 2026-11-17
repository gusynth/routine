using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Microsoft.Win32;

namespace RoutineSetup;

public partial class SetupWindow : Window {
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
    readonly bool removing;
    readonly string installationRoot;
    readonly DispatcherTimer carousel=new(){Interval=TimeSpan.FromSeconds(3.4)};
    string screen="welcome";
    bool transitioning, busy, expanded, allowClose, closeAfterWork, programRemoved;
    int benefit;
    CancellationTokenSource? cancellation;
    TaskCompletionSource<bool>? decision;
    IInputElement? priorFocus;
    static SolidColorBrush Ink(string hex)=>(SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
    bool Motion=>SystemParameters.ClientAreaAnimation;
    public Grid PreviewRoot=>DesignRoot;

    public SetupWindow(bool uninstall=false,string? root=null) {
        InitializeComponent(); removing=uninstall;
        installationRoot=root??WindowsIntegration.InstalledDirectory??WindowsIntegration.DefaultDirectory;
        FontFamily=new FontFamily(new Uri("pack://application:,,,/"),"/Routine.Setup;component/Fonts/#Routine UI");
        Heading.FontFamily=new FontFamily(new Uri("pack://application:,,,/"),"/Routine.Setup;component/Fonts/#Routine Display");
        using(var stream=Application.GetResourceStream(new Uri("/Routine.Setup;component/Art/wordmark.xaml",UriKind.Relative))!.Stream) {
            var mark=((DrawingImage)XamlReader.Load(stream)).Clone();
            void White(Drawing drawing){if(drawing is GeometryDrawing shape)shape.Brush=Brushes.White;else if(drawing is DrawingGroup group)foreach(var child in group.Children)White(child);}
            White(mark.Drawing);Wordmark.Source=mark;
        }
        Heading.FontWeight=FontWeight.FromOpenTypeWeight(550);
        Icon=System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/Routine.Setup;component/Art/routine.ico"));
        SourceInitialized+=(_,_)=>{int dark=1,round=2;var handle=new System.Windows.Interop.WindowInteropHelper(this).Handle;DwmSetWindowAttribute(handle,20,ref dark,4);DwmSetWindowAttribute(handle,33,ref round,4);};
        Title=removing?"Routine · Desinstalar":"Routine · Instalação";
        FolderPath.Text=installationRoot;
        SetDesignHeight(removing?616:552,false);
        PrimaryAction.Click+=async(_,_)=>await Primary();
        OptionsAction.Click+=async(_,_)=>{
            if(busy||transitioning)return;
            if(screen=="welcome"&&!removing)ToggleOptions();
            else if(screen=="welcome"&&removing)await ExportBackup();
            else if(screen=="success") {
                if(removing&&Directory.Exists(WindowsIntegration.DataDirectory))Process.Start(new ProcessStartInfo(WindowsIntegration.DataDirectory){UseShellExecute=true});
                else {allowClose=true;Close();}
            }
            else await Screen("welcome");
        };
        BrowseAction.Click+=(_,_)=>{
            var picker=new OpenFolderDialog{Title="Escolha onde instalar o Routine",InitialDirectory=Path.GetDirectoryName(FolderPath.Text)};
            if(picker.ShowDialog(this)==true) FolderPath.Text=string.Equals(Path.GetFileName(picker.FolderName),"Routine",StringComparison.OrdinalIgnoreCase)?picker.FolderName:Path.Combine(picker.FolderName,"Routine");
        };
        CloseAction.Click+=async(_,_)=>await RequestClose();
        CancelDialogAction.Click+=async(_,_)=>await Answer(false);
        ConfirmAction.Click+=async(_,_)=>await Answer(true);
        PreviewKeyDown+=async(_,e)=>{if(e.Key==Key.Escape){e.Handled=true;if(decision!=null)await Answer(false);else await RequestClose();}};
        Closing+=(_,e)=>{if(!allowClose){e.Cancel=true;Dispatcher.BeginInvoke(new Action(async()=>await RequestClose()));}};
        Closed+=(_,_)=>{carousel.Stop();cancellation?.Dispose();};
        carousel.Tick+=async(_,_)=>{
            if(!busy||decision!=null)return;
            benefit=(benefit+1)%3;
            var variants=new[]{("No seu ritmo.\nTodos os dias.","Treinos por tempo ou repetições.\nVocê escolhe como seguir."),("Seu progresso.\nSempre à mão.","Treinos e diário alimentar.\nUma história que você constrói."),("Do seu PC.\nPara o seu treino.","Abra no celular pelo QR Code.\nSem APK. Sem complicação.")};
            await Fade(Copy,1,0,220);if(!busy||screen!="progress"){Copy.Opacity=1;return;}Heading.Text=variants[benefit].Item1;Description.Text=variants[benefit].Item2;await Fade(Copy,0,1,600);
        };
        Loaded+=async(_,_)=>{await Enter();};
        ApplyScreen();
    }
    void SetDesignHeight(double height,bool animate) {
        // Keep the HWND and text at native DPI throughout panel transitions.
        // Resizing both a Viewbox and its child re-scaled glyphs every frame.
        Width=Math.Min(760,Math.Max(320,SystemParameters.WorkArea.Width-32));
        Height=Math.Min(616,Math.Max(320,SystemParameters.WorkArea.Height-32));
    }
    void Tween(DependencyObject target,DependencyProperty property,double to,int milliseconds) {
        double from=(double)target.GetValue(property); if(double.IsNaN(from))from=to;
        var animation=new DoubleAnimation(from,to,TimeSpan.FromMilliseconds(Motion?milliseconds:0)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseInOut},FillBehavior=FillBehavior.Stop};
        target.SetValue(property,to);
        if(target is Animatable a)a.BeginAnimation(property,animation);
        else if(target is UIElement e)e.BeginAnimation(property,animation);
        else if(target is ContentElement c)c.BeginAnimation(property,animation);
    }
    async Task Fade(UIElement element,double from,double to,int duration) {
        if(!Motion){element.Opacity=to;return;}
        var done=new TaskCompletionSource();
        var animation=new DoubleAnimation(from,to,TimeSpan.FromMilliseconds(duration)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseInOut},FillBehavior=FillBehavior.Stop};
        element.Opacity=to;animation.Completed+=(_,_)=>done.TrySetResult();element.BeginAnimation(OpacityProperty,animation);await done.Task;
    }
    async Task Enter() {
        await Task.WhenAll(Fade(Copy,0,1,560),Fade(Actions,0,1,680));
    }
    async Task Screen(string next) {
        if(transitioning)return;transitioning=true;PrimaryAction.IsEnabled=false;OptionsAction.IsEnabled=false;
        await Fade(Page,1,0,220);
        screen=next;ApplyScreen();
        bool complete=screen=="success";
        Tween(Hero,Canvas.LeftProperty,complete?222:260,1200);Tween(Hero,Canvas.TopProperty,complete?35:45,1200);
        Tween(Hero,WidthProperty,complete?538:500,1200);Tween(Hero,HeightProperty,complete?460:440,1200);
        Tween(Hero,OpacityProperty,removing?.22:complete?.55:.85,1200);
        await Task.WhenAll(Fade(Page,0,1,560),Fade(Actions,0,1,620));
        transitioning=false;PrimaryAction.IsEnabled=true;OptionsAction.IsEnabled=true;
    }
    void ToggleOptions() {
        expanded=!expanded; OptionsAction.Content=expanded?"Opções da instalação  ⌃":"Opções da instalação  ⌄";
        OptionsPanel.IsHitTestVisible=expanded;OptionsPanel.Focusable=expanded;
        if(!expanded&&OptionsPanel.IsKeyboardFocusWithin)OptionsAction.Focus();
        // Measure the actual font metrics, helper text, margins and current DPI.
        OptionsBody.Measure(new Size(Math.Max(1,OptionsPanel.ActualWidth),double.PositiveInfinity));
        double optionsHeight=Math.Ceiling(OptionsBody.DesiredSize.Height)+8;
        Tween(OptionsPanel,HeightProperty,expanded?optionsHeight:0,expanded?460:680);
        // Retarget from the current opacity so rapid reversals never flash.
        Tween(OptionsBody,OpacityProperty,expanded?1:0,expanded?460:680);
        FolderPath.IsEnabled=DesktopShortcut.IsEnabled=BrowseAction.IsEnabled=expanded;

    }
    void ApplyScreen() {
        SuccessNote.Visibility=ErrorCode.Visibility=RemovalOptions.Visibility=ProgressArea.Visibility=Visibility.Collapsed;
        Actions.Visibility=Visibility.Visible;OptionsPanel.Height=0;OptionsPanel.BeginAnimation(HeightProperty,null);expanded=false;
        OptionsBody.BeginAnimation(OpacityProperty,null);OptionsBody.Opacity=0;Heading.FontSize=screen=="error"?36:removing?36:43;Heading.LineHeight=screen=="error"||removing?41:46;
        PrimaryAction.Background=Ink(removing?"#FF344F":"#F3F3F5");PrimaryAction.Foreground=Ink(removing?"#FFFFFF":"#141419");
        OptionsAction.Visibility=Visibility.Visible;FolderPath.IsEnabled=DesktopShortcut.IsEnabled=BrowseAction.IsEnabled=false;
        FooterNote.Text="No seu PC. No seu ritmo.";
        SetDesignHeight(removing&&screen=="welcome"?616:552,false);
        if(screen=="welcome") {
            Overline.Text=removing?"DO SEU JEITO, ATÉ AQUI":"SEU PRÓXIMO MOVIMENTO";
            Heading.Text=removing?"Até o próximo\nmovimento.":"Sua rotina.\nComeça aqui.";
            Description.Text=removing?"Vamos remover o aplicativo.\nSeus registros continuam com você.":"Um espaço para treinar, registrar\ne continuar evoluindo. Todo seu.";
            OptionsAction.Content=removing?"↓  Exportar um backup":"Opções da instalação  ⌄";
            PrimaryAction.Content=removing?"Desinstalar Routine   →":"Instalar Routine   →";
            if(removing){RemovalOptions.Visibility=Visibility.Visible;Hero.Opacity=.22;}
        } else if(screen=="progress") {
            Overline.Text=removing?"CUIDANDO DO SEU ESPAÇO":"MENOS ATRITO. MAIS CONSTÂNCIA.";
            Heading.Text=removing?"Saindo com\ntudo em ordem.":"No seu ritmo.\nTodos os dias.";
            Description.Text=removing?"Removendo o app.\nCuidando dos registros que você escolheu manter.":"Treinos por tempo ou repetições.\nVocê escolhe como seguir.";
            Actions.Visibility=Visibility.Collapsed;ProgressArea.Visibility=Visibility.Visible;
            ProgressScale.ScaleX=0;PercentText.Text="";StageText.Text="Conferindo o ambiente…";
            FooterNote.Text=removing?"Nenhum outro programa será alterado.":"Seus registros existentes serão mantidos.";
        } else if(screen=="success") {
            Overline.Text="TUDO PRONTO";Heading.Text=removing?"Aplicativo removido.\nAté o próximo passo.":"Seu espaço.\nSeu próximo passo.";
            Description.Text=removing?(DeleteRecords.IsChecked==true?"O aplicativo e os registros selecionados foram removidos.":"Seus registros foram mantidos.\nProntos para quando você voltar."):"Abra, monte seu treino e comece.\nO acesso pelo celular já está integrado.";
            SuccessNote.Visibility=Visibility.Visible;
            SuccessText.Text=removing?(DeleteRecords.IsChecked==true?"Dados selecionados removidos":"Dados mantidos neste PC"):"Routine pronto para abrir";
            PrimaryAction.Content=removing?"Concluir   →":"Abrir Routine   →";
            PrimaryAction.Background=Ink("#F3F3F5");PrimaryAction.Foreground=Ink("#141419");
            OptionsAction.Content=removing?"Abrir pasta dos registros":"Concluir sem abrir";
        } else if(screen=="webview") {
            Overline.Text="SÓ FALTA UM DETALHE";Heading.Text="Uma janela para\no seu Routine.";
            Description.Text="O WebView2, da Microsoft, exibe o aplicativo. Vamos baixar e instalar esse componente antes de continuar. É necessário acesso à internet.";
            PrimaryAction.Content="Preparar e continuar   →";OptionsAction.Content="Voltar";
        } else { PrimaryAction.Content="Tentar novamente   →";OptionsAction.Content="Voltar";ErrorCode.Visibility=Visibility.Visible; }
    }
    async Task Primary() {
        if(busy||transitioning||decision!=null)return;
        if(screen=="success") {
            if(!removing){Process.Start(new ProcessStartInfo(Path.Combine(FolderPath.Text,"Routine.exe")){WorkingDirectory=FolderPath.Text,UseShellExecute=true});}
            allowClose=true;Close();return;
        }
        if(removing&&DeleteRecords.IsChecked==true&&!programRemoved) {
            if(!await Confirm("Apagar também seus registros?","Isso remove treinos, alimentação, progresso, backups e recuperação local da pasta de dados do Routine. Essa ação não pode ser desfeita.","Apagar e desinstalar",true))return;
        }
        if(screen=="error"&&(WindowsIntegration.Running(installationRoot)||await Task.Run(WindowsIntegration.DataServerRunning))) {
            if(!await Confirm("Encerrar o Routine?","O aplicativo e o servidor serão encerrados. Celulares conectados perderão acesso. Se houver registros pendentes, resolva a confirmação no próprio Routine.","Fechar e continuar"))return;
            WindowsIntegration.RequestClose(installationRoot);WindowsIntegration.RequestDataServerClose();await Task.Delay(1200);
        }
        if(!removing&&!WindowsIntegration.WebViewPresent()&&screen!="webview"){await Screen("webview");return;}
        busy=true;closeAfterWork=false;cancellation?.Dispose();cancellation=new();var token=cancellation.Token;
        await Screen("progress");
        if(!removing)carousel.Start();
        var progress=new Progress<InstallProgress>(p=>{
            StageText.Text=p.Stage;PercentText.Text=p.Fraction.HasValue?Math.Round(p.Fraction.Value*100)+"%":"";
            if(p.Fraction.HasValue)Tween(ProgressScale,ScaleTransform.ScaleXProperty,Math.Clamp(p.Fraction.Value,0,1),260);
        });
        try {
            if(WindowsIntegration.Running(installationRoot)||await Task.Run(WindowsIntegration.DataServerRunning))throw new SetupFailure("R-IN-005","O Routine ainda está aberto. Feche o aplicativo e o ícone perto do relógio para continuar. O acesso pelo celular também será encerrado.");
            if(!removing&&!WindowsIntegration.WebViewPresent())await WindowsIntegration.InstallWebView(progress,token);
            if(removing) {
                if(!programRemoved){
                    var failures=await Task.Run(()=>InstallEngine.RemoveProgram(installationRoot,progress));
                    if(failures.Count>0)throw new SetupFailure("R-UN-002","Alguns arquivos ainda estão em uso. Feche o Routine e tente novamente. Os registros foram mantidos.");
                    WindowsIntegration.Unregister(installationRoot);programRemoved=true;
                }
                if(DeleteRecords.IsChecked==true)await Task.Run(()=>InstallEngine.RemoveData(WindowsIntegration.DataDirectory));
            } else {
                var target=Path.GetFullPath(FolderPath.Text);
                var registered=WindowsIntegration.InstalledDirectory;
                if(registered!=null&&Directory.Exists(registered)&&!InstallEngine.Full(registered).Equals(InstallEngine.Full(target),StringComparison.OrdinalIgnoreCase))throw new SetupFailure("R-IN-014","O Routine já está instalado em outra pasta. Atualize no mesmo local ou desinstale a versão anterior primeiro.");
                var snapshot=new WindowsIntegration.IntegrationSnapshot();bool shortcut=DesktopShortcut.IsChecked==true;
                await Task.Run(()=>{
                    using var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("Routine.Payload.zip")??throw new SetupFailure("R-IN-002","Este arquivo é o desinstalador. Abra o Setup completo para instalar o Routine.");
                    InstallEngine.Install(payload,target,WindowsIntegration.DataDirectory,r=>Dispatcher.Invoke(()=>WindowsIntegration.Register(r,shortcut)),()=>Dispatcher.Invoke(snapshot.Restore),progress,token);
                });
            }
            carousel.Stop();
            if(decision!=null){DialogHeading.Text="A operação foi concluída.";DialogDescription.Text=removing?"O Routine já foi removido. Você pode fechar esta janela.":"O Routine já foi instalado. Fechar esta janela mantém o aplicativo instalado.";ConfirmAction.Content="Fechar";await decision.Task;}
            busy=false;
            if(closeAfterWork){allowClose=true;Close();return;}
            await Screen("success");
        } catch(OperationCanceledException) {busy=false;carousel.Stop();if(closeAfterWork){allowClose=true;Close();}else await Screen("welcome");}
        catch(Exception error) {
            busy=false;carousel.Stop();Log(error);
            await Screen("error");
            var known=error.GetBaseException() as SetupFailure;
            Overline.Text="VAMOS RESOLVER";Heading.Text=known?.Code=="R-IN-005"?"O Routine ainda\nestá aberto.":programRemoved?"Aplicativo removido.\nHá dados pendentes.":"Vamos tentar\nmais uma vez.";
            Description.Text=known?.Message??(programRemoved?"Não foi possível apagar todos os registros selecionados. Tente novamente para concluir essa etapa.":"Não foi possível concluir a operação. Confira as permissões e tente novamente. Seus registros foram preservados.");
            ErrorCode.Text=known?.Code??(removing?"R-UN-001":"R-IN-001");
        } finally {carousel.Stop();}
    }
    async Task ExportBackup() {
        if(await Task.Run(WindowsIntegration.DataServerRunning)){await Confirm("Salve seus registros primeiro","Feche o Routine para exportar uma cópia consistente. Se houver alterações pendentes no celular, sincronize antes.","Entendi");return;}
        var picker=new SaveFileDialog{Title="Guardar backup do Routine",Filter="Backup Routine (*.zip)|*.zip",FileName="Routine-registros-"+DateTime.Now.ToString("yyyy-MM-dd")+".zip",OverwritePrompt=true};
        if(picker.ShowDialog(this)!=true)return;
        try {if(File.Exists(picker.FileName)){await Confirm("Escolha outro nome","Já existe um arquivo nesse local. Para preservar seu backup anterior, escolha outro nome.","Entendi");return;}WindowsIntegration.ExportData(picker.FileName);OptionsAction.Content="✓  Backup exportado";}
        catch(Exception e){Log(e);await Confirm("Não foi possível exportar",e.GetBaseException().Message,"Entendi");}
    }
    async Task<bool> Confirm(string title,string text,string action,bool danger=false) {
        if(decision!=null)return false;priorFocus=Keyboard.FocusedElement;decision=new(TaskCreationOptions.RunContinuationsAsynchronously);
        DialogHeading.Text=title;DialogDescription.Text=text;ConfirmAction.Content=action;ConfirmAction.Background=Ink(danger?"#FF344F":"#F3F3F5");ConfirmAction.Foreground=Ink(danger?"#FFFFFF":"#141419");
        DialogOverlay.Visibility=Visibility.Visible;MainContent.IsEnabled=false;MainContent.Effect=new BlurEffect{Radius=4};CancelDialogAction.IsEnabled=ConfirmAction.IsEnabled=true;
        CancelDialogAction.Focus();_=Fade(DialogOverlay,0,1,340);_=Fade(DialogCard,0,1,540);
        var pending=decision;return await pending.Task;
    }
    async Task Answer(bool value) {
        if(decision==null||!ConfirmAction.IsEnabled)return;
        var pending=decision;CancelDialogAction.IsEnabled=ConfirmAction.IsEnabled=false;
        await Task.WhenAll(Fade(DialogOverlay,1,0,360),Fade(DialogCard,1,0,360));
        DialogOverlay.Visibility=Visibility.Collapsed;MainContent.IsEnabled=true;MainContent.Effect=null;decision=null;priorFocus?.Focus();pending.TrySetResult(value);
    }
    async Task RequestClose() {
        if(decision!=null||allowClose)return;
        if(busy) {
            if(!await Confirm("Interromper a preparação?","Se a operação ainda estiver em preparação, os arquivos temporários serão limpos. Seus registros existentes serão mantidos. Uma etapa já concluída não é desfeita ao fechar a janela.","Interromper"))return;
            closeAfterWork=true;cancellation?.Cancel();if(busy)return;
        }
        allowClose=true;Close();
    }
    static void Log(Exception error) {
        try {var folder=Path.Combine(WindowsIntegration.DataDirectory,".runtime");Directory.CreateDirectory(folder);var file=Path.Combine(folder,"setup-diagnostics.log");if(File.Exists(file)&&new FileInfo(file).Length>131072)File.WriteAllText(file,"");File.AppendAllText(file,DateTimeOffset.Now.ToString("O")+" "+error+Environment.NewLine);}catch{}
    }
}
