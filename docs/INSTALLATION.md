# Instalação e dados

O build do instalador Windows x64 é `Routine-1.3.0-Setup.exe`. Ele inclui a interface HTML/CSS aprovada em WebView2, o mecanismo de instalação e o desinstalador próprio. Nenhuma release foi enviada ao GitHub automaticamente.

## Situação da validação

- Instalação concluída e testada manualmente pelo autor no Windows em 16/11/2026, com fluxo de instalação relatado como funcionando normalmente. Isso não equivale à validação completa da remoção ou de todas as configurações de Windows.
- Testes com arquivos fictícios: instalação, atualização, recuperação após falha de integração, cancelamento, integridade, arquivos bloqueados e preservação dos dados.
- Prévia HTML/CSS aprovada pelo usuário; testes DOM cobrem comandos reais, progresso, retenção, confirmação e mensagens de erro. Esses testes não substituem a instalação completa em Windows limpo.
- Tentativa em Windows Sandbox: execução bloqueada pela política de Controle de Aplicativos, tanto na pasta compartilhada quanto em uma cópia local do convidado. A instalação completa e a remoção ainda **não foram validadas nesse ambiente**.
- O executável não tem assinatura digital. Uma assinatura de distribuição confiável continua pendente. Nenhuma política de segurança foi desativada.

## Instalar

1. Executar o Setup e escolher a pasta e os atalhos.
2. Instalar o programa para o usuário, normalmente em `%LOCALAPPDATA%\Programs\Routine`.
3. Abrir o Routine diretamente pelo atalho. O serviço local inicia junto.
4. Para usar no celular, abrir a seção integrada de QR Code. Não é necessário um launcher separado.

O instalador inclui Node e .NET autocontido e verifica WebView2 antes de abrir a interface web. Se o componente estiver ausente, uma etapa nativa explica o download e pede confirmação; somente então baixa o instalador da Microsoft, verifica sua assinatura e o executa. Essa etapa precisa de internet. O payload de compilação é um arquivo interno do Setup, não uma edição portable para distribuição.

## Seus registros

Todos os modos de execução guardam dados fora do código, em `%LOCALAPPDATA%\Routine` no Windows:

- `database.json`: registros salvos pelo servidor;
- `backups/`: cópias com retenção;
- `.runtime/`: controle, logs e perfil da visualização, incluindo recuperação local.

No desenvolvimento e nos testes, `ROUTINE_DB` ou `ROUTINE_DATA_DIR` podem definir um destino explícito. No Linux, o padrão do servidor usa `XDG_DATA_HOME` ou `~/.local/share/Routine`.

## Backup e restauração

Exporte pela interface antes de atualizar ou trocar de computador. Para importar, use **Configurações → Dados**, confira a prévia e confirme. Um backup JSON exportado inclui os registros salvos no servidor; alterações ainda pendentes em um aparelho precisam ser sincronizadas antes.

O desinstalador mantém os registros por padrão. Apagar também os dados é uma escolha separada, com confirmação adicional. Abra a remoção em Configurações > Aplicativos do Windows; a entrada do Routine abre a interface própria. Componentes compartilhados, como WebView2, não são removidos.

## Desenvolvedores

Veja [DEVELOPMENT.md](DEVELOPMENT.md). O executável em `desktop/dev/` é apenas uma entrada para trabalhar no código desta máquina; não deve ser publicado como alternativa portable.
