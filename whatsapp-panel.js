// ============================================================
// ZAPFLOW AI — Painel Completo Integrado Estilo WA Web Plus™
// ============================================================
(function () {
  'use strict';

  if (!/web\.whatsapp\.com/.test(location.hostname)) return;

  // Evita injeção dupla
  if (document.getElementById('zapflow-root')) return;
  if (window.self !== window.top) return;

  // ================== STORAGE KEYS ==================
  const STORAGE_KEY = 'zapflow_clientes';
  const FUNIL_KEY = 'zapflow_funil';
  const CATALOGO_KEY = 'zapflow_catalogo';
  const RESPOSTAS_KEY = 'zapflow_respostas';
  const DISPAROS_KEY = 'zapflow_disparos';
  const USERS_KEY = 'zapflow_usuarios';
  const HISTORY_KEY = 'zapflow_historico';
  const SESSION_KEY = 'zapflow_session';
  const CFG_KEY = 'zapflow_config';
  const PRIVACY_KEY = 'zapflow_privacy';
  const VERIFICADOR_KEY = 'zapflow_verificador';

  const CFG_PADRAO = { intervalo: 5, limite: 60, antiDuplicidade: 'sim', apiKeyIA: '', modeloIA: 'gpt-3.5-turbo' };
  const PRIVACY_PADRAO = {
    blurRecent: false,
    blurNames: false,
    blurPhotos: false,
    blurChatMessages: false,
    blurMedia: false,
    hideTyping: false,
    pinLock: false,
    pinCode: ''
  };

  const CHAVES_SINCRONIZADAS = [
    STORAGE_KEY, FUNIL_KEY, CATALOGO_KEY, RESPOSTAS_KEY,
    DISPAROS_KEY, USERS_KEY, HISTORY_KEY, CFG_KEY, PRIVACY_KEY, VERIFICADOR_KEY
  ];

  // ================== UTILITÁRIOS ==================
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function gerarId() {
    return 'zf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function telefoneValido(numero) {
    const n = String(numero).replace(/\D/g, '');
    return /^[1-9]{2}[0-9]{8,9}$/.test(n);
  }

  // ================== SINCRONIZAÇÃO CHROME.STORAGE ==================
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
              try { chrome.storage.local.set({ [k]: JSON.parse(localVal) }); } catch {}
            }
          }
        }
      } catch (e) {
        console.warn('Sincronização ZapFlow:', e);
      }
    }
  }

  function salvar(key, itens) {
    localStorage.setItem(key, JSON.stringify(itens));
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: itens }).catch(() => {});
    }
  }

  function lista(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  function getClientes() { return lista(STORAGE_KEY); }
  function setClientes(c) { salvar(STORAGE_KEY, c); }
  function getConfig() {
    try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return CFG_PADRAO; }
  }
  function getPrivacy() {
    try { return { ...PRIVACY_PADRAO, ...JSON.parse(localStorage.getItem(PRIVACY_KEY) || '{}') }; } catch { return PRIVACY_PADRAO; }
  }
  function setPrivacy(p) { salvar(PRIVACY_KEY, p); aplicarRegrasPrivacidade(); }

  // Hash de senha
  async function hashSenha(senha) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(senha));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ================== AUTH / EQUIPE ==================
  let usuarioAtual = null;
  function getUsuarios() { return lista(USERS_KEY); }
  function setUsuarios(u) { salvar(USERS_KEY, u); }
  function getHistorico() { return lista(HISTORY_KEY); }
  function setHistorico(h) { salvar(HISTORY_KEY, h); }

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
    usuarioAtual = { login: u.login, nome: u.nome, perfil: u.perfil, id: u.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(usuarioAtual));
    return true;
  }
  function fazerLogout() {
    usuarioAtual = null;
    localStorage.removeItem(SESSION_KEY);
    renderUI();
  }
  async function garantirAdmin() {
    const u = getUsuarios();
    if (!u.length) {
      const senhaHash = await hashSenha('admin123');
      setUsuarios([{ nome: 'Administrador', login: 'admin', senha: senhaHash, perfil: 'admin', id: gerarId() }]);
      logAcao('sistema', 'Admin padrão criado (admin / admin123)');
    }
  }

  // ================== MOTOR DE PRIVACIDADE (WA WEB PLUS) ==================
  const stylePrivacidade = document.createElement('style');
  stylePrivacidade.id = 'zapflow-privacy-styles';
  (document.head || document.documentElement).appendChild(stylePrivacidade);

  function aplicarRegrasPrivacidade() {
    const p = getPrivacy();
    let cssRules = '';

    if (p.blurRecent) {
      cssRules += `
        div[data-testid="cell-frame-secondary"],
        span[data-testid="last-msg-status"],
        div._ak8l, div._ak8j {
          filter: blur(5px) !important;
          transition: filter 0.2s ease-in-out !important;
        }
        div[data-testid="cell-frame-secondary"]:hover,
        span[data-testid="last-msg-status"]:hover,
        div._ak8l:hover, div._ak8j:hover {
          filter: blur(0) !important;
        }
      `;
    }

    if (p.blurNames) {
      cssRules += `
        div[data-testid="cell-frame-title"] span,
        header span[data-testid="conversation-info-header-chat-title"],
        span._ao3e, span._ak8q {
          filter: blur(5px) !important;
          transition: filter 0.2s ease-in-out !important;
        }
        div[data-testid="cell-frame-title"]:hover span,
        header span[data-testid="conversation-info-header-chat-title"]:hover,
        span._ao3e:hover, span._ak8q:hover {
          filter: blur(0) !important;
        }
      `;
    }

    if (p.blurPhotos) {
      cssRules += `
        div[data-testid="avatar"] img,
        div[data-testid="cell-frame-container"] img,
        header img {
          filter: blur(8px) !important;
          transition: filter 0.2s ease-in-out !important;
        }
        div[data-testid="avatar"]:hover img,
        div[data-testid="cell-frame-container"]:hover img,
        header:hover img {
          filter: blur(0) !important;
        }
      `;
    }

    if (p.blurChatMessages) {
      cssRules += `
        div[data-testid="msg-container"],
        .message-in, .message-out,
        div._amjy {
          filter: blur(6px) !important;
          transition: filter 0.2s ease-in-out !important;
        }
        div[data-testid="msg-container"]:hover,
        .message-in:hover, .message-out:hover,
        div._amjy:hover {
          filter: blur(0) !important;
        }
      `;
    }

    if (p.blurMedia) {
      cssRules += `
        div[data-testid="image-thumb"],
        div[data-testid="video-thumb"],
        div[data-testid="audio-player"] {
          filter: blur(12px) !important;
          transition: filter 0.2s ease-in-out !important;
        }
        div[data-testid="image-thumb"]:hover,
        div[data-testid="video-thumb"]:hover,
        div[data-testid="audio-player"]:hover {
          filter: blur(0) !important;
        }
      `;
    }

    stylePrivacidade.textContent = cssRules;
  }

  // ================== CSS DA INTERFACE WA WEB PLUS ==================
  const styleUI = document.createElement('style');
  styleUI.id = 'zapflow-ui-styles';
  styleUI.textContent = `
    /* Botão Injetado no Cabeçalho do WhatsApp Web */
    .zf-header-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #122635;
      color: #25d366;
      border: 1px solid #25d366;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      margin-right: 8px;
      transition: all 0.2s ease;
      user-select: none;
    }
    .zf-header-btn:hover {
      background: #25d366;
      color: #0b141a;
      box-shadow: 0 0 10px rgba(37,211,102,0.4);
    }

    /* Botão Flutuante ZF */
    #zf-floating-badge {
      position: fixed;
      bottom: 24px;
      left: 24px;
      width: 54px;
      height: 54px;
      background: #25d366;
      color: #0b141a;
      border: none;
      border-radius: 50%;
      font-size: 1.4rem;
      font-weight: 800;
      cursor: pointer;
      z-index: 2147483646;
      box-shadow: 0 6px 20px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    #zf-floating-badge:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 24px rgba(37,211,102,0.5);
    }

    /* Modal Overlay (Estilo WA Web Plus) */
    #zapflow-overlay {
      position: fixed;
      inset: 0;
      background: rgba(11, 20, 26, 0.82);
      backdrop-filter: blur(8px);
      z-index: 2147483647;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: #eaeaea;
    }
    #zapflow-overlay.zf-active {
      display: flex;
      animation: zfFadeIn 0.2s ease;
    }
    @keyframes zfFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Container do Modal */
    #zapflow-modal {
      width: min(94vw, 1140px);
      height: min(92vh, 820px);
      background: #0e1a24;
      border: 1px solid #1e425c;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.7);
      overflow: hidden;
      transition: all 0.25s ease;
    }

    /* Modo Monitor Cheio (100% da tela) */
    #zapflow-modal.zf-fullscreen {
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      border-radius: 0 !important;
      border: none !important;
    }

    /* Topo do Modal */
    .zf-modal-header {
      padding: 14px 24px;
      background: #0b141a;
      border-bottom: 1px solid #1e425c;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .zf-modal-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .zf-modal-logo {
      font-size: 1.5rem;
      font-weight: 800;
      color: #25d366;
    }
    .zf-modal-tag {
      font-size: 0.72rem;
      background: #122635;
      color: #25d366;
      border: 1px solid #25d366;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }

    /* Barra Rápida "Click to Chat" no Topo */
    .zf-click-to-chat {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0e1a24;
      padding: 4px 8px;
      border: 1px solid #1e425c;
      border-radius: 8px;
      flex: 1;
      max-width: 480px;
    }
    .zf-click-input {
      background: transparent;
      border: none;
      color: #eaeaea;
      font-size: 0.85rem;
      outline: none;
      width: 100%;
    }
    .zf-click-btn {
      background: #25d366;
      color: #0b141a;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .zf-click-btn:hover { background: #3ceb84; }

    .zf-modal-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .zf-action-icon-btn {
      background: #122635;
      border: 1px solid #1e425c;
      color: #9fb3c8;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.82rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .zf-action-icon-btn:hover {
      border-color: #25d366;
      color: #25d366;
    }

    /* Barra de Navegação por Abas (WA Web Plus Style) */
    .zf-tabs-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      background: #0e1a24;
      padding: 8px 16px;
      border-bottom: 1px solid #1e425c;
      overflow-x: auto;
      user-select: none;
    }
    .zf-tab-btn {
      background: transparent;
      border: none;
      color: #9fb3c8;
      padding: 9px 16px;
      font-size: 0.84rem;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .zf-tab-btn:hover {
      background: #162a3c;
      color: #fff;
    }
    .zf-tab-btn.active {
      background: #1e425c;
      color: #25d366;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    /* Conteúdo das Abas */
    .zf-modal-body {
      flex: 1;
      padding: 24px 32px;
      overflow-y: auto;
      background: #0b141a;
    }

    /* Cards de Opções com Switch (Estilo WA Web Plus) */
    .waw-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .waw-card {
      background: #0e1a24;
      border: 1px solid #1e425c;
      border-radius: 10px;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      transition: border-color 0.2s ease, transform 0.15s;
    }
    .waw-card:hover {
      border-color: #25d366;
    }
    .waw-card-info {
      flex: 1;
    }
    .waw-card-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #eaeaea;
      margin-bottom: 4px;
    }
    .waw-card-desc {
      font-size: 0.78rem;
      color: #9fb3c8;
      line-height: 1.35;
    }

    /* Switch iOS / WA Web Plus */
    .waw-switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 26px;
      flex-shrink: 0;
    }
    .waw-switch input { opacity: 0; width: 0; height: 0; }
    .waw-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background-color: #1e425c;
      border-radius: 26px;
      transition: .25s ease;
    }
    .waw-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background-color: #fff;
      border-radius: 50%;
      transition: .25s ease;
    }
    input:checked + .waw-slider {
      background-color: #25d366;
    }
    input:checked + .waw-slider:before {
      transform: translateX(22px);
    }

    /* Formulários e Tabelas Modernas */
    .zf-form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 14px;
    }
    .zf-label {
      font-size: 0.8rem;
      color: #9fb3c8;
      font-weight: 600;
    }
    .zf-input, .zf-select, .zf-textarea {
      padding: 10px 12px;
      background: #0e1a24;
      border: 1px solid #1e425c;
      color: #eaeaea;
      border-radius: 8px;
      font-size: 0.9rem;
      width: 100%;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .zf-input:focus, .zf-select:focus, .zf-textarea:focus {
      border-color: #25d366;
      box-shadow: 0 0 0 2px rgba(37,211,102,0.25);
    }
    .zf-btn-primary {
      background: #25d366;
      color: #0b141a;
      border: none;
      font-weight: 700;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 0.88rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s, transform 0.1s;
    }
    .zf-btn-primary:hover { background: #3ceb84; }
    .zf-btn-primary:active { transform: scale(0.98); }

    .zf-table-wrap {
      width: 100%;
      overflow-x: auto;
      border: 1px solid #1e425c;
      border-radius: 8px;
      margin-top: 14px;
    }
    table.zf-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      text-align: left;
    }
    table.zf-table th, table.zf-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #1e425c;
    }
    table.zf-table th {
      color: #9fb3c8;
      background: #0e1a24;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
    }
    table.zf-table tr:hover { background: #122635; }
    .zf-badge {
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    /* Grid de Estatísticas */
    .zf-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .zf-stat-card {
      background: #0e1a24;
      border: 1px solid #1e425c;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .zf-stat-val {
      font-size: 1.8rem;
      font-weight: 800;
      color: #25d366;
    }
    .zf-stat-lbl {
      font-size: 0.78rem;
      color: #9fb3c8;
      margin-top: 4px;
    }

    /* Notificações Toast */
    .zf-toast {
      position: fixed;
      top: 24px;
      right: 24px;
      padding: 12px 22px;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 700;
      z-index: 2147483647;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      animation: zfSlideIn 0.3s ease;
    }
    @keyframes zfSlideIn {
      from { transform: translateX(30px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  (document.head || document.documentElement).appendChild(styleUI);

  // ================== TOAST NOTIFICAÇÃO ==================
  function showToast(mensagem, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = 'zf-toast';
    toast.style.background = tipo === 'sucesso' ? '#25d366' : tipo === 'erro' ? '#dc3545' : '#1e425c';
    toast.style.color = tipo === 'sucesso' || tipo === 'erro' ? '#0b141a' : '#eaeaea';
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // ================== MONTAGEM DO MODAL ESTILO WA WEB PLUS ==================
  const overlay = document.createElement('div');
  overlay.id = 'zapflow-overlay';
  overlay.innerHTML = `
    <div id="zapflow-modal">
      <header class="zf-modal-header">
        <div class="zf-modal-brand">
          <div class="zf-modal-logo">ZF</div>
          <div>
            <strong style="color:#eaeaea;font-size:1rem;display:block;">ZapFlow AI</strong>
            <span class="zf-modal-tag">WA Web Plus™ Edition</span>
          </div>
        </div>

        <div class="zf-click-to-chat" title="Iniciar conversa direta sem salvar número na agenda">
          <span>📞</span>
          <input type="tel" id="zf-direct-phone" class="zf-click-input" placeholder="Conversar com número (ex: 5511999999999)...">
          <button id="zf-direct-chat-btn" class="zf-click-btn">Conversar</button>
        </div>

        <div class="zf-modal-actions">
          <button id="zf-btn-toggle-monitor" class="zf-action-icon-btn" title="Alternar Tela Cheia no Monitor">⛶ Tela Cheia</button>
          <button id="zf-btn-close-modal" class="zf-action-icon-btn" style="font-size:1.1rem;padding:4px 10px;" title="Fechar (Esc)">✕</button>
        </div>
      </header>

      <nav class="zf-tabs-bar">
        <button class="zf-tab-btn active" data-tab="privacidade">🛡️ Privacidade</button>
        <button class="zf-tab-btn" data-tab="personalizacao">🎨 Personalização</button>
        <button class="zf-tab-btn" data-tab="disparos">📢 Disparos</button>
        <button class="zf-tab-btn" data-tab="crm">👥 CRM</button>
        <button class="zf-tab-btn" data-tab="funil">📈 Funil</button>
        <button class="zf-tab-btn" data-tab="catalogo">📦 Catálogo</button>
        <button class="zf-tab-btn" data-tab="respostas">⚡ Respostas</button>
        <button class="zf-tab-btn" data-tab="exportar">🎣 Exportar / Leads</button>
        <button class="zf-tab-btn" data-tab="grafo">🕸️ Grafo</button>
        <button class="zf-tab-btn" data-tab="ia">🤖 IA Atendente</button>
        <button class="zf-tab-btn" data-tab="config">⚙️ Configurações</button>
      </nav>

      <main class="zf-modal-body" id="zf-modal-content"></main>
    </div>
  `;
  document.documentElement.appendChild(overlay);

  const modal = overlay.querySelector('#zapflow-modal');
  const contentEl = overlay.querySelector('#zf-modal-content');
  const btnToggleMonitor = overlay.querySelector('#zf-btn-toggle-monitor');
  const btnCloseModal = overlay.querySelector('#zf-btn-close-modal');
  const tabsBtns = overlay.querySelectorAll('.zf-tab-btn');

  let abaAtiva = 'privacidade';

  function abrirModal() {
    overlay.classList.add('zf-active');
    renderAba(abaAtiva);
  }
  function fecharModal() {
    overlay.classList.remove('zf-active');
  }
  function alternarModal() {
    if (overlay.classList.contains('zf-active')) fecharModal();
    else abrirModal();
  }

  // Click outside fecha modal
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharModal();
  });
  btnCloseModal?.addEventListener('click', fecharModal);

  // Botão Tela Cheia no Monitor
  btnToggleMonitor?.addEventListener('click', () => {
    const isFull = modal.classList.toggle('zf-fullscreen');
    btnToggleMonitor.textContent = isFull ? '🗗 Janela' : '⛶ Tela Cheia';
    localStorage.setItem('zapflow_modal_fullscreen', isFull ? 'true' : 'false');
    if (abaAtiva === 'grafo') renderGrafoTab();
  });
  if (localStorage.getItem('zapflow_modal_fullscreen') === 'true') {
    modal.classList.add('zf-fullscreen');
    btnToggleMonitor.textContent = '🗗 Janela';
  }

  // Tecla Esc e Atalhos
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('zf-active')) {
      fecharModal();
    }
    if ((e.altKey && (e.key === 'w' || e.key === 'W' || e.key === 'z' || e.key === 'Z'))) {
      alternarModal();
    }
  });

  // Direct Click to Chat
  overlay.querySelector('#zf-direct-chat-btn')?.addEventListener('click', () => {
    const input = overlay.querySelector('#zf-direct-phone');
    const num = String(input.value || '').replace(/\D/g, '');
    if (!telefoneValido(num)) {
      showToast('Digite um número válido com DDD (ex: 5511999999999)', 'erro');
      return;
    }
    window.location.href = `https://web.whatsapp.com/send?phone=${num}`;
    fecharModal();
  });

  // Navegação por Abas
  tabsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabsBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      abaAtiva = btn.dataset.tab;
      renderAba(abaAtiva);
    });
  });

  // ================== RENDERIZADORES DE ABAS (WA WEB PLUS) ==================

  // 1. ABA PRIVACIDADE (Ícone WA Web Plus)
  function renderPrivacidadeTab() {
    const p = getPrivacy();
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">🛡️ Recursos de Privacidade</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:20px;">Proteja informações confidenciais na tela do seu computador. Os itens desfocados se revelam automaticamente ao passar o cursor do mouse.</p>

      <div class="waw-card-grid">
        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Desfocar mensagens recentes</div>
            <div class="waw-card-desc">Oculta a prévia da última mensagem na lista lateral de conversas.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-blur-recent" ${p.blurRecent ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>

        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Desfocar nomes dos contatos</div>
            <div class="waw-card-desc">Oculta os nomes dos clientes e grupos na barra lateral e cabeçalho.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-blur-names" ${p.blurNames ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>

        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Desfocar fotos de perfil</div>
            <div class="waw-card-desc">Aplica efeito borrado nas fotos de contatos e grupos.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-blur-photos" ${p.blurPhotos ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>

        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Desfocar mensagens dentro do chat</div>
            <div class="waw-card-desc">Borrão sobre todos os balões da conversa ativa. Revela no hover.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-blur-chat" ${p.blurChatMessages ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>

        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Desfocar mídias (fotos e vídeos)</div>
            <div class="waw-card-desc">Oculta miniaturas de fotos, stickers, áudios e vídeos recebidos.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-blur-media" ${p.blurMedia ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>

        <div class="waw-card">
          <div class="waw-card-info">
            <div class="waw-card-title">Ocultar status "digitando..."</div>
            <div class="waw-card-desc">Evita que o destinatário veja que você está escrevendo.</div>
          </div>
          <label class="waw-switch">
            <input type="checkbox" id="sw-hide-typing" ${p.hideTyping ? 'checked' : ''}>
            <span class="waw-slider"></span>
          </label>
        </div>
      </div>
    `;

    // Listeners dos switches
    const binds = [
      { id: 'sw-blur-recent', key: 'blurRecent' },
      { id: 'sw-blur-names', key: 'blurNames' },
      { id: 'sw-blur-photos', key: 'blurPhotos' },
      { id: 'sw-blur-chat', key: 'blurChatMessages' },
      { id: 'sw-blur-media', key: 'blurMedia' },
      { id: 'sw-hide-typing', key: 'hideTyping' },
    ];

    binds.forEach(b => {
      contentEl.querySelector('#' + b.id)?.addEventListener('change', (e) => {
        const cur = getPrivacy();
        cur[b.key] = e.target.checked;
        setPrivacy(cur);
        showToast(`Privacidade atualizada!`, 'sucesso');
      });
    });
  }

  // 2. ABA PERSONALIZAÇÃO
  function renderPersonalizacaoTab() {
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">🎨 Personalização e Acessos Rápidos</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:20px;">Melhore sua navegação diária no WhatsApp Web.</p>

      <div style="max-width:540px;background:#0e1a24;border:1px solid #1e425c;border-radius:12px;padding:20px;margin-bottom:20px;">
        <h3 style="color:#eaeaea;font-size:1rem;margin-bottom:8px;">📞 Iniciar conversa com número não salvo</h3>
        <p style="color:#9fb3c8;font-size:0.8rem;margin-bottom:12px;">Converse com qualquer contato sem precisar adicionar à sua agenda telefônica.</p>
        <div style="display:flex;gap:8px;">
          <input type="tel" id="zf-custom-phone" class="zf-input" placeholder="Ex: 5511999999999">
          <button id="zf-btn-go-custom-phone" class="zf-btn-primary" style="white-space:nowrap;">Abrir Chat</button>
        </div>
      </div>
    `;

    contentEl.querySelector('#zf-btn-go-custom-phone')?.addEventListener('click', () => {
      const num = String(contentEl.querySelector('#zf-custom-phone').value || '').replace(/\D/g, '');
      if (!telefoneValido(num)) {
        showToast('Número inválido. Use formato com DDD.', 'erro');
        return;
      }
      window.location.href = `https://web.whatsapp.com/send?phone=${num}`;
      fecharModal();
    });
  }

  // 3. ABA DISPAROS EM MASSA
  function renderDisparosTab() {
    const clientes = getClientes();
    let opts = '<option value="">Selecione um cliente (opcional)...</option>';
    clientes.forEach(c => opts += `<option value="${escapeHtml(c.telefone)}">${escapeHtml(c.nome)} (${escapeHtml(c.telefone)})</option>`);

    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">📢 Disparo de Mensagens em Massa</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Envie mensagens personalizadas com substituição automática de variáveis.</p>

      <form id="zf-disparo-form" style="max-width:700px;">
        <div class="zf-form-group">
          <label class="zf-label">Cliente Cadastrado</label>
          <select id="zf-disp-cliente" class="zf-select">${opts}</select>
        </div>
        <div class="zf-form-group">
          <label class="zf-label">Número do Destinatário (com DDD)</label>
          <input type="tel" id="zf-disp-numero" class="zf-input" placeholder="5511999999999" required>
        </div>
        <div class="zf-form-group">
          <label class="zf-label">Mensagem (use {nome}, {empresa}, {cidade} ou atalhos como /preco)</label>
          <textarea id="zf-disp-msg" class="zf-textarea" rows="4" placeholder="Olá {nome}, tudo bem? Segue nossa proposta." required></textarea>
        </div>
        <button type="submit" class="zf-btn-primary">Enviar Mensagem via WhatsApp</button>
      </form>
    `;

    const selectCli = contentEl.querySelector('#zf-disp-cliente');
    const inputNum = contentEl.querySelector('#zf-disp-numero');
    selectCli?.addEventListener('change', () => {
      if (selectCli.value) inputNum.value = selectCli.value;
    });

    contentEl.querySelector('#zf-disparo-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const num = String(inputNum.value).replace(/\D/g, '');
      let msg = contentEl.querySelector('#zf-disp-msg').value.trim();

      if (!telefoneValido(num)) {
        showToast('Telefone inválido. Formato: 5511999999999', 'erro');
        return;
      }

      // Atalhos
      const respostas = lista(RESPOSTAS_KEY);
      for (const r of respostas) {
        msg = msg.replace(new RegExp(`\\b${r.atalho}\\b`, 'g'), r.texto);
      }

      // Interpolação se cliente existe
      const c = getClientes().find(x => x.telefone === num);
      if (c) {
        msg = msg.replace(/{nome}/g, c.nome || '').replace(/{empresa}/g, c.empresa || '').replace(/{cidade}/g, c.cidade || '');
      }

      const disp = lista(DISPAROS_KEY);
      disp.push({ numero: num, mensagem: msg, data: new Date().toISOString() });
      salvar(DISPAROS_KEY, disp);
      logAcao('disparo', num);

      window.open(`https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(msg)}`, '_blank');
      showToast('Disparo registrado com sucesso!', 'sucesso');
    });
  }

  // 4. ABA CRM
  function renderCRMTab() {
    const clientes = getClientes();
    let rows = clientes.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.nome)}</strong></td>
        <td>${escapeHtml(c.telefone)}</td>
        <td>${escapeHtml(c.empresa || '-')}</td>
        <td>${escapeHtml(c.cidade || '-')}</td>
        <td>${c.ultimaInteracao ? new Date(c.ultimaInteracao).toLocaleDateString('pt-BR') : '-'}</td>
        <td><button class="zf-btn-del" data-id="${c.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;">Excluir</button></td>
      </tr>
    `).join('');

    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <h2 style="color:#25d366;font-size:1.3rem;">👥 CRM — Gestão de Clientes</h2>
          <p style="color:#9fb3c8;font-size:0.85rem;">Gerencie seus contatos e clientes diretamente pelo WhatsApp Web.</p>
        </div>
        <button id="zf-btn-toggle-novo-cli" class="zf-btn-primary">+ Novo Cliente</button>
      </div>

      <div id="zf-box-novo-cli" style="display:none;background:#0e1a24;border:1px solid #1e425c;border-radius:10px;padding:18px;margin-bottom:20px;">
        <form id="zf-form-crm" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
          <div><label class="zf-label">Nome Completo</label><input type="text" name="nome" class="zf-input" required></div>
          <div><label class="zf-label">Telefone (com DDD)</label><input type="tel" name="telefone" class="zf-input" placeholder="5511999999999" required></div>
          <div><label class="zf-label">Empresa</label><input type="text" name="empresa" class="zf-input"></div>
          <div><label class="zf-label">Cidade</label><input type="text" name="cidade" class="zf-input"></div>
          <div style="grid-column:1/-1;"><label class="zf-label">Observações</label><input type="text" name="obs" class="zf-input"></div>
          <button type="submit" class="zf-btn-primary" style="grid-column:1/-1;width:fit-content;">Salvar Cliente</button>
        </form>
      </div>

      <div class="zf-table-wrap">
        <table class="zf-table">
          <thead><tr><th>Nome</th><th>Telefone</th><th>Empresa</th><th>Cidade</th><th>Última Interação</th><th>Ação</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9fb3c8">Nenhum cliente cadastrado ainda.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    const boxNovo = contentEl.querySelector('#zf-box-novo-cli');
    contentEl.querySelector('#zf-btn-toggle-novo-cli')?.addEventListener('click', () => {
      boxNovo.style.display = boxNovo.style.display === 'none' ? 'block' : 'none';
    });

    contentEl.querySelector('#zf-form-crm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tel = String(fd.get('telefone')).replace(/\D/g, '');
      if (!telefoneValido(tel)) {
        showToast('Telefone inválido.', 'erro');
        return;
      }
      const c = getClientes();
      const novo = {
        id: gerarId(),
        nome: escapeHtml(String(fd.get('nome'))),
        telefone: tel,
        empresa: escapeHtml(String(fd.get('empresa') || '')),
        cidade: escapeHtml(String(fd.get('cidade') || '')),
        observacoes: escapeHtml(String(fd.get('obs') || '')),
        ultimaInteracao: new Date().toISOString()
      };
      c.push(novo);
      setClientes(c);
      logAcao('crm_cadastro', novo.nome);
      showToast(`Cliente ${novo.nome} salvo!`, 'sucesso');
      renderCRMTab();
    });

    contentEl.querySelectorAll('.zf-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = getClientes();
        const idx = c.findIndex(x => x.id === id);
        if (idx === -1) return;
        if (!confirm(`Excluir ${c[idx].nome}?`)) return;
        c.splice(idx, 1);
        setClientes(c);
        showToast('Cliente removido.', 'sucesso');
        renderCRMTab();
      });
    });
  }

  // 5. ABA FUNIL DE VENDAS
  function renderFunilTab() {
    const leads = lista(FUNIL_KEY);
    let rows = leads.map(l => `
      <tr>
        <td><strong>${escapeHtml(l.nome)}</strong></td>
        <td>${escapeHtml(l.telefone)}</td>
        <td><span class="zf-badge" style="background:#122635;border:1px solid #1e425c;">${escapeHtml(l.etapa)}</span></td>
        <td><strong style="color:${l.temperatura === 'quente' ? '#dc3545' : l.temperatura === 'morno' ? '#ffc107' : '#6c757d'}">${escapeHtml(l.temperatura)}</strong></td>
        <td><button class="zf-btn-del" data-id="${l.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;">Excluir</button></td>
      </tr>
    `).join('');

    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">📈 Funil de Vendas</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Acompanhe o estágio de negociação dos seus potenciais clientes.</p>

      <form id="zf-form-funil" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;background:#0e1a24;padding:16px;border-radius:10px;border:1px solid #1e425c;margin-bottom:20px;">
        <div><label class="zf-label">Nome do Lead</label><input type="text" name="nome" class="zf-input" required></div>
        <div><label class="zf-label">Telefone</label><input type="tel" name="telefone" class="zf-input" required></div>
        <div>
          <label class="zf-label">Etapa</label>
          <select name="etapa" class="zf-select">
            <option>Novo Lead</option><option>Contato Realizado</option><option>Negociação</option><option>Cliente</option><option>Pós-venda</option>
          </select>
        </div>
        <div>
          <label class="zf-label">Temperatura</label>
          <select name="temperatura" class="zf-select">
            <option value="frio">Frio ❄️</option><option value="morno">Morno ⛅</option><option value="quente">Quente 🔥</option>
          </select>
        </div>
        <button type="submit" class="zf-btn-primary" style="grid-column:1/-1;width:fit-content;">+ Adicionar ao Funil</button>
      </form>

      <div class="zf-table-wrap">
        <table class="zf-table">
          <thead><tr><th>Lead</th><th>Telefone</th><th>Etapa</th><th>Temperatura</th><th>Ação</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#9fb3c8">Nenhum lead registrado no funil.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    contentEl.querySelector('#zf-form-funil')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tel = String(fd.get('telefone')).replace(/\D/g, '');
      if (!telefoneValido(tel)) { showToast('Telefone inválido.', 'erro'); return; }
      const l = lista(FUNIL_KEY);
      l.push({
        id: gerarId(),
        nome: escapeHtml(String(fd.get('nome'))),
        telefone: tel,
        etapa: String(fd.get('etapa')),
        temperatura: String(fd.get('temperatura')),
        dataCriacao: new Date().toISOString()
      });
      salvar(FUNIL_KEY, l);
      showToast('Lead adicionado ao funil!', 'sucesso');
      renderFunilTab();
    });

    contentEl.querySelectorAll('.zf-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const l = lista(FUNIL_KEY);
        const idx = l.findIndex(x => x.id === id);
        if (idx === -1) return;
        l.splice(idx, 1);
        salvar(FUNIL_KEY, l);
        showToast('Lead removido.', 'sucesso');
        renderFunilTab();
      });
    });
  }

  // 6. ABA CATÁLOGO
  function renderCatalogoTab() {
    const itens = lista(CATALOGO_KEY);
    let rows = itens.map(it => `
      <tr>
        <td><strong>${escapeHtml(it.produto)}</strong></td>
        <td style="color:#25d366;font-weight:700;">${escapeHtml(it.preco)}</td>
        <td>${it.arquivo ? `<a href="${it.arquivo}" target="_blank" style="color:#25d366">Ver link</a>` : '-'}</td>
        <td><button class="zf-btn-del" data-id="${it.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;">Excluir</button></td>
      </tr>
    `).join('');

    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">📦 Catálogo Inteligente</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Produtos e serviços com envio facilitado.</p>

      <form id="zf-form-cat" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;background:#0e1a24;padding:16px;border-radius:10px;border:1px solid #1e425c;margin-bottom:20px;">
        <div><label class="zf-label">Nome do Produto</label><input type="text" name="produto" class="zf-input" required></div>
        <div><label class="zf-label">Preço</label><input type="text" name="preco" class="zf-input" placeholder="R$ 99,00" required></div>
        <div><label class="zf-label">Link de Arquivo ou Imagem</label><input type="text" name="arquivo" class="zf-input"></div>
        <button type="submit" class="zf-btn-primary" style="grid-column:1/-1;width:fit-content;">Cadastrar Produto</button>
      </form>

      <div class="zf-table-wrap">
        <table class="zf-table">
          <thead><tr><th>Produto</th><th>Preço</th><th>Arquivo</th><th>Ação</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#9fb3c8">Catálogo vazio.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    contentEl.querySelector('#zf-form-cat')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const cat = lista(CATALOGO_KEY);
      cat.push({
        id: gerarId(),
        produto: escapeHtml(String(fd.get('produto'))),
        preco: escapeHtml(String(fd.get('preco'))),
        arquivo: escapeHtml(String(fd.get('arquivo') || ''))
      });
      salvar(CATALOGO_KEY, cat);
      showToast('Produto salvo no catálogo!', 'sucesso');
      renderCatalogoTab();
    });

    contentEl.querySelectorAll('.zf-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const cat = lista(CATALOGO_KEY);
        const idx = cat.findIndex(x => x.id === id);
        if (idx === -1) return;
        cat.splice(idx, 1);
        salvar(CATALOGO_KEY, cat);
        renderCatalogoTab();
      });
    });
  }

  // 7. ABA RESPOSTAS RÁPIDAS
  function renderRespostasTab() {
    const resp = lista(RESPOSTAS_KEY);
    let rows = resp.map(r => `
      <tr>
        <td><code style="color:#25d366;background:#122635;padding:3px 6px;border-radius:4px;">${escapeHtml(r.atalho)}</code></td>
        <td>${escapeHtml(r.texto)}</td>
        <td><button class="zf-btn-del" data-id="${r.id}" style="background:#dc3545;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;">Excluir</button></td>
      </tr>
    `).join('');

    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">⚡ Respostas Rápidas</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Cadastre atalhos para responder mensagens com apenas uma palavra-chave (ex: /preco, /pix).</p>

      <form id="zf-form-resp" style="display:grid;grid-template-columns:1fr 2fr auto;gap:12px;background:#0e1a24;padding:16px;border-radius:10px;border:1px solid #1e425c;margin-bottom:20px;align-items:end;">
        <div><label class="zf-label">Atalho (ex: /preco)</label><input type="text" name="atalho" class="zf-input" placeholder="/atalho" required></div>
        <div><label class="zf-label">Texto da Mensagem</label><input type="text" name="texto" class="zf-input" placeholder="Mensagem completa..." required></div>
        <button type="submit" class="zf-btn-primary">Salvar</button>
      </form>

      <div class="zf-table-wrap">
        <table class="zf-table">
          <thead><tr><th>Atalho</th><th>Texto</th><th>Ação</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:#9fb3c8">Nenhum atalho cadastrado.</td></tr>'}</tbody>
        </table>
      </div>
    `;

    contentEl.querySelector('#zf-form-resp')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      let atalho = String(fd.get('atalho')).trim();
      if (!atalho.startsWith('/')) atalho = '/' + atalho;
      const r = lista(RESPOSTAS_KEY);
      r.push({ id: gerarId(), atalho: escapeHtml(atalho), texto: escapeHtml(String(fd.get('texto'))) });
      salvar(RESPOSTAS_KEY, r);
      showToast('Atalho cadastrado!', 'sucesso');
      renderRespostasTab();
    });

    contentEl.querySelectorAll('.zf-btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const r = lista(RESPOSTAS_KEY);
        const idx = r.findIndex(x => x.id === id);
        if (idx === -1) return;
        r.splice(idx, 1);
        salvar(RESPOSTAS_KEY, r);
        renderRespostasTab();
      });
    });
  }

  // 8. ABA EXPORTAR / LEADS (Captador e Exportador Estilo WA Web Plus)
  function renderExportarTab() {
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">🎣 Captador e Exportador de Leads</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:20px;">Extraia contatos diretamente do WhatsApp Web e exporte em planilhas Excel / CSV com um clique.</p>

      <div class="waw-card-grid">
        <div class="waw-card" style="flex-direction:column;align-items:flex-start;">
          <div class="waw-card-title">🔍 Extrair Números Visíveis</div>
          <div class="waw-card-desc" style="margin-bottom:12px;">Escanear todas as mensagens e conversas carregadas na tela do WhatsApp Web.</div>
          <button id="zf-btn-scan-numbers" class="zf-btn-primary">Extrair da Tela</button>
          <div id="zf-scan-result" style="margin-top:10px;font-size:0.82rem;color:#25d366;"></div>
        </div>

        <div class="waw-card" style="flex-direction:column;align-items:flex-start;">
          <div class="waw-card-title">👥 Exportar Clientes do CRM</div>
          <div class="waw-card-desc" style="margin-bottom:12px;">Baixar todos os clientes cadastrados em planilha CSV compatível com Excel.</div>
          <button id="zf-btn-exp-crm" class="zf-btn-primary">Exportar Clientes (CSV)</button>
        </div>

        <div class="waw-card" style="flex-direction:column;align-items:flex-start;">
          <div class="waw-card-title">📈 Exportar Funil de Vendas</div>
          <div class="waw-card-desc" style="margin-bottom:12px;">Baixar todos os leads e etapas do funil em planilha CSV.</div>
          <button id="zf-btn-exp-funil" class="zf-btn-primary">Exportar Funil (CSV)</button>
        </div>
      </div>
    `;

    // Função de exportação CSV
    function exportarCSV(nome, dados) {
      if (!dados || !dados.length) { showToast('Sem dados para exportar.', 'erro'); return; }
      const cabecalho = Object.keys(dados[0]).join(',') + '\n';
      const corpo = dados.map(l => Object.values(l).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([cabecalho + corpo], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = nome; a.click();
      URL.revokeObjectURL(url);
      showToast(`Arquivo ${nome} exportado com sucesso!`, 'sucesso');
    }

    contentEl.querySelector('#zf-btn-exp-crm')?.addEventListener('click', () => {
      exportarCSV('clientes_zapflow.csv', getClientes());
    });
    contentEl.querySelector('#zf-btn-exp-funil')?.addEventListener('click', () => {
      exportarCSV('funil_zapflow.csv', lista(FUNIL_KEY));
    });

    // Escanear números
    contentEl.querySelector('#zf-btn-scan-numbers')?.addEventListener('click', () => {
      const TEL_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?\d{4,5}\-?\d{4}/g;
      const textos = Array.from(document.querySelectorAll('span, div, p')).map(el => el.textContent || '').join(' ');
      const encontrados = textos.match(TEL_RE) || [];
      const numeros = [];
      for (const tel of encontrados) {
        const n = tel.replace(/\D/g, '');
        if (n.length >= 10 && n.length <= 13 && !numeros.includes(n)) {
          numeros.push(n);
        }
      }

      const resDiv = contentEl.querySelector('#zf-scan-result');
      if (resDiv) {
        resDiv.innerHTML = `<strong>${numeros.length} números encontrados!</strong><br>` +
          numeros.slice(0, 15).map(n => `<span class="zf-badge" style="background:#122635;border:1px solid #25d366;color:#25d366;margin:2px;display:inline-block;">${n}</span>`).join('') +
          (numeros.length > 15 ? `<span style="color:#9fb3c8"> +${numeros.length - 15} mais...</span>` : '');
      }

      if (numeros.length > 0) {
        const c = getClientes();
        let add = 0;
        for (const n of numeros) {
          if (!c.some(x => x.telefone === n)) {
            c.push({ id: gerarId(), nome: n, telefone: n, empresa: '', cidade: '', observacoes: 'Captado via ZapFlow', ultimaInteracao: new Date().toISOString() });
            add++;
          }
        }
        if (add > 0) {
          setClientes(c);
          showToast(`${add} novos contatos salvos no CRM!`, 'sucesso');
        }
      } else {
        showToast('Nenhum número novo visível na tela.', 'info');
      }
    });
  }

  // 9. ABA GRAFO DE REDE
  function renderGrafoTab() {
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">🕸️ Grafo de Conexões (Clientes & Funil)</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:14px;">Mapeamento visual da rede de relacionamento de contatos e leads.</p>
      <div id="zf-graph-box" style="width:100%;height:480px;background:#0e1a24;border:1px solid #1e425c;border-radius:12px;position:relative;"></div>
    `;

    const container = contentEl.querySelector('#zf-graph-box');
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
  }

  // 10. ABA IA ATENDENTE
  function renderIATab() {
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">🤖 IA Integrada para Atendimento</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Gere respostas inteligentes, correções e mensagens persuasivas.</p>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <button class="zf-btn-primary" data-ia="corrigir">✍️ Corrigir Texto</button>
        <button class="zf-btn-primary" data-ia="reescrever">🔄 Reescrever Profissional</button>
        <button class="zf-btn-primary" data-ia="responder">💬 Gerar Resposta</button>
        <button class="zf-btn-primary" data-ia="resumir">📋 Resumir Conversa</button>
        <button class="zf-btn-primary" data-ia="followup">⏰ Follow-up para Lead</button>
      </div>

      <textarea id="zf-ia-input" class="zf-textarea" rows="4" placeholder="Cole a mensagem aqui..."></textarea>
      <div id="zf-ia-output" style="margin-top:14px;padding:14px;background:#0e1a24;border:1px solid #1e425c;border-radius:8px;min-height:80px;line-height:1.5;"></div>
    `;

    const PROMPTS = {
      corrigir: 'Corrija erros de português deste texto, mantendo tom amigável. Texto: "{texto}"',
      reescrever: 'Reescreva este texto de forma muito mais profissional e clara. Texto: "{texto}"',
      responder: 'Você é um atendente de WhatsApp rápido e educado. Gere uma resposta objetiva para: "{texto}"',
      resumir: 'Resuma os principais pontos desta conversa em 3 tópicos: "{texto}"',
      followup: 'Gere uma mensagem amigável de acompanhamento (follow-up) para este cliente: "{texto}"'
    };

    contentEl.querySelectorAll('[data-ia]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const acao = btn.dataset.ia;
        const input = contentEl.querySelector('#zf-ia-input');
        const output = contentEl.querySelector('#zf-ia-output');
        const texto = input.value.trim();
        if (!texto) { showToast('Digite ou cole um texto primeiro.', 'erro'); return; }

        const cfg = getConfig();
        if (!cfg.apiKeyIA) { showToast('Configure sua chave de API OpenAI na aba Configurações.', 'erro'); return; }

        output.textContent = 'Processando com IA... Aguarde.';
        try {
          const prompt = (PROMPTS[acao] || PROMPTS.responder).replace('{texto}', texto);
          const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKeyIA}` },
            body: JSON.stringify({ model: cfg.modeloIA || 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], temperature: 0.7 })
          });
          if (!r.ok) throw new Error('Erro na API OpenAI: ' + r.status);
          const d = await r.json();
          output.textContent = d.choices[0].message.content.trim();
          showToast('Resposta gerada!', 'sucesso');
        } catch (err) {
          output.textContent = 'Erro: ' + err.message;
          showToast(err.message, 'erro');
        }
      });
    });
  }

  // 11. ABA CONFIGURAÇÕES
  function renderConfigTab() {
    const cfg = getConfig();
    contentEl.innerHTML = `
      <h2 style="color:#25d366;font-size:1.3rem;margin-bottom:6px;">⚙️ Configurações Gerais</h2>
      <p style="color:#9fb3c8;font-size:0.85rem;margin-bottom:18px;">Ajustes de IA, anti-bloqueio e segurança.</p>

      <form id="zf-cfg-form" style="max-width:600px;">
        <div class="zf-form-group">
          <label class="zf-label">Chave de API OpenAI</label>
          <input type="password" name="apiKey" class="zf-input" value="${cfg.apiKeyIA || ''}" placeholder="sk-...">
        </div>
        <div class="zf-form-group">
          <label class="zf-label">Modelo de IA</label>
          <input type="text" name="modelo" class="zf-input" value="${cfg.modeloIA || 'gpt-3.5-turbo'}">
        </div>
        <div class="zf-form-group">
          <label class="zf-label">Intervalo padrão entre mensagens nos disparos (segundos)</label>
          <input type="number" name="intervalo" class="zf-input" value="${cfg.intervalo || 5}" min="1">
        </div>
        <button type="submit" class="zf-btn-primary">Salvar Configurações</button>
      </form>
    `;

    contentEl.querySelector('#zf-cfg-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const nova = {
        intervalo: parseInt(fd.get('intervalo')) || 5,
        apiKeyIA: String(fd.get('apiKey')).trim(),
        modeloIA: String(fd.get('modelo')).trim() || 'gpt-3.5-turbo'
      };
      salvar(CFG_KEY, nova);
      showToast('Configurações salvas!', 'sucesso');
    });
  }

  function renderAba(tab) {
    if (tab === 'privacidade') renderPrivacidadeTab();
    else if (tab === 'personalizacao') renderPersonalizacaoTab();
    else if (tab === 'disparos') renderDisparosTab();
    else if (tab === 'crm') renderCRMTab();
    else if (tab === 'funil') renderFunilTab();
    else if (tab === 'catalogo') renderCatalogoTab();
    else if (tab === 'respostas') renderRespostasTab();
    else if (tab === 'exportar') renderExportarTab();
    else if (tab === 'grafo') renderGrafoTab();
    else if (tab === 'ia') renderIATab();
    else if (tab === 'config') renderConfigTab();
  }

  // ================== BOTÕES DE DISPARO NA INTERFACE DO WHATSAPP ==================
  // 1. Botão Flutuante ZF
  const flutuante = document.createElement('button');
  flutuante.id = 'zf-floating-badge';
  flutuante.textContent = 'ZF';
  flutuante.title = 'Abrir Painel ZapFlow AI (WA Web Plus™) [Alt+W]';
  flutuante.onclick = alternarModal;
  document.documentElement.appendChild(flutuante);

  // 2. Injetar Botão no Topo do WhatsApp Web
  function injetarBotaoHeader() {
    if (document.getElementById('zf-header-button')) return;
    const header = document.querySelector('header');
    if (header) {
      const btn = document.createElement('button');
      btn.id = 'zf-header-button';
      btn.className = 'zf-header-btn';
      btn.innerHTML = '⚡ ZapFlow (WA Plus)';
      btn.title = 'Abrir Central ZapFlow AI [Alt+W]';
      btn.onclick = alternarModal;
      header.prepend(btn);
    }
  }

  // Observador para reinjetar se o WhatsApp re-renderizar
  const observer = new MutationObserver(() => {
    injetarBotaoHeader();
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Ouvinte de mensagens vindas do Background / Popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((req, sender, sendResp) => {
      if (req.action === 'toggleZapFlowPanel') {
        if (req.forceOpen) abrirModal();
        else alternarModal();
        sendResp({ ok: true });
      }
      return true;
    });
  }

  // Inicialização
  sincronizarStorage().then(() => {
    garantirAdmin();
    aplicarRegrasPrivacidade();
  });

})();
