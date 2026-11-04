/**
 * Normaliza o destinatário para um JID do WhatsApp.
 * Número digitado só com DDD (10-11 dígitos) recebe o código do Brasil (55) —
 * sem isso o WhatsApp aceita o envio e a mensagem nunca chega ao cliente.
 */
export function toWhatsAppJid(raw: string): string {
    const value = raw.trim();
    const at = value.indexOf("@");
    const suffix = at >= 0 ? value.slice(at) : "@s.whatsapp.net";
    // Grupos e outros JIDs não são números de telefone: deixar como vieram.
    if (suffix !== "@s.whatsapp.net") return value;

    const digits = value.slice(0, at >= 0 ? at : undefined).replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) return value;
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
