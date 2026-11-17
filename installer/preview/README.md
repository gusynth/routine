# Prévia do novo instalador

A primeira etapa da migração troca somente a apresentação WPF por HTML/CSS
em WebView2. A janela WPF permanece como contêiner; todos os textos, ícones,
arte e controles apresentados são desenhados pelo navegador.

`../web/index.html` deriva da última prévia aprovada. `PROVENANCE.json` registra
a origem e o hash. Inter variável, SVGs e PNG são os mesmos recursos incorporados
da referência; Lucide 0.468.0 é distribuído localmente com sua licença.

Compilar: `powershell -File scripts/build-installer-preview.ps1` a partir da raiz.
Testes: `node --test installer/tests/web-preview.test.cjs`.

O executável desta etapa **simula** instalação e remoção. Não referencia
InstallEngine/WindowsIntegration, não altera banco, atalhos ou registro e não
contém payload. A ponte aceita somente arrastar e fechar. Documentos, scripts,
fontes e arte são locais; rede, navegação externa, downloads e permissões são
bloqueados. O perfil descartável usa uma pasta temporária exclusiva.

## WebView2 ausente

Esta prévia verifica o runtime antes de criar a janela. Se ausente, explica
R-PREVIEW-001 e encerra, sem instalar componentes. O fluxo de produção terá uma
etapa nativa mínima anterior à interface HTML: detectar o runtime, explicar e
pedir confirmação para prepará-lo, baixar o bootstrapper oficial e validar sua
assinatura Microsoft antes de executar. Erro de rede permite tentar novamente
ou sair. Sem baixar componentes sem consentimento nem depender de WebView2 para
exibir a própria etapa de preparação.

A alternativa de embutir Fixed Version permanece possível, com aumento de
tamanho e responsabilidade de atualização do runtime. A prévia não inclui esse
runtime nem promete execução offline em Windows sem WebView2.

## Próxima etapa, após aprovação visual

Substituir a simulação por uma ponte restrita de comandos e estados para o
mecanismo existente. Resultados e progresso virão de operações reais; retenção
de dados, confirmação de exclusão, exportação, rollback e erros permanecem no
componente nativo. Repetir testes em VM descartável, sem contornar App Control.

A prévia deve ser comparada em 100/125/150/200% de escala. Testes DOM não
comprovam nitidez, fluidez ou DPI; a validação visual em execução está pendente.
