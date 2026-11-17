# Dot-sourced by launcher.ps1; the dialog is owned by the launcher, no extra process.
function Show-RoutinePhone {
    [xml]$phoneXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Routine | Abrir no celular" Width="460" SizeToContent="Height" ResizeMode="NoResize" WindowStartupLocation="CenterOwner" Background="#0C0D0F" Foreground="#EEF2FF" FontFamily="Segoe UI" UseLayoutRounding="True">
 <Window.Resources><Style TargetType="Button"><Setter Property="Background" Value="#F4F4F6"/><Setter Property="Foreground" Value="#111214"/><Setter Property="Cursor" Value="Hand"/><Setter Property="FontSize" Value="12"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button"><Border Background="{TemplateBinding Background}" CornerRadius="10" Padding="14,11"><ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/></Border></ControlTemplate></Setter.Value></Setter><Style.Triggers><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.45"/></Trigger></Style.Triggers></Style></Window.Resources>
 <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="26">
  <TextBlock Text="SEU TREINO VAI COM VOCÊ" Foreground="#A6AFFF" FontSize="10"/>
  <TextBlock Text="Seu Routine, no celular." FontSize="30" FontWeight="SemiBold" Margin="0,8,0,14"/>
  <TextBlock Text="1. Conecte o celular ao mesmo Wi-Fi do PC.&#10;2. Abra a câmera e aponte para o QR Code.&#10;3. Toque no link que aparecer." TextWrapping="Wrap" LineHeight="21" Foreground="#ABABB7" FontSize="12"/>
  <Border x:Name="PhoneQrBox" Width="256" Height="256" Background="White" CornerRadius="20" Margin="0,20,0,14" Padding="8"><Image x:Name="PhoneQr" Stretch="Uniform" RenderOptions.BitmapScalingMode="NearestNeighbor"/></Border>
  <TextBlock x:Name="PhoneStatus" Text="Preparando o endereco da sua rede..." TextWrapping="Wrap" Foreground="#B5C6FF" FontSize="12" Margin="0,0,0,12"/>
  <TextBlock Text="Rede do PC" Foreground="#9EAAC1" FontSize="11" Margin="0,0,0,7"/>
  <ComboBox x:Name="PhoneNetworks" DisplayMemberPath="Label" FontSize="13" Padding="9" MinHeight="38"/>
  <TextBox x:Name="PhoneUrl" IsReadOnly="True" Background="#111214" Foreground="#E2E9FF" BorderBrush="#33343B" FontSize="16" Padding="12" Margin="0,10,0,10"/>
  <Grid><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="12"/><ColumnDefinition/></Grid.ColumnDefinitions><Button x:Name="PhoneCopy" Content="Copiar link"/><Button x:Name="PhoneRefresh" Content="Atualizar rede" Grid.Column="2" Background="#191A1D"/></Grid>
  <TextBlock Text="Mantenha o PC ligado e o launcher aberto. Você pode fechar este painel. Fechar o launcher encerra o acesso pelo celular." Foreground="#9EAAC1" TextWrapping="Wrap" FontSize="11" LineHeight="18" Margin="0,15,0,12"/>
  <Expander Header="Não abriu no celular?" Foreground="#C7D4F4" FontSize="12"><StackPanel Margin="0,10,0,0"><TextBlock Text="Confira se os dois estao na mesma rede. Evite o Wi-Fi de visitantes. Se houver mais de uma rede na lista, tente outro endereco." TextWrapping="Wrap" Foreground="#A9B5CC" LineHeight="19"/><TextBlock Text="No Firewall do Windows, permita o Node.js na rede privada. O launcher nao altera seu Firewall automaticamente." TextWrapping="Wrap" Foreground="#A9B5CC" LineHeight="19" Margin="0,9,0,0"/><TextBlock Text="Tela sempre acesa exige HTTPS no celular. Este QR Code usa a rede local por HTTP; os registros e timers funcionam, mas o bloqueio de tela pode nao estar disponivel." TextWrapping="Wrap" Foreground="#A9B5CC" LineHeight="19" Margin="0,9,0,0"/></StackPanel></Expander>
  <Button x:Name="PhoneClose" Content="Voltar" Margin="0,16,0,0" Background="#191A1D"/>
 </StackPanel></ScrollViewer>
</Window>
'@
    $phoneWindow = [Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $phoneXaml))
    $buttonStyle = $window.TryFindResource([Windows.Controls.Button])
    if ($buttonStyle) { $phoneWindow.Resources[[Windows.Controls.Button]] = $buttonStyle }
    $phoneWindow.Owner = $window; $phoneWindow.Icon = $window.Icon
    $phoneWindow.MaxHeight = [Windows.SystemParameters]::WorkArea.Height - 32
    $setPhoneTheme = ${function:Set-SystemTitleBar}
    $phoneWindow.Add_SourceInitialized({ & $setPhoneTheme $phoneWindow }.GetNewClosure())
    $networks = $phoneWindow.FindName('PhoneNetworks'); $qr = $phoneWindow.FindName('PhoneQr')
    $addressBox = $phoneWindow.FindName('PhoneUrl'); $phoneStatus = $phoneWindow.FindName('PhoneStatus')
    $copyButton = $phoneWindow.FindName('PhoneCopy')
    $qrBox = $phoneWindow.FindName('PhoneQrBox')
    $qrEndpoint = $url + '/api/mobile/qr?ip='
    $update = {
        $selected = $networks.SelectedItem
        $copyButton.IsEnabled = $null -ne $selected
        if (-not $selected) { $qrBox.Visibility = 'Collapsed'; $qr.Source = $null; $addressBox.Text = ''; $phoneStatus.Text = 'Nenhuma rede IPv4 encontrada. Conecte o PC ao Wi-Fi ou cabo e clique em Atualizar rede.'; return }
        $qrBox.Visibility = 'Visible'
        $addressBox.Text = $selected.Url
        $phoneStatus.Text = 'Escaneie o QR Code ou copie o link. Os dados salvos sincronizam entre PC e celular.'
        try {
            $bitmap = New-Object Windows.Media.Imaging.BitmapImage
            $bitmap.BeginInit()
            $bitmap.UriCachePolicy = New-Object Net.Cache.RequestCachePolicy([Net.Cache.RequestCacheLevel]::NoCacheNoStore)
            $bitmap.UriSource = [Uri]::new($qrEndpoint + $selected.Address)
            $bitmap.Add_DownloadFailed({ $phoneStatus.Text = 'O QR Code nao carregou. Use Copiar link e abra no navegador do celular.' }.GetNewClosure())
            $bitmap.EndInit()
            $qr.Source = $bitmap
        } catch { $qr.Source = $null; $phoneStatus.Text = 'O QR Code nao carregou. Use Copiar link e abra o endereco no navegador do celular.' }
    }.GetNewClosure()
    $refreshNetworks = {
        try { $items = @([RoutineLan]::GetAddresses()); $networks.ItemsSource = $items; if ($items.Count) { $networks.SelectedIndex = 0 } else { & $update } }
        catch { $qr.Source = $null; $qrBox.Visibility = 'Collapsed'; $addressBox.Text = ''; $phoneStatus.Text = 'Nao foi possivel consultar a rede. Reconecte o Wi-Fi e tente Atualizar rede.'; $copyButton.IsEnabled = $false }
    }.GetNewClosure()
    $networks.Add_SelectionChanged($update)
    $copyButton.Add_Click({
        try { [Windows.Clipboard]::SetText($addressBox.Text); $phoneStatus.Text = 'Link copiado. Envie para voce e abra no navegador do celular.' }
        catch { $addressBox.Focus() | Out-Null; $addressBox.SelectAll(); $phoneStatus.Text = 'Selecionei o endereco. Use Ctrl+C para copiar.' }
    }.GetNewClosure())
    $phoneWindow.FindName('PhoneRefresh').Add_Click($refreshNetworks)
    $phoneWindow.FindName('PhoneClose').Add_Click({ $phoneWindow.Close() }.GetNewClosure())
    & $refreshNetworks
    $phoneWindow.ShowDialog() | Out-Null
}
