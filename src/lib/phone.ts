/**
 * Extrai o JID ou número de telefone de uma linha de destinatário que pode conter o nome do grupo ou contato.
 * Exemplos aceitos:
 * - "Grupo Cotações Soja (120363377785922974@g.us)" -> "120363377785922974@g.us"
 * - "Grupo Cotações <120363377785922974@g.us>" -> "120363377785922974@g.us"
 * - "Produtores (556696692215-1626203007@g.us)" -> "556696692215-1626203007@g.us"
 * - "120363377785922974@g.us" -> "120363377785922974@g.us"
 * - "João Silva (66999999999)" -> "66999999999"
 * - "Maria <5511988887777>" -> "5511988887777"
 * - "Carlos - 5511977776666" -> "5511977776666"
 * - "5511999999999" -> "5511999999999"
 */
export function extractRecipientTarget(raw: string): string {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";

    // 1. Group JID inside line (ends with @g.us)
    const gMatch = trimmed.match(/([0-9\-]+@g\.us)/i);
    if (gMatch) return gMatch[1];

    // 2. User JID inside line (ends with @s.whatsapp.net)
    const uMatch = trimmed.match(/(\d+@s\.whatsapp\.net)/i);
    if (uMatch) return uMatch[1];

    // 3. Number in parentheses or brackets: (55...), <55...>, [55...]
    const bracketMatch = trimmed.match(/[<(\[]\s*([0-9+]+)\s*[>)\]]/);
    if (bracketMatch) return bracketMatch[1];

    // 4. Name - Number or Name: Number
    const parts = trimmed.split(/[-:]/);
    if (parts.length > 1) {
        const last = parts[parts.length - 1].trim().replace(/\D/g, "");
        if (last.length >= 8) return last;
    }

    // 5. If no @, strip non-digits
    if (!trimmed.includes("@")) {
        const digits = trimmed.replace(/\D/g, "");
        if (digits) return digits;
    }

    return trimmed;
}

/**
 * Normaliza o destinatário para um JID do WhatsApp.
 * Suporta linhas com nome (ex: "Grupo Exemplo (120363...@g.us)" ou "Fulano (11999999999)").
 * Número digitado só com DDD (10-11 dígitos) recebe o código do Brasil (55) —
 * sem isso o WhatsApp aceita o envio e a mensagem nunca chega ao cliente.
 */
export function toWhatsAppJid(raw: string): string {
    const target = extractRecipientTarget(raw).trim();
    if (!target) return "";

    const at = target.indexOf("@");
    const suffix = at >= 0 ? target.slice(at) : "@s.whatsapp.net";
    // Grupos e outros JIDs não são números de telefone: deixar como vieram.
    if (suffix !== "@s.whatsapp.net") return target;

    const digits = target.slice(0, at >= 0 ? at : undefined).replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) return target;
    const withCountry = digits.length <= 11 ? `55${digits}` : digits;
    return `${withCountry}${suffix}`;
}

/** Remove acentos e caixa para busca ("João" casa com "joao"). */
export function normalizeSearch(text: string | null | undefined): string {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
