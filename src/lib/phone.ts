/**
 * Extrai o JID ou número de telefone de uma linha de destinatário que pode conter o nome do grupo ou contato.
 * Se a linha contiver apenas o nome do grupo ou contato (sem JID/número explícito), retorna o próprio nome
 * para que seja resolvido pelo catálogo de grupos/contatos da sessão.
 */
export function extractRecipientTarget(raw: string | null | undefined): string {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return "";

    // 1. Group JID inside line (ends with @g.us)
    const gMatch = trimmed.match(/([0-9\-_]+@g\.us)/i);
    if (gMatch && gMatch[1]) return gMatch[1];

    // 2. User JID inside line (ends with @s.whatsapp.net)
    const uMatch = trimmed.match(/(\d+@s\.whatsapp\.net)/i);
    if (uMatch && uMatch[1]) return uMatch[1];

    // 3. Number in parentheses or brackets at the end: (55...), <55...>, [55...]
    const bracketMatch = trimmed.match(/[<(\[]\s*([0-9+\-\s]{8,20})\s*[>)\]]\s*$/);
    if (bracketMatch && bracketMatch[1]) {
        const d = String(bracketMatch[1]).replace(/\D/g, "");
        if (d.length >= 8) return d;
    }

    // 4. Pure phone number (no letters, at least 8 digits)
    if (!/[a-zA-Z]/.test(trimmed) && !trimmed.includes("@")) {
        const digits = trimmed.replace(/\D/g, "");
        if (digits.length >= 8) return digits;
    }

    return trimmed;
}

/**
 * Normaliza o destinatário para um JID do WhatsApp quando já é um JID ou número de telefone.
 * Número digitado só com DDD (10-11 dígitos) recebe o código do Brasil (55) —
 * sem isso o WhatsApp aceita o envio e a mensagem nunca chega ao cliente.
 */
export function toWhatsAppJid(raw: string | null | undefined): string {
    const target = extractRecipientTarget(raw).trim();
    if (!target) return "";

    if (target.includes("@")) {
        const at = target.indexOf("@");
        const suffix = target.slice(at);
        if (suffix !== "@s.whatsapp.net") return target;

        const digits = target.slice(0, at).replace(/\D/g, "").replace(/^0+/, "");
        if (!digits) return target;
        const withCountry = digits.length <= 11 ? `55${digits}` : digits;
        return `${withCountry}${suffix}`;
    }

    // Se contém letras e não possui @, é um nome puro de grupo/contato (deve ser resolvido pelo mapa de nomes)
    if (/[a-zA-Z]/.test(target)) {
        return "";
    }

    const digits = target.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length < 8) return "";
    const withCountry = digits.length <= 11 ? `55${digits}` : digits;
    return `${withCountry}@s.whatsapp.net`;
}

/** Remove acentos e caixa para busca ("João" casa com "joao"). */
export function normalizeSearch(text: string | null | undefined): string {
    return String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

/**
 * Formata um JID ou número de telefone para o padrão visual brasileiro do WhatsApp:
 * Exemplos:
 * 5566996941055@s.whatsapp.net -> +55 (66) 99694-1055
 * 556696876005@s.whatsapp.net -> +55 (66) 99687-6005 (auto-completa o nono dígito 9 do celular)
 * 556634011234 -> +55 (66) 3401-1234 (telefone fixo)
 * 66996941055 -> (66) 99694-1055
 * 6696876005 -> (66) 99687-6005
 * 266867927216313@lid -> Contato WhatsApp (identificador de privacidade do WhatsApp)
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
    if (!raw) return "";
    const str = String(raw).trim();
    if (!str) return "";

    // Grupos
    if (str.endsWith("@g.us")) {
        return "Grupo do WhatsApp";
    }

    // Canais / Newsletters
    if (str.endsWith("@newsletter")) {
        return "Canal do WhatsApp";
    }

    // Se é LID explícito (@lid) ou número de 14-16 dígitos sem DDI conhecido (LID órfão)
    const isLid = str.endsWith("@lid") || str.includes("@lid");
    const clean = str.split('@')[0].replace(/\D/g, "");
    if (!clean) return str;

    if (isLid || (clean.length >= 14 && clean.length <= 16 && !clean.startsWith("55"))) {
        return "Contato WhatsApp";
    }

    // Brasil com DDI 55 (12 ou 13 dígitos)
    if (clean.startsWith("55") && clean.length >= 12 && clean.length <= 13) {
        const ddd = clean.slice(2, 4);
        const rest = clean.slice(4);

        // Celular padrão com 9 dígitos
        if (rest.length === 9) {
            return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
        }

        // 8 dígitos: celular (começa com 6, 7, 8, 9) ou fixo (2, 3, 4, 5)
        if (rest.length === 8) {
            const firstDigit = rest[0];
            if (['6', '7', '8', '9'].includes(firstDigit)) {
                // Celular com 9º dígito normalizado
                return `+55 (${ddd}) 9${rest.slice(0, 4)}-${rest.slice(4)}`;
            } else {
                // Telefone fixo
                return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
            }
        }

        return `+55 (${ddd}) ${rest}`;
    }

    // Brasil sem DDI (10 ou 11 dígitos)
    if (clean.length === 11) {
        const ddd = clean.slice(0, 2);
        const rest = clean.slice(2);
        return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (clean.length === 10) {
        const ddd = clean.slice(0, 2);
        const rest = clean.slice(2);
        const firstDigit = rest[0];
        if (['6', '7', '8', '9'].includes(firstDigit)) {
            return `(${ddd}) 9${rest.slice(0, 4)}-${rest.slice(4)}`;
        } else {
            return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
        }
    }

    // Outros países: prefixar com +
    return clean.length >= 8 ? `+${clean}` : clean;
}
