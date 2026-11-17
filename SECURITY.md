# Segurança

Routine é um app pessoal local, com um banco por servidor e sem contas/autenticação. Não é um serviço multiusuário pronto para exposição pública.

## Rede

O servidor escuta em 0.0.0.0 para permitir PC + celular. Use uma rede privada confiável. Há proteção de Host e origem da API contra chamadas cross-site e hostnames arbitrários; isso não impede que alguém já na rede acesse o endereço diretamente.

Não encaminhe a porta no roteador e não exponha um túnel sem autenticação na camada do túnel. `ROUTINE_ALLOWED_HOSTS` não é senha nem controle de identidade.

## Dados e diagnósticos

Nunca publique `database.json`, `backups/`, `.runtime/`, `.env`, perfis de navegador ou relatórios pessoais. O diagnóstico da interface coleta códigos e métricas gráficas, sem textos de refeições/treinos; revise qualquer arquivo antes de compartilhar. O log nativo pode conter caminhos locais.

Salvamentos usam revisão para evitar sobrescritas silenciosas; restaurações exigem confirmação. Backups ficam no mesmo PC e não substituem uma cópia em outro local.

## Reportar um problema

Use o canal privado de segurança do GitHub, se habilitado. Se não estiver disponível, abra uma issue apenas indicando que precisa de um canal privado, sem dados pessoais nem detalhes de exploração pública.

Inclua versão, plataforma e código do erro. Não inclua senhas, cookies, chaves ou o banco completo.
