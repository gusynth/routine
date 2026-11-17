# Contribuir

Use Node LTS 24/26. Instale com `npm ci`, rode `npm test` e `npm run build` quando mudar arquivos do frontend. Para alterações do desktop, use .NET SDK 10 e execute `npm run desktop:prepare`. Veja [desenvolvimento](docs/DEVELOPMENT.md).

Faça mudanças pequenas e descreva problema, comportamento resultante e validação. Preserve os efeitos aprovados, a opção de movimento reduzido, a navegação por teclado, as áreas de toque e o funcionamento offline/recuperação local. Não remova testes para contornar uma regressão.

Teste em banco temporário (`ROUTINE_DB`) e porta alternativa (`PORT`), nunca substituindo o banco pessoal. Não suba dados, perfis, logs ou screenshots com informações pessoais. Fixtures e capturas de QA devem usar registros fictícios.

Para bugs, use o template de issue com passos, resultado esperado/observado e códigos de diagnóstico. Para falhas de segurança, veja SECURITY.md.
