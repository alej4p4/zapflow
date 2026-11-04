// ============================================================
// ZAPFLOW AI — Background Service Worker (Estilo WA Web Plus™)
// ============================================================

const WA_URL = 'https://web.whatsapp.com/';

// Atualiza o comportamento do ícone dependendo da aba ativa
async function atualizarComportamentoAba(tabId, url) {
  if (!url) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab?.url || '';
    } catch {
      return;
    }
  }

  if (url.startsWith(WA_URL)) {
    // Na aba do WhatsApp Web: desativa o popup flutuante para que o clique
    // abra diretamente o modal integrado na tela (estilo WA Web Plus)
    chrome.action.setPopup({ tabId, popup: '' }).catch(() => {});
  } else {
    // Em outras abas (ex: Nova Guia): ativa o popup com dimensões fixas 800x600
    chrome.action.setPopup({ tabId, popup: 'popup.html' }).catch(() => {});
  }
}

// Ao trocar de aba
chrome.tabs.onActivated.addListener((activeInfo) => {
  atualizarComportamentoAba(activeInfo.tabId);
});

// Ao navegar/atualizar a aba
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    atualizarComportamentoAba(tabId, tab.url);
  }
});

// Ao clicar no ícone quando o popup está desativado (na aba do WhatsApp Web)
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.url && tab.url.startsWith(WA_URL)) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleZapFlowPanel' }).catch(() => {});
    } else {
      // Procura WhatsApp Web aberto
      const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      if (abas.length > 0) {
        await chrome.tabs.update(abas[0].id, { active: true });
        if (abas[0].windowId) {
          await chrome.windows.update(abas[0].windowId, { focused: true });
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(abas[0].id, { action: 'toggleZapFlowPanel', forceOpen: true }).catch(() => {});
        }, 300);
      } else {
        await chrome.tabs.create({ url: WA_URL });
      }
    }
  } catch (err) {
    chrome.tabs.create({ url: WA_URL });
  }
});
