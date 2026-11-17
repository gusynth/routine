# Desenvolvimento

## Requisitos

- Node.js 22 ou superior; `.nvmrc` define a versão de trabalho.
- Para o desktop: Windows, SDK .NET 10 e WebView2 Runtime.
- A compilação de desenvolvimento depende do .NET Desktop Runtime correspondente. O instalador final deverá levar seu próprio runtime.

```sh
npm ci
npm start
```

O servidor fica em `http://localhost:3000`; Ctrl+C encerra a execução iniciada pelo terminal. Os dados continuam separados do repositório. Para testar com outro banco, defina `ROUTINE_DB` para um caminho descartável.

## Desktop

```sh
npm run desktop:prepare
```

Esse comando compila a janela em `desktop/app/` e a entrada de desenvolvimento em `desktop/dev/Routine.exe`. O controller interno fica em `desktop/controller/`; ele coordena o servidor, a janela e a bandeja. Sua janela de recuperação só é necessária quando a inicialização encontra uma falha.

Não há VBS de inicialização ou atualizador por cópia de pastas no fluxo ativo. Quem instala o produto usará o executável instalado.

## Validação

```sh
npm test
npm run test:launcher
python -B test/source-package.test.py
npm run build
```

Os testes devem usar dados descartáveis. Não execute testes de remoção/instalação contra os registros pessoais.

## Setup em desenvolvimento

`npm run installer:build` compila o desinstalador, prepara o payload interno e gera `releases/Routine-1.0.0-Setup.exe`, com SHA-256 e metadados. Requer Windows, Node, SDK .NET e acesso aos pacotes oficiais. O runtime autocontido é fixado em 10.0.15.

`npm run test:installer` testa o mecanismo usando arquivos descartáveis. O projeto `installer/tests/smoke` é um harness de integração WPF limitado ao usuário WDAGUtilityAccount com marcador explícito no Windows Sandbox. A execução no convidado foi bloqueada pela política de Controle de Aplicativos; o build não deve ser anunciado como integralmente validado em Windows limpo.

`scripts/build-install-payload.ps1` é uma etapa interna que recebe o caminho do desinstalador já compilado. O conteúdo de `artifacts/installer-payload/` não é uma distribuição portable. O código do mecanismo e os recursos visuais estão em `installer/`.

Compilados, payloads, relatórios temporários e conteúdo de `.private/` ficam fora do Git e do pacote público de fontes. O pacote de fontes inclui os recursos e o código necessários para continuar o desenvolvimento do instalador.
