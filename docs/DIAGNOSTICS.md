# Diagnóstico e desempenho

Abra **Configurações → Dados e backups → Diagnóstico e códigos de erro** para consultar/copiar o relatório deste aparelho. Ele contém códigos, horários, resolução de renderização e amostras de fps das cenas ativas. Não inclui refeições, perfil, histórico, corpos de requisição ou tokens. São mantidos até 80 eventos, com deduplicação; nada é enviado automaticamente.

| Código | Significado / comportamento |
| --- | --- |
| R-START-001 | Inicialização do serviço desktop falhou. Consulte `%LOCALAPPDATA%\Routine\.runtime\startup-error.log`. |
| R-START-002 | Compilação do desktop ausente; reinstale o app ou prepare o ambiente de desenvolvimento. |
| R-GFX-001 | Inicialização WebGL ou módulo gráfico falhou. Mantém imagem local. |
| R-GFX-002 | Contexto gráfico perdido. Restaura imagem local e oferece tentar novamente. |
| R-GFX-003 | Exceção durante a execução gráfica. Suspende a cena e mantém imagem local. |
| R-GFX-004 | Primeiro frame não ficou disponível no prazo de inicialização. |
| R-GFX-005 | Compilação de shader falhou. |
| R-GFX-007 | Loop elegível de animação retomado automaticamente após interrupção de agendamento. |
| R-GFX-006 | Modo estático ativado nesta sessão, manualmente ou pela recuperação do desktop. |
| R-PERF-002 | Perfil mobile ajustou a resolução uma única vez após baixo desempenho sustentado. Desktop não é afetado. |
| R-PERF-001 | Cadência reduzida automaticamente por baixo desempenho, preservando a resolução. Não significa perda de dados. |
| R-WV-001 | Inicialização do desktop/WebView2 falhou. |
| R-WV-002 | Processo gráfico ou subframe falhou; app tenta preservar a interface e desativa efeitos nesta sessão. |
| R-WV-003 | Processo principal de navegação falhou ou deixou de responder. Botão para reabrir a visualização. |
| R-WV-004 | Navegação do desktop não conectou ao servidor. |
| R-WV-005 | Tentativa de recuperação gráfica do desktop não conseguiu executar o comando. |
| R-WV-006 | Outro processo auxiliar do WebView2 falhou; registra sem ocultar toda a interface. |
| R-APP-001 / 002 | Erro JavaScript não tratado / rejeição de Promise não tratada. |
| R-NET-001 | Requisição de rede falhou. |
| R-SYNC-001 | Canal de sincronização desconectado. Reconexão continua automática. |
| R-STORE-001 | Falhou a gravação da recuperação neste aparelho. O aviso continua explícito; não promete salvamento. |
| R-INIT-001 | App não conseguiu inicializar os registros ou a conexão. |
| R-DISK-001 | Operação de persistência/restauração falhou no disco. |
| R-SEC-001 | Nome do servidor não permitido. Para domínio próprio, configure ROUTINE_ALLOWED_HOSTS. |
| R-SEC-002 | Chamada da API bloqueada por origem incompatível ou cross-site. Abra pelo endereço do próprio Routine. |
| R-HTTP-xxx | Resposta HTTP de erro, identificada pelo status (409: revisão/conflito; 400: validação; 500: servidor). |

Falhas nativas ficam em `%LOCALAPPDATA%\Routine\.runtime\webview2\desktop-diagnostics.jsonl` (ou na pasta `--data-dir` configurada). Incluem tipo de processo, motivo e código de saída. O arquivo tem tamanho limitado. A interface de diagnóstico do navegador não importa esse arquivo automaticamente. O log do servidor fica em `%LOCALAPPDATA%\Routine\.runtime\server-error.log`.

## Limites gráficos

- Todas as cenas visíveis animam, no PC e no celular, sem depender de hover. Somente cenas fora da tela ou com a janela oculta são suspensas. Mantêm seu frame ou imagem de espera durante a suspensão.
- Meta de 30 fps, com ajuste de cadência até 20 fps se necessário. A medição usa tempo real entre frames; não confunde o delta limitado da física com o fps.
- Qualidade óptica restaurada: DPR 2, buffer de transmissão de 1024 px em HalfFloat, anti-aliasing e amostras de vidro da referência aprovada. Não reduz a resolução automaticamente; o ajuste atua na cadência. Renderizar com essa qualidade custa mais GPU que os limites agressivos anteriores.
- Mantém a liberação das cenas ao navegar, suspensão fora da tela, desenho único após redimensionamento e fallback de erros. A geometria otimizada da logo e a remoção da cópia preservada do framebuffer continuam.
- A imagem de espera só sai depois de um frame renderizado. Falhas voltam ao visual estático; não deixam uma superfície preta como único conteúdo.
- Reduzir animações começa pausado. Reduzir transparência ou o modo seguro da sessão usa imagens estáticas.

Após atualizar pelo instalador, reabra o Routine pelo atalho instalado. Reabrir uma visualização recupera somente o que já tiver sido salvo ou registrado na recuperação local; não há promessa de recuperar campos que nunca chegaram a ser persistidos.

A inicialização das cenas confirma a comunicação com a página e repete a solicitação até receber a política de visibilidade. Em cenas incorporadas, somente a página decide se estão na tela, evitando dois observers contraditórios. O diagnóstico inclui pausa manual, ativação pela página, loop agendado, visibilidade do documento e tempo da animação. O shader usa segundos reais; o delta limitado fica apenas no amortecimento do movimento.


### Atualização mobile — 16/11/2026

No celular/tablet com entrada principal por toque, o perfil equilibrado substitui os limites gráficos completos descritos acima: DPR máximo 1,5, transmissão 512 px, vidro 4 amostras, faces da logo 5, bordas 3 e captura com até 2 amostras MSAA. Desktop mantém DPR 2, transmissão 1024 e seus valores anteriores. Cor e tempo do shader preservam a referência original. Duas medições abaixo de 18 fps permitem um único ajuste para DPR 1,25. A cena mantém seu movimento e não é pausada ao rolar.
