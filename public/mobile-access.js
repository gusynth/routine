let mobileRequest;
function mobileAccess() {
  mobileRequest?.abort();
  $("#app").innerHTML =
    heading(
      "SEU TREINO VAI COM VOCÊ",
      "Usar no celular.",
      "O PC guarda seus registros. O celular acessa o mesmo Routine pelo Wi-Fi.",
    ) +
    `<div class="phone-layout"><section class="card phone-connect"><div id="phoneConnection" role="status" aria-live="polite">Verificando acesso…</div><div id="phoneNetworks"></div><div id="phoneQr" class="phone-qr" hidden><img width="256" height="256" alt="QR Code para abrir o Routine na rede local"><p id="phoneQrError" class="footnote" hidden>O QR não carregou. Copie o endereço abaixo.</p></div><div id="phoneLinkGroup" hidden><label for="phoneLink">Endereço para abrir no celular</label><input id="phoneLink" readonly spellcheck="false"><div class="settings-actions"><button class="btn primary" onclick="copyMobileLink()">Copiar endereço</button></div></div><div class="settings-actions"><button id="phoneRefresh" class="btn" onclick="refreshMobileAccess()">Iniciar acesso no celular</button></div><p class="footnote">Abrir o Routine no PC já liga o servidor: o pequeno programa que guarda os dados e permite o acesso pelo celular. Este botão verifica o serviço e mostra o QR; não abre outro servidor.</p></section><section class="card phone-guide"><span class="eyebrow">SEM COMPLICAÇÃO</span><h2>Do PC para o seu treino.</h2><ol><li><b>Conecte os dois à mesma rede.</b><p>O PC pode usar Wi-Fi ou cabo no mesmo roteador. No celular, use o Wi-Fi de casa.</p></li><li><b>Escaneie o QR Code.</b><p>Use a câmera do celular e abra o link no navegador. Também pode copiar e enviar o endereço para você. Não precisa instalar APK.</p></li><li><b>Mantenha o PC e o Routine ligados.</b><p>Se o PC dormir ou o servidor encerrar, o celular perde a conexão. Rascunhos locais aguardam o próximo acesso.</p></li></ol><details class="sequence-panel"><summary>Como iniciar ou encerrar o servidor?</summary><p class="footnote">No Windows, abra o <b>Routine</b> pelo atalho. Para treinar só no telefone, use <b>Continuar somente no celular</b> nesta tela; o serviço continua no ícone perto do relógio. Se iniciou pelo terminal, use <b>npm start</b> e deixe-o aberto. Fechar o aplicativo encerra o serviço que ele iniciou; no terminal, use Ctrl+C.</p><p class="footnote">Uma página do navegador não consegue ligar um programa fechado no PC. Se perder a conexão, reabra pelo atalho do Routine e toque em Verificar novamente.</p></details><details class="sequence-panel"><summary>Não abriu no telefone?</summary><p class="footnote">Confira se o PC continua ligado e ambos estão na mesma rede. Rede de convidados, VPN e isolamento do roteador podem impedir o acesso. Se houver várias redes, tente outra no seletor. No Firewall do Windows, permita Node.js apenas na rede privada. Não precisa abrir portas no roteador.</p></details><p class="footnote">Use uma rede confiável: este servidor não tem senha. O QR é gerado localmente; não enviamos seu endereço a um serviço externo.</p></section></div>`;
  refreshMobileAccess();
  if (window.routineDesktopPhoneOnly && window.chrome?.webview) {
    const button = document.createElement('button');
    button.className = 'btn'; button.textContent = 'Continuar somente no celular';
    button.onclick = async () => {
      if (await confirmRoutine('Continuar no celular?', 'A janela do PC será fechada. O servidor continuará no ícone do Routine perto do relógio. Mantenha o PC ligado. Para encerrar tudo, use Encerrar Routine nesse ícone.', 'Continuar no celular'))
        window.chrome.webview.postMessage({type:'routine-phone-only'});
    };
    $('#phoneRefresh').parentElement.append(button);
  }
}
async function refreshMobileAccess() {
  mobileRequest?.abort();
  const request = (mobileRequest = new AbortController());
  const panel = $("#phoneConnection"),
    button = $("#phoneRefresh");
  if (!panel || !button) return;
  button.disabled = true;
  panel.textContent = "Verificando servidor e redes do PC…";
  const timeout = setTimeout(() => request.abort(), 6000);
  try {
    const response = await fetch("/api/mobile", { signal: request.signal });
    if (!response.ok) throw Error("connection");
    const data = await response.json();
    if (!panel.isConnected || mobileRequest !== request) return;
    if (!data.active || !Array.isArray(data.networks))
      throw Error("connection");
    panel.textContent = "● Servidor ativo no PC";
    panel.className = "phone-online";
    const networks = data.networks.filter((network) => {
      try {
        const url = new URL(network.url);
        return (
          url.protocol === "http:" &&
          url.hostname === network.ip &&
          /^\d+\.\d+\.\d+\.\d+$/.test(network.ip)
        );
      } catch {
        return false;
      }
    });
    $("#phoneNetworks").replaceChildren();
    $("#phoneQr").hidden = $("#phoneLinkGroup").hidden = !networks.length;
    if (!networks.length) {
      $("#phoneNetworks").innerHTML =
        '<p class="muted">Nenhuma rede local encontrada. Conecte o PC ao Wi-Fi ou cabo e toque em Verificar novamente.</p>';
    } else {
      const select = document.createElement("select"),
        label = document.createElement("label");
      select.id = "phoneNetwork";
      label.htmlFor = select.id;
      label.textContent = "Rede do PC";
      networks.forEach((network, index) =>
        select.add(
          new Option(network.name + " · " + network.ip, String(index)),
        ),
      );
      const update = () => {
        const network = networks[Number(select.value)];
        $("#phoneLink").value = network.url;
        const image = $("#phoneQr img");
        image.hidden = false;
        $("#phoneQrError").hidden = true;
        image.onerror = () => {
          if (image.isConnected) {
            image.hidden = true;
            $("#phoneQrError").hidden = false;
          }
        };
        image.src = "/api/mobile/qr?ip=" + encodeURIComponent(network.ip);
      };
      select.onchange = update;
      $("#phoneNetworks").append(label, select);
      update();
    }
  } catch {
    if (!panel.isConnected || mobileRequest !== request) return;
    panel.className = "";
    panel.textContent =
      "Não conseguimos confirmar o servidor. Reabra o Routine pelo atalho do PC e tente novamente.";
    $("#phoneQr").hidden = $("#phoneLinkGroup").hidden = true;
    $("#phoneNetworks").replaceChildren();
  } finally {
    clearTimeout(timeout);
    if (button.isConnected && mobileRequest === request) {
      button.disabled = false;
      button.textContent = "Verificar novamente";
    }
  }
}
async function copyMobileLink() {
  const input = $("#phoneLink");
  if (!input?.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw Error("clipboard");
    await navigator.clipboard.writeText(input.value);
    toast("Endereço copiado. Abra no navegador do celular.");
  } catch {
    input.focus();
    input.select();
    toast("Endereço selecionado. Use Copiar para compartilhar.");
  }
}
