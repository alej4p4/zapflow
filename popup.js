// ============================ ESTADO / STORAGE ============================
const STORAGE_KEY = 'zapflow_clientes';
const FUNIL_KEY = 'zapflow_funil';
const CATALOGO_KEY = 'zapflow_catalogo';
const RESPOSTAS_KEY = 'zapflow_respostas';
const DISPAROS_KEY = 'zapflow_disparos';
const USERS_KEY = 'zapflow_usuarios';
const HISTORY_KEY = 'zapflow_historico';
const SESSION_KEY = 'zapflow_session';
const CFG_KEY = 'zapflow_config';
const SCHEMA_KEY = 'zapflow_schema_version';
const VERIFICADOR_KEY = 'zapflow_verificador';

const CFG_PADRAO = {
  intervalo: 5,
  limite: 60,
  antiDuplicidade: 'sim',
  apiKeyIA: '',
  modeloIA: 'gpt-3.5-turbo',
  abrirEmAbaCheia: false
};

const CHAVES_SINCRONIZADAS = [
  STORAGE_KEY, FUNIL_KEY, CATALOGO_KEY, RESPOSTAS_KEY,
  DISPAROS_KEY, USERS_KEY, HISTORY_KEY, CFG_KEY, VERIFICADOR_KEY
];

// Utilitário: escapar HTML para prevenir XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Utilitário: gerar UUID v4 simplificado
function gerarId() {
  return 'zf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// ============================ SINCRONIZAÇÃO UNIFICADA (chrome.storage) ============================
async function sincronizarStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const dados = await chrome.storage.local.get(CHAVES_SINCRONIZADAS);
      for (const k of CHAVES_SINCRONIZADAS) {
        if (dados[k] !== undefined) {
          localStorage.setItem(k, JSON.stringify(dados[k]));
        } else {
          const localVal = localStorage.getItem(k);
          if (localVal) {
            try {
              chrome.storage.local.set({ [k]: JSON.parse(localVal) });
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn('Sincronização chrome.storage:', e);
    }
  }
}

function salvarItemSincronizado(key, itens) {
  localStorage.setItem(key, JSON.stringify(itens));
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [key]: itens }).catch(() => {});
  }
}

// Ouvir alterações em tempo real vindas do WhatsApp Web ou outras abas
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      let precisaAtualizar = false;
      for (const [k, change] of Object.entries(changes)) {
        if (CHAVES_SINCRONIZADAS.includes(k) && change.newValue !== undefined) {
          localStorage.setItem(k, JSON.stringify(change.newValue));
          precisaAtualizar = true;
        }
      }
      if (precisaAtualizar) {
        const moduloAtivo = localStorage.getItem('zapflow_modulo_ultimo') || 'dashboard';
        carregarModulo(moduloAtivo);
      }
    }
  });
}

function getClientes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function setClientes(clientes) { salvarItemSincronizado(STORAGE_KEY, clientes); }
function lista(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function salva(key, itens) { salvarItemSincronizado(key, itens); }

function getConfig() {
  try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return CFG_PADRAO; }
}

// Hash de senha via Web Crypto API (SHA-256)
async function hashSenha(senha) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(senha));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Criptografar/descriptografar texto com senha mestra (AES-GCM)
async function criptografarTexto(texto, senha) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('zapflow-ia-key'), iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(texto));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted))) + ':' + btoa(String.fromCharCode(...iv));
}

async function descriptografarTexto(cifrado, senha) {
  const [dadosB64, ivB64] = cifrado.split(':');
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('zapflow-ia-key'), iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const dados = Uint8Array.from(atob(dadosB64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, dados);
  return new TextDecoder().decode(decrypted);
}

// Validação de telefone brasileiro (10 ou 11 dígitos com DDD)
function telefoneValido(numero) {
  const n = String(numero).replace(/\D/g, '');
  return /^[1-9]{2}[0-9]{8,9}$/.test(n);
}

// ============================ NAVEGAÇÃO SIDEBAR ============================
const itensMenu = document.querySelectorAll('.menu-item');
const modulos = document.querySelectorAll('.module');

function esconderTodos() {
  modulos.forEach(m => m.hidden = true);
}
function ativarItem(btn) {
  itensMenu.forEach(i => i.classList.remove('active'));
  btn.classList.add('active');
}

function navegarParaModulo(moduloId) {
  esconderTodos();
  const alvo = document.getElementById(moduloId);
  if (alvo) alvo.hidden = false;
  const btn = document.querySelector(`.menu-item[data-module="${moduloId}"]`);
  if (btn) {
    ativarItem(btn);
    const tituloEl = document.getElementById('titulo-pagina');
    if (tituloEl) tituloEl.textContent = btn.textContent.trim();
  }
  carregarModulo(moduloId);
}

itensMenu.forEach(btn => {
  btn.addEventListener('click', () => {
    navegarParaModulo(btn.dataset.module);
  });
});

// ============================ TELA CHEIA / ADAPTAÇÃO AO MONITOR ============================
function configurarModoTelaCheia() {
  const btnHeader = document.getElementById('btn-fullscreen-header');
  const btnSidebar = document.getElementById('btn-fullscreen-sidebar');
  const btnBannerWA = document.getElementById('btn-banner-abrir-wa');

  btnBannerWA?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://web.whatsapp.com' });
    window.close();
  });

  function alternarTelaCheia() {
    const estaEmAba = window.innerWidth >= 850 || window.location.search.includes('tab=1');
    if (!estaEmAba && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      window.close();
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  btnHeader?.addEventListener('click', alternarTelaCheia);
  btnSidebar?.addEventListener('click', alternarTelaCheia);
}

// ============================ AUTH / EQUIPE ============================
let usuarioAtual = null;

function getUsuarios() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
}
function setUsuarios(u) { salvarItemSincronizado(USERS_KEY, u); }
function getHistorico() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function setHistorico(h) { salvarItemSincronizado(HISTORY_KEY, h); }

function logAcao(acao, detalhe) {
  const u = usuarioAtual ? usuarioAtual.login : '(sistema)';
  const h = getHistorico();
  h.unshift({ acao, detalhe, usuario: u, data: new Date().toISOString() });
  if (h.length > 500) h.length = 500;
  setHistorico(h);
}

function ehAdmin() { return usuarioAtual && usuarioAtual.perfil === 'admin'; }

async function fazerLogin(login, senha) {
  const usuarios = getUsuarios();
  const u = usuarios.find(x => x.login === login);
  if (!u) return false;
  const senhaHash = await hashSenha(senha);
  if (u.senha !== senhaHash) return false;
  usuarioAtual = { 
    login: u.login, 
    nome: u.nome, 
    perfil: u.perfil, 
    primeiroLogin: u.primeiroLogin === true,
    id: u.id,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(usuarioAtual));
  renderUserBar();
  return true;
}

function fazerLogout() {
  usuarioAtual = null;
  localStorage.removeItem(SESSION_KEY);
  renderUserBar();
}

async function garantirAdmin() {
  const usuarios = getUsuarios();
  if (!usuarios.length) {
    const senhaHash = await hashSenha('admin123');
    setUsuarios([{ 
      nome: 'Administrador', 
      login: 'admin', 
      senha: senhaHash, 
      perfil: 'admin', 
      id: gerarId(),
      primeiroLogin: true 
    }]);
    logAcao('sistema', 'Admin padrão criado (admin / admin123)');
  }
}

function renderUserBar() {
  const nomeEl = document.getElementById('user-nome');
  const btn = document.getElementById('btn-login-sidebar');
  if (!usuarioAtual) {
    nomeEl.textContent = 'Não logado';
    btn.textContent = 'Entrar';
    btn.onclick = async () => {
      const login = prompt('Login:');
      const senha = prompt('Senha:');
      if (login && senha && await fazerLogin(login, senha)) {
        renderUserBar();
        showToast('Logado como ' + usuarioAtual.nome, 'sucesso');
        if (usuarioAtual.primeiroLogin) {
          renderTrocaSenhaPopup();
        }
      } else {
        showToast('Login ou senha inválidos.', 'erro');
      }
    };
  } else {
    nomeEl.textContent = usuarioAtual.nome + ' (' + usuarioAtual.perfil + ')';
    btn.textContent = 'Sair';
    btn.onclick = fazerLogout;
  }
}

// ============================ CRM ============================
const formCrm = document.getElementById('form-crm');
const tbodyCrm = document.querySelector('#tabela-clientes tbody');

function renderClientes() {
  const clientes = getClientes();
  tbodyCrm.innerHTML = '';
  clientes.forEach((c) => {
    const tr = document.createElement('tr');
    const etiquetasHtml = (c.etiquetas || []).map(tag => `<span style="background:#1e425c;color:#25d366;padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-right:4px;display:inline-block;">${escapeHtml(tag)}</span>`).join('');
    const ultimaHtml = c.ultimaInteracao ? new Date(c.ultimaInteracao).toLocaleDateString('pt-BR') : '-';
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.nome)}</strong></td>
      <td>${escapeHtml(c.telefone)}</td>
      <td>${escapeHtml(c.empresa || '-')}</td>
      <td>${escapeHtml(c.cidade || '-')}</td>
      <td>${etiquetasHtml || '<span style="color:#6b7a8a">-</span>'}</td>
      <td>${ultimaHtml}</td>
      <td><button type="button" data-excluir="${c.id}" style="background:#dc3545;border:none;color:#fff;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Excluir</button></td>
    `;
    tbodyCrm.appendChild(tr);
  });
  aplicarFiltroTabela('filtro-clientes', 'tabela-clientes');
  const select = document.querySelector('#form-disparo select[name="contato"]');
  if (select) {
    select.innerHTML = '<option value="">Escolha um cliente...</option>';
    clientes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.telefone;
      opt.textContent = `${c.nome} — ${c.telefone}`;
      select.appendChild(opt);
    });
  }
}

formCrm?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(formCrm);
  const nome = fd.get('nome');
  const telefone = fd.get('telefone');
  if (!telefoneValido(telefone)) {
    showToast('Telefone inválido. Use formato com DDD (ex: 5511999999999).', 'erro');
    return;
  }
  const etiquetasRaw = String(fd.get('etiquetas') || '');
  const etiquetas = etiquetasRaw ? etiquetasRaw.split(',').map(e => e.trim()).filter(e => e) : [];
  const dados = {
    id: gerarId(),
    nome: escapeHtml(String(nome)),
    telefone: String(telefone).replace(/\D/g, ''),
    empresa: escapeHtml(String(fd.get('empresa') || '')),
    cidade: escapeHtml(String(fd.get('cidade') || '')),
    etiquetas: etiquetas,
    observacoes: escapeHtml(String(fd.get('observacoes') || '')),
    ultimaInteracao: new Date().toISOString()
  };
  const clientes = getClientes();
  clientes.push(dados);
  setClientes(clientes);
  logAcao('crm_cadastro', dados.nome);
  formCrm.reset();
  renderClientes();
  showToast(`Cliente ${dados.nome} cadastrado com sucesso!`, 'sucesso');
});

function clienteTemDependencias(telefone) {
  const funil = lista(FUNIL_KEY);
  const disparos = lista(DISPAROS_KEY);
  const catalogo = lista(CATALOGO_KEY);
  const telNorm = String(telefone).replace(/\D/g, '');

  if (funil.some(f => String(f.telefone).replace(/\D/g, '') === telNorm)) return 'Funil de Vendas';
  if (disparos.some(d => String(d.numero).replace(/\D/g, '') === telNorm)) return 'Disparos';
  if (catalogo.some(c => String(c.telefone || '').replace(/\D/g, '') === telNorm)) return 'Catálogo';
  return null;
}

tbodyCrm?.addEventListener('click', e => {
  const btn = e.target.closest('[data-excluir]');
  if (!btn) return;
  const id = btn.dataset.excluir;
  const clientes = getClientes();
  const idx = clientes.findIndex(c => c.id === id);
  if (idx === -1) return;
  const removido = clientes[idx].nome;
  const dep = clienteTemDependencias(clientes[idx].telefone);
  if (dep) {
    showToast(`Não é possível excluir "${removido}": existem registros vinculados em ${dep}.`, 'erro');
    return;
  }
  if (!confirm(`Tem certeza que deseja excluir "${removido}"?`)) return;
  clientes.splice(idx, 1);
  setClientes(clientes);
  logAcao('crm_exclusao', removido);
  renderClientes();
  showToast(`Cliente ${removido} removido.`, 'sucesso');
});

// ============================ DISPAROS ============================
const formDisparo = document.getElementById('form-disparo');
const avisoDisparo = document.getElementById('msg-disparo');

function interpolar(msg, contato) {
  return msg
    .replace(/{nome}/g, contato.nome || '')
    .replace(/{empresa}/g, contato.empresa || '')
    .replace(/{cidade}/g, contato.cidade || '');
}

function jaEnviado(numero) {
  const cfg = getConfig();
  if (cfg.antiDuplicidade !== 'sim') return false;
  const historico = lista(DISPAROS_KEY);
  return historico.some(h => h.numero === numero);
}

function registrarDisparo(numero, mensagem) {
  const itens = lista(DISPAROS_KEY);
  itens.push({ numero, mensagem, data: new Date().toISOString() });
  salva(DISPAROS_KEY, itens);
}

function aplicarAtalho(texto) {
  const respostas = lista(RESPOSTAS_KEY);
  let resultado = texto;
  for (const r of respostas) {
    resultado = resultado.replace(new RegExp(`\\b${r.atalho}\\b`, 'g'), r.texto);
  }
  return resultado;
}

formDisparo?.addEventListener('submit', async e => {
  e.preventDefault();
  const contatoTel = formDisparo.contato.value;
  const numeroInput = formDisparo.numero.value.replace(/\D/g, '');
  let mensagem = aplicarAtalho(formDisparo.mensagem.value.trim());

  if (!numeroInput) {
    if (avisoDisparo) avisoDisparo.textContent = 'Informe o número.';
    return;
  }
  if (!telefoneValido(numeroInput)) {
    if (avisoDisparo) avisoDisparo.textContent = 'Telefone inválido. Use formato: 5511999999999';
    return;
  }
  if (jaEnviado(numeroInput)) {
    if (avisoDisparo) avisoDisparo.textContent = 'Anti-duplicidade: já enviado para este contato.';
    return;
  }

  let numero = numeroInput;
  let contato = null;
  if (contatoTel) {
    const clientes = getClientes();
    contato = clientes.find(c => c.telefone === contatoTel);
    if (contato) {
      numero = contato.telefone;
      mensagem = interpolar(mensagem, contato);
    }
  }

  registrarDisparo(numero, mensagem);
  logAcao('disparo', numero);

  const url = `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;
  chrome.tabs.create({ url });
  if (avisoDisparo) avisoDisparo.textContent = 'Disparo registrado e WhatsApp Web aberto!';
  formDisparo.reset();
  showToast('Disparo registrado com sucesso!', 'sucesso');
});

// ============================ CAPTADOR ============================
const btnExtrair = document.getElementById('btn-extrair');
const listaNumeros = document.getElementById('lista-numeros');
const btnSalvarNumeros = document.getElementById('btn-salvar-numeros');
const msgCaptador = document.getElementById('msg-captador');

let numerosExtraidos = [];

btnExtrair?.addEventListener('click', async () => {
  const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!abas.length) {
    if (msgCaptador) msgCaptador.textContent = 'Abra o WhatsApp Web em uma aba primeiro.';
    showToast('Abra web.whatsapp.com primeiro.', 'erro');
    return;
  }
  try {
    const resp = await chrome.tabs.sendMessage(abas[0].id, { action: 'extrairNumeros' });
    numerosExtraidos = (resp && resp.numeros) || [];
    if (listaNumeros) {
      listaNumeros.innerHTML = numerosExtraidos.map(n => `<div class="chip">${n}</div>`).join('') || '<span style="color:#9fb3c8">Nenhum número visível encontrado na tela.</span>';
    }
    if (msgCaptador) msgCaptador.textContent = `${numerosExtraidos.length} número(s) extraído(s).`;
  } catch (err) {
    if (msgCaptador) msgCaptador.textContent = 'Recarregue a aba do WhatsApp Web para ativar o leitor.';
    showToast('Recarregue o WhatsApp Web para capturar.', 'erro');
  }
});

btnSalvarNumeros?.addEventListener('click', () => {
  if (!numerosExtraidos.length) {
    if (msgCaptador) msgCaptador.textContent = 'Extraia números primeiro.';
    return;
  }
  const clientes = getClientes();
  let adicionados = 0;
  for (const n of numerosExtraidos) {
    if (!clientes.some(c => c.telefone === n)) {
      clientes.push({
        id: gerarId(),
        nome: n,
        telefone: n,
        empresa: '',
        cidade: '',
        observacoes: 'Captado via ZapFlow',
        ultimaInteracao: new Date().toISOString()
      });
      adicionados++;
    }
  }
  setClientes(clientes);
  logAcao('captador_salvou', `${adicionados} contatos`);
  if (msgCaptador) msgCaptador.textContent = `${adicionados} contato(s) salvo(s) no CRM.`;
  showToast(`${adicionados} contatos adicionados ao CRM!`, 'sucesso');
  numerosExtraidos = [];
  if (listaNumeros) listaNumeros.innerHTML = '';
  renderClientes();
});

// ============================ FUNIL ============================
const formFunil = document.getElementById('form-funil');

formFunil?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(formFunil);
  const telefone = fd.get('telefone');
  if (!telefoneValido(telefone)) {
    showToast('Telefone inválido. Use formato com DDD (ex: 5511999999999).', 'erro');
    return;
  }
  const dados = {
    id: gerarId(),
    nome: escapeHtml(String(fd.get('nome'))),
    telefone: String(telefone).replace(/\D/g, ''),
    etapa: String(fd.get('etapa')),
    temperatura: String(fd.get('temperatura')),
    dataCriacao: new Date().toISOString(),
    ultimaInteracao: new Date().toISOString()
  };
  const itens = lista(FUNIL_KEY);
  itens.push(dados);
  salva(FUNIL_KEY, itens);
  logAcao('funil_lead', dados.nome);
  formFunil.reset();
  renderFunilTabela();
  showToast(`Lead ${dados.nome} adicionado ao Funil!`, 'sucesso');
});

function renderFunilTabela() {
  renderTabela('funil', item => `
    <td><strong>${escapeHtml(item.nome)}</strong></td>
    <td>${escapeHtml(item.telefone)}</td>
    <td><span style="background:#122635;border:1px solid #1e425c;padding:3px 8px;border-radius:4px;font-size:0.8rem;">${escapeHtml(item.etapa)}</span></td>
    <td><span style="color:${item.temperatura === 'quente' ? '#dc3545' : item.temperatura === 'morno' ? '#ffc107' : '#6c757d'};font-weight:600;">${escapeHtml(item.temperatura)}</span></td>
    <td><button type="button" data-excluir="${item.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Excluir</button></td>
  `);
  aplicarFiltroTabela('filtro-funil', 'tabela-funil');
  atualizarAlertaLeadsSemResposta();
}

function atualizarAlertaLeadsSemResposta() {
  const funil = lista(FUNIL_KEY);
  const hoje = new Date();
  const leadsSemResposta = funil.filter(f => {
    const criado = new Date(f.dataCriacao || f.ultimaInteracao || Date.now());
    const diffDias = Math.floor((hoje - criado) / (1000 * 60 * 60 * 24));
    return diffDias >= 3 && !f.respondido;
  }).length;

  const elAvisoFunil = document.getElementById('zf-leads-sem-resposta');
  if (elAvisoFunil) elAvisoFunil.textContent = `${leadsSemResposta} leads`;
  const elAvisoDash = document.getElementById('d-leads-sem-resposta');
  if (elAvisoDash) elAvisoDash.textContent = leadsSemResposta;
}

document.querySelector('#tabela-funil tbody')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-excluir]');
  if (!btn) return;
  const id = btn.dataset.excluir;
  const itens = lista(FUNIL_KEY);
  const idx = itens.findIndex(x => x.id === id);
  if (idx === -1) return;
  const removido = itens[idx].nome;
  itens.splice(idx, 1);
  salva(FUNIL_KEY, itens);
  logAcao('exclusao_funil', removido);
  renderFunilTabela();
  showToast(`Lead ${removido} removido.`, 'sucesso');
});

document.getElementById('zf-btn-seguir-up')?.addEventListener('click', () => {
  navegarParaModulo('ia');
  const btnFollowup = document.querySelector('.btn-ia[data-acao="followup"]');
  if (btnFollowup) btnFollowup.click();
});

// ============================ CATÁLOGO ============================
const formCatalogo = document.getElementById('form-catalogo');

formCatalogo?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(formCatalogo);
  const dados = {
    id: gerarId(),
    produto: escapeHtml(String(fd.get('produto'))),
    preco: escapeHtml(String(fd.get('preco'))),
    arquivo: escapeHtml(String(fd.get('arquivo') || ''))
  };
  const itens = lista(CATALOGO_KEY);
  itens.push(dados);
  salva(CATALOGO_KEY, itens);
  logAcao('catalogo_cadastro', dados.produto);
  formCatalogo.reset();
  renderCatalogoTabela();
  showToast(`Produto ${dados.produto} cadastrado!`, 'sucesso');
});

function renderCatalogoTabela() {
  renderTabela('catalogo', item => `
    <td><strong>${escapeHtml(item.produto)}</strong></td>
    <td style="color:#25d366;font-weight:600;">${escapeHtml(item.preco)}</td>
    <td>${item.arquivo ? `<a href="${item.arquivo}" target="_blank" style="color:#25d366;text-decoration:none;">Visualizar</a>` : '-'}</td>
    <td><button type="button" data-excluir="${item.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Excluir</button></td>
  `);
  aplicarFiltroTabela('filtro-catalogo', 'tabela-catalogo');
}

document.querySelector('#tabela-catalogo tbody')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-excluir]');
  if (!btn) return;
  const id = btn.dataset.excluir;
  const itens = lista(CATALOGO_KEY);
  const idx = itens.findIndex(x => x.id === id);
  if (idx === -1) return;
  const removido = itens[idx].produto;
  itens.splice(idx, 1);
  salva(CATALOGO_KEY, itens);
  logAcao('exclusao_catalogo', removido);
  renderCatalogoTabela();
  showToast(`Produto ${removido} removido.`, 'sucesso');
});

// ============================ RESPOSTAS RÁPIDAS ============================
const formResposta = document.getElementById('form-resposta');

formResposta?.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(formResposta);
  let atalho = String(fd.get('atalho')).trim();
  if (!atalho.startsWith('/')) atalho = '/' + atalho;
  const dados = {
    id: gerarId(),
    atalho: escapeHtml(atalho),
    texto: escapeHtml(String(fd.get('texto')))
  };
  const itens = lista(RESPOSTAS_KEY);
  itens.push(dados);
  salva(RESPOSTAS_KEY, itens);
  logAcao('resposta_cadastro', dados.atalho);
  formResposta.reset();
  renderRespostasTabela();
  showToast(`Atalho ${dados.atalho} cadastrado!`, 'sucesso');
});

function renderRespostasTabela() {
  renderTabela('respostas', item => `
    <td><code style="color:#25d366;background:#122635;padding:3px 6px;border-radius:4px;">${escapeHtml(item.atalho)}</code></td>
    <td>${escapeHtml(item.texto)}</td>
    <td><button type="button" data-excluir="${item.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Excluir</button></td>
  `);
  aplicarFiltroTabela('filtro-respostas', 'tabela-respostas');
}

document.querySelector('#tabela-respostas tbody')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-excluir]');
  if (!btn) return;
  const id = btn.dataset.excluir;
  const itens = lista(RESPOSTAS_KEY);
  const idx = itens.findIndex(x => x.id === id);
  if (idx === -1) return;
  const removido = itens[idx].atalho;
  itens.splice(idx, 1);
  salva(RESPOSTAS_KEY, itens);
  logAcao('exclusao_respostas', removido);
  renderRespostasTabela();
  showToast(`Atalho ${removido} removido.`, 'sucesso');
});

// ============================ GRAFO (REDE DE CLIENTES & FUNIL) ============================
function renderGrafoPopup() {
  const container = document.getElementById('grafo-container');
  const msgEl = document.getElementById('msg-grafo');
  if (!container || typeof Graphify === 'undefined') return;

  const clientes = getClientes();
  const funil = lista(FUNIL_KEY);

  const nodes = [];
  const edges = [];

  clientes.forEach((c, i) => {
    const id = c.id || 'c_' + i;
    nodes.push({ id, label: c.nome || 'Cliente', color: c.cidade ? '#25d366' : '#1e425c' });
  });

  funil.forEach((l, i) => {
    const id = l.id || 'l_' + i;
    const cor = l.temperatura === 'quente' ? '#dc3545' : l.temperatura === 'morno' ? '#ffc107' : '#6c757d';
    nodes.push({ id, label: (l.nome || 'Lead') + ' (' + (l.temperatura || 'frio') + ')', color: cor });
  });

  clientes.forEach(c => {
    funil.forEach(l => {
      const telC = String(c.telefone || '').replace(/\D/g, '');
      const telL = String(l.telefone || '').replace(/\D/g, '');
      if (telC && telL && telC === telL) {
        edges.push({ from: c.id, to: l.id });
      }
    });
  });

  if (edges.length === 0 && nodes.length > 1) {
    for (let i = 0; i < Math.min(nodes.length - 1, 8); i++) {
      edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
    }
  }

  container.innerHTML = '';
  const g = new Graphify(container, { nodes, edges });
  g.layout();
  g.render();

  if (msgEl) {
    msgEl.textContent = `${nodes.length} nós e ${edges.length} ligações mapeadas no gráfico.`;
  }
}

// ============================ VERIFICADOR DE NÚMEROS ============================
function salvarVerificacao(numero, valido, whatsapp) {
  const historico = lista(VERIFICADOR_KEY);
  historico.push({
    id: gerarId(),
    numero,
    valido,
    whatsapp,
    data: new Date().toISOString()
  });
  salva(VERIFICADOR_KEY, historico);
  return historico;
}

function renderEstatisticasVerificador() {
  const historico = lista(VERIFICADOR_KEY);
  const total = historico.length;
  const validos = historico.filter(h => h.valido).length;
  const invalidos = total - validos;
  const whatsapp = historico.filter(h => h.whatsapp).length;

  const elTotal = document.getElementById('v-total');
  const elValidos = document.getElementById('v-validos');
  const elInvalidos = document.getElementById('v-invalidos');
  const elWhatsapp = document.getElementById('v-whatsapp');

  if (elTotal) elTotal.textContent = total;
  if (elValidos) elValidos.textContent = validos;
  if (elInvalidos) elInvalidos.textContent = invalidos;
  if (elWhatsapp) elWhatsapp.textContent = whatsapp;
}

async function verificarWhatsApp(numero) {
  const url = `https://web.whatsapp.com/send?phone=${numero}&text=teste`;
  try {
    const aba = await chrome.tabs.create({ url, active: false });
    return { url, abaId: aba.id };
  } catch (e) {
    return { url, erro: e.message };
  }
}

const formVerificador = document.getElementById('form-verificador');
const msgVerificador = document.getElementById('msg-verificador');

formVerificador?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(formVerificador);
  const numeroRaw = String(fd.get('numero') || '').replace(/\D/g, '');

  if (!numeroRaw) {
    if (msgVerificador) msgVerificador.textContent = 'Informe o número.';
    return;
  }

  const valido = telefoneValido(numeroRaw);
  if (msgVerificador) {
    msgVerificador.textContent = valido
      ? `Formato válido (${numeroRaw}). Verificando WhatsApp...`
      : `Formato inválido. Use DDI + DDD + número (ex: 5511999999999).`;
  }

  let whatsapp = false;
  if (valido) {
    const resultado = await verificarWhatsApp(numeroRaw);
    whatsapp = !!resultado.abaId;
    if (msgVerificador) {
      msgVerificador.textContent = `Número ${numeroRaw} verificado. Status: ${whatsapp ? 'Aberto no WhatsApp' : 'Formato válido'}.`;
    }
  }

  salvarVerificacao(numeroRaw, valido, whatsapp);
  renderEstatisticasVerificador();
  formVerificador.reset();
});

// ============================ CONFIGURAÇÕES ============================
const formConfig = document.getElementById('form-config');
const msgConfig = document.getElementById('msg-config');

function carregarValoresConfig() {
  if (!formConfig) return;
  const cfg = getConfig();
  if (formConfig.intervalo) formConfig.intervalo.value = cfg.intervalo || 5;
  if (formConfig.limite) formConfig.limite.value = cfg.limite || 60;
  if (formConfig.antiDuplicidade) formConfig.antiDuplicidade.value = cfg.antiDuplicidade || 'sim';
  if (formConfig.apiKeyIA) formConfig.apiKeyIA.value = cfg.apiKeyIA || '';
  if (formConfig.modeloIA) formConfig.modeloIA.value = cfg.modeloIA || 'gpt-3.5-turbo';
  const chkAba = document.getElementById('cfg-abrirEmAbaCheia');
  if (chkAba) chkAba.checked = !!cfg.abrirEmAbaCheia;
}

formConfig?.addEventListener('submit', async e => {
  e.preventDefault();
  const apiKeyRaw = formConfig.apiKeyIA.value.trim();
  const senhaMestra = formConfig.senhaMestra ? formConfig.senhaMestra.value.trim() : '';
  const chkAba = document.getElementById('cfg-abrirEmAbaCheia');

  let apiKeyParaSalvar = apiKeyRaw;
  if (apiKeyRaw && senhaMestra) {
    try {
      apiKeyParaSalvar = await criptografarTexto(apiKeyRaw, senhaMestra);
    } catch (err) {
      if (msgConfig) msgConfig.textContent = 'Erro ao criptografar a chave da IA.';
      return;
    }
  }

  const nova = {
    intervalo: parseInt(formConfig.intervalo.value) || 5,
    limite: parseInt(formConfig.limite.value) || 60,
    antiDuplicidade: formConfig.antiDuplicidade.value,
    apiKeyIA: apiKeyParaSalvar,
    modeloIA: formConfig.modeloIA.value.trim() || 'gpt-3.5-turbo',
    senhaMestraConfigurada: !!senhaMestra,
    abrirEmAbaCheia: !!(chkAba && chkAba.checked),
    _versao: '1.4.8'
  };
  salva(CFG_KEY, nova);
  if (msgConfig) {
    msgConfig.textContent = senhaMestra ? 'Configurações salvas. Chave da IA criptografada.' : 'Configurações salvas com sucesso!';
    setTimeout(() => { if (msgConfig) msgConfig.textContent = ''; }, 3000);
  }
  showToast('Configurações salvas!', 'sucesso');
});

// ============================ RELATÓRIOS (CSV) ============================
function exportarCSV(nomeArquivo, linhas) {
  if (!linhas || !linhas.length) { showToast('Sem dados para exportar.', 'erro'); return; }
  const cabecalho = Object.keys(linhas[0]).join(',') + '\n';
  const corpo = linhas.map(l => Object.values(l).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([cabecalho + corpo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Relatório ${nomeArquivo} exportado!`, 'sucesso');
}

document.getElementById('btn-export-clientes')?.addEventListener('click', () => {
  exportarCSV('zapflow_clientes.csv', getClientes());
});
document.getElementById('btn-export-funil')?.addEventListener('click', () => {
  exportarCSV('zapflow_funil.csv', lista(FUNIL_KEY));
});
document.getElementById('btn-export-catalogo')?.addEventListener('click', () => {
  exportarCSV('zapflow_catalogo.csv', lista(CATALOGO_KEY));
});

// ============================ FILTRO DE TABELA ============================
function aplicarFiltroTabela(inputId, tbodyId) {
  const input = document.getElementById(inputId);
  const tbody = document.getElementById(tbodyId);
  if (!input || !tbody) return;
  input.addEventListener('input', () => {
    const termo = input.value.toLowerCase();
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const texto = row.textContent.toLowerCase();
      row.style.display = texto.includes(termo) ? '' : 'none';
    });
  });
}

// ============================ TOAST (NOTIFICAÇÃO) ============================
function showToast(mensagem, tipo = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    padding: 12px 20px;
    background: ${tipo === 'sucesso' ? '#25d366' : tipo === 'erro' ? '#dc3545' : '#1e425c'};
    color: ${tipo === 'sucesso' || tipo === 'erro' ? '#0b141a' : '#eaeaea'};
    border-radius: 8px;
    font-size: 0.88rem;
    font-weight: 700;
    z-index: 10000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `;
  toast.textContent = mensagem;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ============================ MIGRAÇÃO DE ESQUEMA ============================
const SCHEMA_VERSION_ATUAL = 1;

function migrarEsquema() {
  const versaoSalva = parseInt(localStorage.getItem('zapflow_schema_version') || '0', 10);
  if (versaoSalva >= SCHEMA_VERSION_ATUAL) return;

  let mudou = false;
  const clientes = getClientes();
  clientes.forEach(c => {
    if (!c.id) { c.id = gerarId(); mudou = true; }
    if (!c.etiquetas) { c.etiquetas = []; mudou = true; }
  });
  if (mudou) setClientes(clientes);

  const funil = lista(FUNIL_KEY);
  funil.forEach(f => { if (!f.id) { f.id = gerarId(); mudou = true; } });
  if (mudou) salva(FUNIL_KEY, funil);

  const catalogo = lista(CATALOGO_KEY);
  catalogo.forEach(c => { if (!c.id) { c.id = gerarId(); mudou = true; } });
  if (mudou) salva(CATALOGO_KEY, catalogo);

  const respostas = lista(RESPOSTAS_KEY);
  respostas.forEach(r => { if (!r.id) { r.id = gerarId(); mudou = true; } });
  if (mudou) salva(RESPOSTAS_KEY, respostas);

  const usuarios = getUsuarios();
  usuarios.forEach(u => {
    if (!u.id) { u.id = gerarId(); mudou = true; }
    if (u.primeiroLogin === undefined) u.primeiroLogin = false;
  });
  if (mudou) setUsuarios(usuarios);

  localStorage.setItem('zapflow_schema_version', String(SCHEMA_VERSION_ATUAL));
}

// ============================ BACKUP / RESTAURAÇÃO ============================
const CHAVES_BACKUP = [STORAGE_KEY, FUNIL_KEY, CATALOGO_KEY, RESPOSTAS_KEY, DISPAROS_KEY, USERS_KEY, HISTORY_KEY, CFG_KEY, VERIFICADOR_KEY];

const btnExportBackup = document.getElementById('btn-export-backup');
const btnImportBackup = document.getElementById('btn-import-backup');
const inputImportBackup = document.getElementById('input-import-backup');
const msgBackup = document.getElementById('msg-backup');

btnExportBackup?.addEventListener('click', () => {
  const backup = {};
  let totalItens = 0;
  for (const chave of CHAVES_BACKUP) {
    const valor = localStorage.getItem(chave);
    if (valor) {
      try {
        const itens = JSON.parse(valor);
        backup[chave] = itens;
        totalItens += Array.isArray(itens) ? itens.length : 1;
      } catch {
        backup[chave] = valor;
      }
    }
  }
  backup._exportadoEm = new Date().toISOString();
  backup._versao = '1.4.8';

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zapflow_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  if (msgBackup) msgBackup.textContent = `Backup exportado com ${totalItens} registros.`;
  showToast('Backup exportado com sucesso!', 'sucesso');
});

btnImportBackup?.addEventListener('click', () => {
  inputImportBackup?.click();
});

inputImportBackup?.addEventListener('change', async e => {
  const arquivo = e.target.files[0];
  if (!arquivo) return;

  const texto = await arquivo.text();
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (err) {
    if (msgBackup) msgBackup.textContent = 'Arquivo inválido. Não é um arquivo JSON.';
    showToast('Arquivo de backup inválido.', 'erro');
    return;
  }

  if (!confirm('Isso substituirá todos os dados atuais (clientes, funil, catálogo, etc.). Deseja continuar?')) {
    return;
  }

  let restaurados = 0;
  for (const chave of CHAVES_BACKUP) {
    if (dados[chave] !== undefined) {
      salvarItemSincronizado(chave, dados[chave]);
      restaurados++;
    }
  }

  if (msgBackup) msgBackup.textContent = `Backup restaurado: ${restaurados} seções restauradas. Recarregando...`;
  showToast('Backup restaurado! Recarregando página...', 'sucesso');
  setTimeout(() => location.reload(), 1200);
});

const btnLimparTudo = document.getElementById('btn-limpar-tudo');
btnLimparTudo?.addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja apagar TODOS os dados? Esta ação não pode ser desfeita.')) return;
  if (!confirm('CONFIRMAÇÃO FINAL: Todos os clientes, leads, catálogo e configurações serão excluídos.')) return;

  for (const chave of CHAVES_BACKUP) {
    localStorage.removeItem(chave);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(chave).catch(() => {});
    }
  }
  localStorage.removeItem('zapflow_schema_version');
  localStorage.removeItem(SESSION_KEY);
  usuarioAtual = null;

  showToast('Todos os dados foram apagados. Recarregando...', 'erro');
  setTimeout(() => location.reload(), 1200);
});

// ============================ IA INTEGRADA ============================
const btnsIA = document.querySelectorAll('.btn-ia');
const textoIA = document.getElementById('texto-ia');
const contextoIA = document.getElementById('contexto-ia');
const resultadoIA = document.getElementById('resultado-ia');
const msgIA = document.getElementById('msg-ia');

const PROMPTS = {
  corrigir: 'Corrija apenas erros de português deste texto, mantendo o tom e o significado. Não adicione saudações extras. Texto: "{texto}"',
  reescrever: 'Reescreva este texto de forma mais profissional e clara, mantendo o significado original. Texto: "{texto}"',
  traduzir: 'Traduza este texto para o português do Brasil de forma natural. Texto: "{texto}"',
  responder: 'Você é um atendente de WhatsApp. Gere uma resposta curta, amigável e objetiva para a mensagem do cliente abaixo. Cliente se chama "{contexto}". Mensagem: "{texto}"',
  resumir: 'Resuma esta conversa em até 3 bullet points, destacando o que o cliente quer e os próximos passos. Conversa: "{texto}"',
  followup: 'Você é um atendente de WhatsApp. Gere uma mensagem amigável de follow-up para um lead que parou de responder. Seja educado, pergunte se ainda precisa de ajuda e sugira o próximo passo. Nome do lead: "{contexto}".'
};

async function chamarIA(acao, texto, contexto) {
  const cfg = getConfig();
  if (!cfg.apiKeyIA) throw new Error('Configure a chave de API da IA no menu Configurações.');

  let apiKey = cfg.apiKeyIA;
  if (cfg.senhaMestraConfigurada && apiKey.includes(':')) {
    const senhaMestra = prompt('Digite sua senha mestra para descriptografar a chave da IA:');
    if (!senhaMestra) throw new Error('Senha mestra não informada.');
    try {
      apiKey = await descriptografarTexto(apiKey, senhaMestra);
    } catch (err) {
      throw new Error('Senha mestra incorreta.');
    }
  }

  const prompt = (PROMPTS[acao] || PROMPTS.responder)
    .replace('{texto}', texto)
    .replace('{contexto}', contexto || 'cliente');

  // CORREÇÃO CRÍTICA: Enviar 'apiKey' descriptografada e não a string cifrada
  const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: cfg.modeloIA || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500
    })
  });
  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`Erro IA (${resposta.status}): ${erro}`);
  }
  const dados = await resposta.json();
  return dados.choices[0].message.content.trim();
}

btnsIA.forEach(btn => {
  btn.addEventListener('click', async () => {
    const acao = btn.dataset.acao;
    const texto = textoIA ? textoIA.value.trim() : '';
    if (!texto && acao !== 'followup') {
      if (msgIA) msgIA.textContent = 'Cole um texto ou mensagem primeiro.';
      showToast('Digite ou cole um texto primeiro.', 'erro');
      return;
    }
    if (msgIA) msgIA.textContent = 'Processando com IA... Aguarde.';
    if (resultadoIA) resultadoIA.textContent = 'Carregando...';
    try {
      const contexto = contextoIA ? contextoIA.value.trim() : '';
      const resultado = await chamarIA(acao, texto, contexto);
      if (resultadoIA) resultadoIA.textContent = resultado;
      if (msgIA) msgIA.textContent = 'Pronto!';
      showToast('Resposta da IA gerada!', 'sucesso');
    } catch (e) {
      if (msgIA) msgIA.textContent = e.message;
      if (resultadoIA) resultadoIA.textContent = '';
      showToast(e.message, 'erro');
    }
  });
});

resultadoIA?.addEventListener('dblclick', () => {
  const txt = resultadoIA.textContent;
  if (!txt) return;
  navigator.clipboard.writeText(txt);
  showToast('Copiado para a área de transferência!', 'sucesso');
});

// ============================ CONEXÃO WHATSAPP (QR CODE) ============================
const btnGerarQR = document.getElementById('btn-gerar-qr');
const btnAbrirWhatsApp = document.getElementById('btn-abrir-whatsapp');
const qrImg = document.getElementById('qr-img');
const qrStatus = document.getElementById('qr-status');
const msgConexao = document.getElementById('msg-conexao');

btnGerarQR?.addEventListener('click', () => {
  const dados = 'ZAPFLOW_CONNECT_' + Date.now();
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(dados)}`;
  if (qrStatus) qrStatus.textContent = 'QR Code gerado. Escaneie com o WhatsApp do celular.';
  if (msgConexao) msgConexao.textContent = '';
});

btnAbrirWhatsApp?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://web.whatsapp.com' });
  if (msgConexao) msgConexao.textContent = 'WhatsApp Web aberto. O painel ZF aparecerá automaticamente.';
});

// ============================ GENÉRICO TABELAS ============================
function renderTabela(key, montarLinha) {
  const tbody = document.querySelector(`#tabela-${key} tbody`);
  if (!tbody) return;
  const itens = lista(key);
  tbody.innerHTML = '';
  itens.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = montarLinha(item);
    tbody.appendChild(tr);
  });
}

// ============================ CARREGAR MÓDULO ============================
function carregarModulo(modulo) {
  localStorage.setItem('zapflow_modulo_ultimo', modulo);

  if (modulo === 'dashboard') {
    const clientes = getClientes();
    const leads = lista(FUNIL_KEY);
    const disparos = lista(DISPAROS_KEY);

    const elTotalCli = document.getElementById('d-total-clientes');
    const elTotalLeads = document.getElementById('d-total-leads');
    const elTotalDisp = document.getElementById('d-total-disparos');
    const elConexao = document.getElementById('d-conexao');

    if (elTotalCli) elTotalCli.textContent = clientes.length;
    if (elTotalLeads) elTotalLeads.textContent = leads.length;
    if (elTotalDisp) elTotalDisp.textContent = disparos.length;
    if (elConexao) {
      elConexao.textContent = usuarioAtual ? 'Online' : 'Desconectado';
      elConexao.style.color = usuarioAtual ? '#25d366' : '#9fb3c8';
    }

    atualizarAlertaLeadsSemResposta();
  }

  if (modulo === 'crm') renderClientes();
  if (modulo === 'funil') renderFunilTabela();
  if (modulo === 'catalogo') renderCatalogoTabela();
  if (modulo === 'respostas') renderRespostasTabela();
  if (modulo === 'grafo') renderGrafoPopup();
  if (modulo === 'config') carregarValoresConfig();
  if (modulo === 'verificador') renderEstatisticasVerificador();
  if (modulo === 'equipe') {
    renderUsuarios();
    renderHistorico();
    renderRelatorioEq();
  }
}

// ============================ GESTÃO DE EQUIPE ============================
const formOperador = document.getElementById('form-operador');
const tbodyOp = document.querySelector('#tabela-operadores tbody');

function renderUsuarios() {
  if (!tbodyOp) return;
  const usuarios = getUsuarios();
  tbodyOp.innerHTML = '';
  usuarios.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(u.nome)}</strong></td>
      <td>${escapeHtml(u.login)}</td>
      <td><span style="background:#122635;border:1px solid #1e425c;padding:2px 8px;border-radius:4px;font-size:0.8rem;">${escapeHtml(u.perfil)}</span></td>
      <td>${ehAdmin() ? `<button type="button" data-excluir="${u.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;">Excluir</button>` : '-'}</td>
    `;
    tbodyOp.appendChild(tr);
  });
  aplicarFiltroTabela('filtro-operadores', 'tabela-operadores');
}

formOperador?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!ehAdmin()) { showToast('Apenas administradores podem cadastrar operadores.', 'erro'); return; }
  const fd = new FormData(formOperador);
  const login = String(fd.get('login')).trim();
  const senha = String(fd.get('senha'));
  const usuarios = getUsuarios();
  if (usuarios.some(u => u.login === login)) { showToast('Este login já está cadastrado.', 'erro'); return; }
  const senhaHash = await hashSenha(senha);
  const dados = {
    id: gerarId(),
    nome: escapeHtml(String(fd.get('nome'))),
    login: login,
    senha: senhaHash,
    perfil: String(fd.get('perfil'))
  };
  usuarios.push(dados);
  setUsuarios(usuarios);
  logAcao('cadastro_operador', dados.login);
  formOperador.reset();
  renderUsuarios();
  renderHistorico();
  renderRelatorioEq();
  showToast(`Operador ${dados.nome} cadastrado!`, 'sucesso');
});

tbodyOp?.addEventListener('click', e => {
  const btn = e.target.closest('[data-excluir]');
  if (!btn) return;
  const id = btn.dataset.excluir;
  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.id === id);
  if (idx === -1) return;
  const removido = usuarios[idx].login;
  usuarios.splice(idx, 1);
  setUsuarios(usuarios);
  logAcao('exclusao_operador', removido);
  renderUsuarios();
  renderHistorico();
  renderRelatorioEq();
  showToast(`Operador ${removido} removido.`, 'sucesso');
});

function renderHistorico() {
  const el = document.getElementById('lista-historico');
  if (!el) return;
  const h = getHistorico().slice(0, 30);
  el.innerHTML = h.map(item => `
    <div style="padding:6px 0;border-bottom:1px solid #1e425c;">
      <strong style="color:#25d366">${escapeHtml(item.usuario)}</strong> — ${escapeHtml(item.acao)} ${item.detalhe ? '(' + escapeHtml(item.detalhe) + ')' : ''}
      <span style="color:#6b7a8a;font-size:0.75rem;float:right">${new Date(item.data).toLocaleString('pt-BR')}</span>
    </div>
  `).join('') || '<span style="color:#6b7a8a">Sem histórico recente.</span>';
}

function renderRelatorioEq() {
  const tbody = document.querySelector('#tabela-relatorio-eq tbody');
  if (!tbody) return;
  const usuarios = getUsuarios();
  const historico = getHistorico();
  const contagem = {};
  usuarios.forEach(u => { contagem[u.login] = { nome: u.nome, total: 0, ultima: null }; });
  historico.forEach(item => {
    if (contagem[item.usuario]) {
      contagem[item.usuario].total++;
      if (!contagem[item.usuario].ultima || item.data > contagem[item.usuario].ultima) {
        contagem[item.usuario].ultima = item.data;
      }
    }
  });
  tbody.innerHTML = '';
  for (const login in contagem) {
    const c = contagem[login];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.nome)}</strong> (${escapeHtml(login)})</td>
      <td>${c.total}</td>
      <td>${c.ultima ? new Date(c.ultima).toLocaleString('pt-BR') : '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ============================ ATALHOS DE TECLADO ============================
document.addEventListener('keydown', e => {
  if (!e.ctrlKey) return;
  const modulosArray = ['dashboard', 'conexao', 'crm', 'disparos', 'captador', 'funil', 'catalogo', 'respostas', 'ia'];
  const tecla = e.key;
  if (tecla >= '1' && tecla <= '9') {
    const idx = parseInt(tecla) - 1;
    if (modulosArray[idx]) {
      e.preventDefault();
      navegarParaModulo(modulosArray[idx]);
    }
  } else if (tecla === '0') {
    e.preventDefault();
    navegarParaModulo('verificador');
  }
});

// ============================ TELA DE TROCA DE SENHA (PRIMEIRO ACESSO) ============================
function renderTrocaSenhaPopup() {
  esconderTodos();
  itensMenu.forEach(i => i.classList.remove('active'));

  const contentEl = document.querySelector('.content');
  if (contentEl) {
    contentEl.innerHTML = `
      <div style="max-width:440px;margin:50px auto;padding:28px;background:#0e1a24;border:1px solid #1e425c;border-radius:12px;">
        <h2 style="color:#25d366;margin-bottom:14px">🔒 Primeiro Acesso</h2>
        <p style="color:#9fb3c8;margin-bottom:20px;line-height:1.5;">Por segurança, altere a senha padrão do administrador antes de começar a usar o ZapFlow.</p>
        <form id="form-troca-senha" style="display:flex;flex-direction:column;gap:12px;">
          <label>Nova Senha</label>
          <input type="password" name="novaSenha" class="zf-input" placeholder="Mínimo 6 caracteres" required minlength="6">
          <label>Confirmar Nova Senha</label>
          <input type="password" name="confirmarSenha" class="zf-input" placeholder="Repita a senha" required minlength="6">
          <button type="submit" class="zf-btn-submit">Salvar Nova Senha</button>
        </form>
        <div id="msg-troca-senha" class="aviso" style="margin-top:14px"></div>
      </div>
    `;

    document.getElementById('form-troca-senha')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const novaSenha = fd.get('novaSenha');
      const confirmar = fd.get('confirmarSenha');
      const msg = document.getElementById('msg-troca-senha');

      if (novaSenha !== confirmar) {
        if (msg) { msg.textContent = 'As senhas digitadas não coincidem.'; msg.style.color = '#dc3545'; }
        return;
      }
      if (novaSenha.length < 6) {
        if (msg) { msg.textContent = 'A senha deve conter ao menos 6 caracteres.'; msg.style.color = '#dc3545'; }
        return;
      }

      const usuarios = getUsuarios();
      const adminIdx = usuarios.findIndex(u => u.login === 'admin');
      if (adminIdx === -1) return;

      usuarios[adminIdx].senha = await hashSenha(novaSenha);
      usuarios[adminIdx].primeiroLogin = false;
      setUsuarios(usuarios);

      usuarioAtual.primeiroLogin = false;
      localStorage.setItem(SESSION_KEY, JSON.stringify(usuarioAtual));

      if (msg) { msg.textContent = 'Senha alterada com sucesso! Recarregando...'; msg.style.color = '#25d366'; }
      setTimeout(() => location.reload(), 1000);
    });
  }
}

// ============================ INICIALIZAÇÃO ============================
(async function init() {
  await sincronizarStorage();
  migrarEsquema();
  await garantirAdmin();

  // Sessão ativa
  const sessao = localStorage.getItem(SESSION_KEY);
  if (sessao) {
    try { usuarioAtual = JSON.parse(sessao); } catch {}
    if (usuarioAtual && usuarioAtual.expiresAt && Date.now() > usuarioAtual.expiresAt) {
      usuarioAtual = null;
      localStorage.removeItem(SESSION_KEY);
    }
  }

  configurarModoTelaCheia();

  if (usuarioAtual) {
    if (usuarioAtual.primeiroLogin) {
      renderTrocaSenhaPopup();
    } else {
      const moduloUltimo = localStorage.getItem('zapflow_modulo_ultimo') || 'dashboard';
      navegarParaModulo(moduloUltimo);
    }
    renderUserBar();
  } else {
    navegarParaModulo('conexao');
    renderUserBar();
  }
})();
