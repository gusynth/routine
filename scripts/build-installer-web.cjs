// The executable UI is derived from the approved preview, including all artwork.
// Only simulated actions and preview controls are replaced by the native bridge.
const fs = require("node:fs");
let html = fs.readFileSync("installer/web/index.html", "utf8");
function replace(from, to) {
  if (!html.includes(from))
    throw Error("Approved UI anchor missing: " + from.slice(0, 70));
  html = html.replace(from, to);
}
replace(
  "<title>Routine · Prévia do instalador</title>",
  "<title>Routine · Instalação</title>",
);
replace(
  "</style>",
  `html,body{width:100%;height:100%;margin:0;padding:0;overflow:hidden}
#routine-setup-preview{visibility:hidden;height:100%;min-height:0}
#routine-setup-preview .rp-toolbar,#routine-setup-preview .rp-testbar{display:none}
#routine-setup-preview .rp-window{width:100%;height:100%;min-height:0;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column}
#routine-setup-preview .rp-header{flex:0 0 84px}
#routine-setup-preview .rp-stage{flex:1;min-height:0}
#routine-setup-preview .rp-page{flex:1;min-height:0;height:100%}
#routine-setup-preview .rp-copy{flex:1;min-height:0}
#routine-setup-preview .rp-bottom,#routine-setup-preview .rp-progress-area{flex-shrink:0}
#routine-setup-preview .rp-option-body{grid-template-columns:minmax(0,1fr) auto;column-gap:12px}
#routine-setup-preview .rp-field{grid-column:1;min-width:0}
#routine-setup-preview #rp-browse{grid-column:2;align-self:end;min-height:40px;padding:10px 18px}
#routine-setup-preview .rp-option-body>.rp-check{grid-column:1/-1}
#routine-setup-preview .rp-remove-options{flex-shrink:0}
@media(max-height:600px){
 #routine-setup-preview .rp-header{height:64px;flex-basis:64px;padding:16px 30px}
 #routine-setup-preview .rp-copy{padding-top:20px;padding-bottom:10px}
 #routine-setup-preview h1{font-size:38px;margin-bottom:14px}
 #routine-setup-preview .rp-overline{margin-bottom:12px}
 #routine-setup-preview p{font-size:12px;line-height:1.6}
 #routine-setup-preview .rp-bottom{padding-top:14px;padding-bottom:18px}
 #routine-setup-preview .rp-footerline{margin-top:16px}
 #routine-setup-preview .rp-option-body{padding-top:12px;padding-bottom:14px;gap:10px 12px}
 #routine-setup-preview .rp-remove-options{gap:12px;margin-top:0;margin-bottom:8px}
}
@media(max-height:520px){
 #routine-setup-preview .rp-copy{padding-top:12px}
 #routine-setup-preview h1,#routine-setup-preview .rp-remove-copy h1{font-size:32px}
 #routine-setup-preview .rp-overline{margin-bottom:10px}
 #routine-setup-preview .rp-retain{padding:10px 16px}
}
#routine-setup-preview button:disabled{pointer-events:none}
</style>`,
);
replace(
  "const saved=window.openai?.widgetState?.privateContent;",
  `  const saved=null;
 const bridge=window.chrome?.webview;
 const post=(action,extra={})=>bridge?.postMessage({action,...extra});
 const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let nativeDialog=null,nativeQueue=Promise.resolve(),currentProgress={fraction:0,label:''};
 state.folder='';
 function paintProgress(){const label=stage.querySelector('#rp-status'),pct=stage.querySelector('#rp-percent'),fill=stage.querySelector('.rp-fill'),track=stage.querySelector('[role=progressbar]');if(label)label.textContent=currentProgress.label;if(pct)pct.textContent=currentProgress.fraction==null?'':Math.round(currentProgress.fraction*100)+'%';if(fill&&currentProgress.fraction!=null)fill.style.transform='scaleX('+currentProgress.fraction+')';if(track&&currentProgress.fraction!=null)track.setAttribute('aria-valuenow',Math.round(currentProgress.fraction*100));}
 function applyDetails(message){
  const caption=root.querySelector('.rp-caption>span');if(caption&&message.version)caption.textContent='WINDOWS · '+message.version;
  if(message.view==='welcome'&&!message.removing&&message.installedVersion){
   const kind=message.installAction;
   stage.querySelector('.rp-overline').textContent=kind==='update'?'UMA NOVA VERSÃO PARA SUA ROTINA':kind==='repair'?'ROUTINE JÁ INSTALADO':'CONFIRA AS VERSÕES';
   const title=stage.querySelector('h1');title.textContent=kind==='update'?'Sua rotina.\\nSempre em dia.':kind==='repair'?'Tudo no lugar.\\nDe novo.':'Escolha como\\ncontinuar.';title.style.whiteSpace='pre-line';
   const description=stage.querySelector('.rp-copy>p');description.textContent='Instalado: '+message.installedVersion+' · Pacote: '+message.version+'\\nSeus registros serão mantidos.';description.style.whiteSpace='pre-line';
   stage.querySelector('#rp-primary').innerHTML=(kind==='update'?'Atualizar Routine':kind==='repair'?'Reparar Routine':'Instalar esta versão')+' '+icon('arrow-right');
   const input=stage.querySelector('#rp-folder');if(input)input.readOnly=true;
   const browse=stage.querySelector('#rp-browse');if(browse)browse.hidden=true;icons();
  }
  if(message.view==='error'){stage.querySelector('h1').textContent=message.title;stage.querySelector('h1').style.whiteSpace='pre-line';stage.querySelector('.rp-copy>p').textContent=message.description;stage.querySelector('.rp-status-code').textContent=message.code;}
  if(message.view==='success'){const button=stage.querySelector('#rp-again');if(button)button.innerHTML=icon(state.mode==='remove'?'folder-open':'check')+' '+(state.mode==='remove'?'Abrir pasta dos registros':'Concluir sem abrir');icons();}
  const folder=stage.querySelector('#rp-folder');if(folder)folder.value=state.folder;
  paintProgress();
 }
 bridge?.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='progress'){currentProgress=message;paintProgress();return;}
  if(message.type==='folder'){state.folder=message.path;const field=stage.querySelector('#rp-folder');if(field)field.value=message.path;return;}
  if(message.type==='backup'){const button=stage.querySelector('#rp-backup');if(button){button.innerHTML=icon('check')+' Backup exportado';icons();}return;}
  if(message.type==='dialog'){nativeDialog=message.id;dialog(escapeHTML(message.title),escapeHTML(message.description),escapeHTML(message.action),()=>{},message.danger);return;}
  if(message.type==='benefit'){benefit(escapeHTML(message.title).replace(/\\n/g,'<br>'),escapeHTML(message.description).replace(/\\n/g,'<br>'),message.index);return;}
  if(message.type==='state'&&message.view==='progress')currentProgress={fraction:null,label:'Conferindo o ambiente…'};
  if(message.type==='state')nativeQueue=nativeQueue.then(async()=>{
   state.mode=message.removing?'remove':'install';state.folder=message.folder??state.folder;state.deleteData=!!message.deleteData;
   await swap(message.view,!!message.initial);applyDetails(message);root.style.visibility='visible';
  }).catch(()=>post('ui-error'));
 });`,
);
// No fake folder or simulated completion in a production screen.
replace(
  'value="C:\\\\Users\\\\Você\\\\AppData\\\\Local\\\\Programs\\\\Routine"',
  'value="${escapeHTML(state.folder)}"',
);
replace(
  'aria-label="Pasta da instalação na prévia"',
  'aria-label="Pasta da instalação"',
);
replace(
  '</label><label class="rp-check"><input id="rp-desktop"',
  '</label><button class="rp-secondary" id="rp-browse" type="button">Alterar</button><label class="rp-check"><input id="rp-desktop"',
);
html = html
  .replaceAll("Progresso simulado", "Progresso da operação")
  .replaceAll(
    "Nesta simulação, o app e os registros",
    "O aplicativo e os registros",
  )
  .replaceAll("Dados removidos na simulação", "Dados selecionados removidos");
const start = html.indexOf(" function bind(){"),
  end = html.indexOf(" async function benefit(", start);
if (start < 0 || end < 0) throw Error("Simulation functions not found");
html =
  html.slice(0, start) +
  `  function bind(){
 stage.querySelector('#rp-options')?.addEventListener('click',toggleOptions);
 stage.querySelector('#rp-browse')?.addEventListener('click',()=>post('browse'));
 stage.querySelector('#rp-desktop')?.addEventListener('change',e=>state.desktop=e.target.checked);
 stage.querySelector('#rp-delete')?.addEventListener('change',e=>state.deleteData=e.target.checked);
 stage.querySelector('#rp-backup')?.addEventListener('click',()=>post('backup'));
 stage.querySelector('#rp-again')?.addEventListener('click',()=>post('back'));
 stage.querySelector('#rp-primary')?.addEventListener('click',()=>{
  if(transitioning)return;
  const field=stage.querySelector('#rp-folder');if(field)state.folder=field.value;
  stage.querySelectorAll('button').forEach(b=>b.disabled=true);
  post('primary',{folder:state.folder,desktop:state.desktop,deleteData:state.deleteData});
 });
 }
` +
  html.slice(end);
replace(
  "previousFocus?.focus();if(accept)action?.();",
  "   previousFocus?.focus();if(nativeDialog){const id=nativeDialog;nativeDialog=null;post('answer',{id,accept});}",
);
const closeStart = html.indexOf(" root.querySelector('.rp-close').onclick="),
  closeEnd = html.indexOf(" root.addEventListener('keydown'", closeStart);
html =
  html.slice(0, closeStart) +
  "  root.querySelector('.rp-close').onclick=()=>post('close');\n" +
  html.slice(closeEnd);
replace(
  "win.dataset.quiet=String(state.quiet);",
  "root.querySelector('.rp-brand').addEventListener('pointerdown',e=>{if(e.button===0)post('drag')});win.dataset.quiet=String(state.quiet);",
);
replace(
  "win.classList.toggle('rp-remove',state.mode==='remove');render();",
  "win.classList.toggle('rp-remove',state.mode==='remove');render();post('ready');",
);
html = html
  .replace(/^.*openai:set_globals.*$/gm, "")
  .replace(/^.*if\(globalThis.Tweak\).*$/gm, "");
fs.writeFileSync("installer/web/setup.html", html);
console.log("Production HTML generated from approved preview.");
