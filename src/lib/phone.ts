/**
 * Extrai o JID ou número de telefone de uma linha de destinatário que pode conter o nome do grupo ou contato.
 * Se a linha contiver apenas o nome do grupo ou contato (sem JID/número explícito), retorna o próprio nome
 * para que seja resolvido pelo catálogo de grupos/contatos da sessão.
 */
export function extractRecipientTarget(raw: string): string {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";

    // 1. Group JID inside line (ends with @g.us)
    const gMatch = trimmed.match(/([0-9\-_]+@g\.us)/i);
    if (gMatch) return gMatch[1];

    // 2. User JID inside line (ends with @s.whatsapp.net)
    const uMatch = trimmed.match(/(\d+@s\.whatsapp\.net)/i);
    if (uMatch) return uMatch[1];

    // 3. Number in parentheses or brackets at the end: (55...), <55...>, [55...]
    const bracketMatch = trimmed.match(/[<(\[]\s*([0-9+\-\s]{8,20})\s*[>)\]]\s*$/);
    if (bracketMatch) {
        const d = bracketMatch[1].replace(/\D/g, "");
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
export function toWhatsAppJid(raw: string): string {
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
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
