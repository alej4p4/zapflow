// Captador de Leads: escaneia o WhatsApp Web e extrai números de telefone visíveis
(function () {
  'use strict';

  if (!/web\.whatsapp\.com/.test(location.hostname)) return;

  const TEL_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?\d{4,5}\-?\d{4}/g;

  function extrairNumeros() {
    const textos = Array.from(document.querySelectorAll('span, div, p'))
      .map(el => el.textContent || '')
      .join(' ');
    const encontrados = textos.match(TEL_RE) || [];
    const numeros = [];
    for (const tel of encontrados) {
      const n = tel.replace(/\D/g, '');
      if (n.length >= 10 && n.length <= 13 && !numeros.includes(n)) {
        numeros.push(n);
      }
    }
    return numeros;
  }

  // Expõe para o popup via message passing
  chrome.runtime.onMessage.addListener((req, sender, sendResp) => {
    if (req.action === 'extrairNumeros') {
      sendResp({ numeros: extrairNumeros() });
    }
  });

})();
