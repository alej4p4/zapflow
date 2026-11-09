"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FileText, Code, ExternalLink } from "lucide-react";

export default function ApiDocsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [filter, setFilter] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("Todos");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    const apiEndpoints = [
        // Sessions
        { category: "Sessions", method: "GET", path: "/api/sessions", description: "List all sessions", params: "-" },
        { category: "Sessions", method: "POST", path: "/api/sessions", description: "Create new session", params: "Body: { name, sessionId }" },
        { category: "Sessions", method: "GET", path: "/api/sessions/[sessionId]", description: "Get session details", params: "Path: sessionId" },
        { category: "Sessions", method: "GET", path: "/api/sessions/[sessionId]/qr", description: "Get QR code", params: "Path: sessionId" },
        { category: "Sessions", method: "GET", path: "/api/sessions/[sessionId]/bot-config", description: "Get bot config", params: "Path: sessionId" },
        { category: "Sessions", method: "POST", path: "/api/sessions/[sessionId]/bot-config", description: "Update bot config", params: "Path: sessionId, Body: { enabled, botMode, ... }" },
        { category: "Sessions", method: "PATCH", path: "/api/sessions/[sessionId]/settings", description: "Update settings", params: "Path: sessionId, Body: { config }" },
        { category: "Sessions", method: "DELETE", path: "/api/sessions/[sessionId]/settings", description: "Delete session", params: "Path: sessionId" },
        { category: "Sessions", method: "POST", path: "/api/sessions/[sessionId]/[action]", description: "Control session", params: "Path: sessionId, action (start|stop|restart|logout)" },

        // Groups
        { category: "Groups", method: "GET", path: "/api/groups/[sessionId]", description: "List groups", params: "Path: sessionId" },
        { category: "Groups", method: "POST", path: "/api/groups/[sessionId]/create", description: "Create group", params: "Path: sessionId, Body: { subject, participants }" },
        { category: "Groups", method: "POST", path: "/api/groups/[sessionId]/invite/accept", description: "Accept invite", params: "Path: sessionId, Body: { code }" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/picture", description: "Update group picture", params: "Path: sessionId, jid, Body: { file } (multipart/form-data)" },
        { category: "Groups", method: "DELETE", path: "/api/groups/[sessionId]/[jid]/picture", description: "Remove group picture", params: "Path: sessionId, jid" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/subject", description: "Update group name", params: "Path: sessionId, jid, Body: { subject }" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/description", description: "Update description", params: "Path: sessionId, jid, Body: { description }" },
        { category: "Groups", method: "GET", path: "/api/groups/[sessionId]/[jid]/invite", description: "Get invite code", params: "Path: sessionId, jid" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/invite/revoke", description: "Revoke invite", params: "Path: sessionId, jid" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/members", description: "Manage members", params: "Path: sessionId, jid, Body: { action, participants }" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/settings", description: "Update settings", params: "Path: sessionId, jid, Body: { settings }" },
        { category: "Groups", method: "PUT", path: "/api/groups/[sessionId]/[jid]/ephemeral", description: "Toggle disappearing", params: "Path: sessionId, jid, Body: { ephemeral }" },
        { category: "Groups", method: "POST", path: "/api/groups/[sessionId]/[jid]/leave", description: "Leave group", params: "Path: sessionId, jid" },

        // Groups (Legacy)
        { category: "Groups", method: "GET", path: "/api/groups", description: "List groups [DEPRECATED]", params: "Query: sessionId" },
        { category: "Groups", method: "POST", path: "/api/groups/create", description: "Create group [DEPRECATED]", params: "Body: { sessionId, subject, participants }" },
        { category: "Groups", method: "POST", path: "/api/groups/invite/accept", description: "Accept invite [DEPRECATED]", params: "Body: { sessionId, code }" },

        // Profile
        { category: "Profile", method: "GET", path: "/api/profile/[sessionId]", description: "Get own profile", params: "Path: sessionId" },
        { category: "Profile", method: "PUT", path: "/api/profile/[sessionId]/name", description: "Update name", params: "Path: sessionId, Body: { name }" },
        { category: "Profile", method: "PUT", path: "/api/profile/[sessionId]/status", description: "Update status", params: "Path: sessionId, Body: { status }" },
        { category: "Profile", method: "PUT", path: "/api/profile/[sessionId]/picture", description: "Update picture", params: "Path: sessionId, Body: { image } (multipart/form-data)" },
        { category: "Profile", method: "DELETE", path: "/api/profile/[sessionId]/picture", description: "Remove picture", params: "Path: sessionId" },

        // Profile (Legacy)
        { category: "Profile", method: "GET", path: "/api/profile", description: "Get profile [DEPRECATED]", params: "Query: sessionId" },
        { category: "Profile", method: "PUT", path: "/api/profile/name", description: "Update name [DEPRECATED]", params: "Body: { sessionId, name }" },
        { category: "Profile", method: "PUT", path: "/api/profile/picture", description: "Update picture [DEPRECATED]", params: "Body: { sessionId, image }" },
        { category: "Profile", method: "DELETE", path: "/api/profile/picture", description: "Remove picture [DEPRECATED]", params: "Body: { sessionId }" },
        { category: "Profile", method: "PUT", path: "/api/profile/status", description: "Update status [DEPRECATED]", params: "Body: { sessionId, status }" },

        // Messaging
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/send", description: "Send message", params: "Path: sessionId, jid, Body: { message }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/list", description: "Send list message", params: "Path: sessionId, jid, Body: { ... }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/location", description: "Send location", params: "Path: sessionId, jid, Body: { location }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/poll", description: "Send poll", params: "Path: sessionId, jid, Body: { poll }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/spam", description: "Report spam", params: "Path: sessionId, jid" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/sticker", description: "Send sticker", params: "Path: sessionId, jid, Body: { file, pack, author, type, quality } (multipart/form-data)" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/[messageId]/react", description: "Send reaction", params: "Path: sessionId, jid, messageId" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/contact", description: "Send contact", params: "Path: sessionId, jid, Body: { vcard }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/[jid]/forward", description: "Forward message", params: "Path: sessionId, jid, Body: { messageId }" },
        { category: "Messaging", method: "POST", path: "/api/messages/[sessionId]/broadcast", description: "Broadcast message", params: "Path: sessionId, Body: { recipients[], message, delay }" },
        { category: "Messaging", method: "GET", path: "/api/messages/[sessionId]/broadcast/history", description: "Get broadcast history", params: "Path: sessionId, Query: limit, offset" },
        { category: "Messaging", method: "GET", path: "/api/messages/[sessionId]/broadcast/history/[logId]", description: "Get broadcast detail", params: "Path: sessionId, logId" },
        { category: "Messaging", method: "DELETE", path: "/api/messages/[sessionId]/[jid]/[messageId]", description: "Delete message", params: "Path: sessionId, jid, messageId" },

        { category: "Messaging", method: "GET", path: "/api/messages/[sessionId]/download/[messageId]/media", description: "Download media", params: "Path: sessionId, messageId" },
        { category: "Messaging", method: "GET", path: "/api/media/[filename]", description: "Serve media file", params: "Path: filename" },

        // Messaging (Legacy)
        { category: "Messaging", method: "POST", path: "/api/messages/broadcast", description: "Broadcast message [DEPRECATED]", params: "Body: { sessionId, jids[], message }" },
        { category: "Messaging", method: "POST", path: "/api/messages/contact", description: "Send contact [DEPRECATED]", params: "Body: { sessionId, jid, vcard }" },
        { category: "Messaging", method: "DELETE", path: "/api/messages/delete", description: "Delete message [DEPRECATED]", params: "Body: { sessionId, jid, messageId }" },
        { category: "Messaging", method: "POST", path: "/api/messages/forward", description: "Forward message [DEPRECATED]", params: "Body: { sessionId, jid, messageId }" },
        { category: "Messaging", method: "POST", path: "/api/messages/list", description: "Send list message [DEPRECATED]", params: "Body: { sessionId, jid, ... }" },
        { category: "Messaging", method: "POST", path: "/api/messages/location", description: "Send location [DEPRECATED]", params: "Body: { sessionId, jid, location }" },
        { category: "Messaging", method: "POST", path: "/api/messages/poll", description: "Send poll [DEPRECATED]", params: "Body: { sessionId, jid, poll }" },
        { category: "Messaging", method: "POST", path: "/api/messages/react", description: "Send reaction [DEPRECATED]", params: "Body: { sessionId, jid, reaction }" },
        { category: "Messaging", method: "POST", path: "/api/messages/spam", description: "Report spam [DEPRECATED]", params: "Body: { sessionId, jid }" },
        { category: "Messaging", method: "POST", path: "/api/messages/sticker", description: "Send sticker [DEPRECATED]", params: "Body: { sessionId, jid, sticker }" },

        // Chat
        { category: "Chat", method: "GET", path: "/api/chat/[sessionId]", description: "Get chats", params: "Path: sessionId, Query: page, limit" },
        { category: "Chat", method: "GET", path: "/api/chat/[sessionId]/[jid]", description: "Get specific chat", params: "Path: sessionId, jid, Query: limit" },
        { category: "Chat", method: "POST", path: "/api/chat/[sessionId]/check", description: "Check WhatsApp numbers", params: "Path: sessionId, Body: { phones[] }" },
        { category: "Chat", method: "PUT", path: "/api/chat/[sessionId]/[jid]/read", description: "Mark as read", params: "Path: sessionId, jid" },
        { category: "Chat", method: "POST", path: "/api/chat/[sessionId]/[jid]/archive", description: "Archive chat", params: "Path: sessionId, jid, Body: { archive }" },
        { category: "Chat", method: "POST", path: "/api/chat/[sessionId]/[jid]/presence", description: "Send presence", params: "Path: sessionId, jid, Body: { presence }" },
        { category: "Chat", method: "POST", path: "/api/chat/[sessionId]/[jid]/profile-picture", description: "Get profile picture", params: "Path: sessionId, jid" },
        { category: "Chat", method: "PUT", path: "/api/chat/[sessionId]/[jid]/mute", description: "Mute chat", params: "Path: sessionId, jid, Body: { mute }" },
        { category: "Chat", method: "PUT", path: "/api/chat/[sessionId]/[jid]/pin", description: "Pin chat", params: "Path: sessionId, jid, Body: { pin }" },
        { category: "Chat", method: "GET", path: "/api/chats/[sessionId]/by-label/[labelId]", description: "Filter by label", params: "Path: sessionId, labelId" },

        // Chat (Legacy)
        { category: "Chat", method: "POST", path: "/api/chat/[sessionId]/send", description: "Send message [DEPRECATED]", params: "Path: sessionId, Body: { jid, message }" },
        { category: "Chat", method: "PUT", path: "/api/chat/archive", description: "Archive chat [DEPRECATED]", params: "Body: { sessionId, jid, archive }" },
        { category: "Chat", method: "POST", path: "/api/chat/check", description: "Check WhatsApp numbers [DEPRECATED]", params: "Body: { sessionId, phones[] }" },
        { category: "Chat", method: "PUT", path: "/api/chat/mute", description: "Mute chat [DEPRECATED]", params: "Body: { sessionId, jid, mute }" },
        { category: "Chat", method: "PUT", path: "/api/chat/pin", description: "Pin chat [DEPRECATED]", params: "Body: { sessionId, jid, pin }" },
        { category: "Chat", method: "POST", path: "/api/chat/presence", description: "Send presence [DEPRECATED]", params: "Body: { sessionId, jid, presence }" },
        { category: "Chat", method: "POST", path: "/api/chat/profile-picture", description: "Get profile picture [DEPRECATED]", params: "Body: { sessionId, jid }" },
        { category: "Chat", method: "PUT", path: "/api/chat/read", description: "Mark as read [DEPRECATED]", params: "Body: { sessionId, jid }" },
        { category: "Chat", method: "POST", path: "/api/chat/send", description: "Send message [DEPRECATED]", params: "Body: { sessionId, jid, message }" },
        { category: "Chat", method: "GET", path: "/api/chats/by-label/[labelId]", description: "Filter by label [DEPRECATED]", params: "Path: labelId, Query: sessionId" },

        // Contacts
        { category: "Contacts", method: "GET", path: "/api/contacts/[sessionId]", description: "List contacts", params: "Path: sessionId, Query: search" },
        { category: "Contacts", method: "POST", path: "/api/contacts/[sessionId]/[jid]/block", description: "Block contact", params: "Path: sessionId, jid" },
        { category: "Contacts", method: "POST", path: "/api/contacts/[sessionId]/[jid]/unblock", description: "Unblock contact", params: "Path: sessionId, jid" },

        // Contacts (Legacy)
        { category: "Contacts", method: "GET", path: "/api/contacts", description: "List contacts [DEPRECATED]", params: "Query: search" },
        { category: "Contacts", method: "POST", path: "/api/contacts/block", description: "Block contact [DEPRECATED]", params: "Body: { sessionId, jid }" },
        { category: "Contacts", method: "POST", path: "/api/contacts/unblock", description: "Unblock contact [DEPRECATED]", params: "Body: { sessionId, jid }" },

        // Labels
        { category: "Labels", method: "GET", path: "/api/labels/[sessionId]", description: "List labels", params: "Path: sessionId" },
        { category: "Labels", method: "POST", path: "/api/labels/[sessionId]", description: "Create label", params: "Path: sessionId, Body: { name, color }" },
        { category: "Labels", method: "PUT", path: "/api/labels/[sessionId]/[id]", description: "Update label", params: "Path: sessionId, id, Body: { name, color }" },
        { category: "Labels", method: "DELETE", path: "/api/labels/[sessionId]/[id]", description: "Delete label", params: "Path: sessionId, id" },
        { category: "Labels", method: "GET", path: "/api/labels/[sessionId]/chat-labels/[jid]", description: "Get chat labels", params: "Path: sessionId, jid" },
        { category: "Labels", method: "PUT", path: "/api/labels/[sessionId]/chat-labels/[jid]", description: "Add/remove labels", params: "Path: sessionId, jid, Body: { labelIds[], action }" },

        // Labels (Legacy)
        { category: "Labels", method: "GET", path: "/api/labels", description: "List labels [DEPRECATED]", params: "Query: sessionId" },
        { category: "Labels", method: "POST", path: "/api/labels", description: "Create label [DEPRECATED]", params: "Body: { sessionId, name, color }" },
        { category: "Labels", method: "GET", path: "/api/labels/chat-labels", description: "Get chat labels [DEPRECATED]", params: "Query: sessionId, jid" },
        { category: "Labels", method: "PUT", path: "/api/labels/chat-labels", description: "Update chat labels [DEPRECATED]", params: "Body: { sessionId, jid, labelIds[], action }" },

        // Auto Reply
        { category: "Auto Reply", method: "GET", path: "/api/autoreplies/[sessionId]", description: "List auto replies", params: "Path: sessionId" },
        { category: "Auto Reply", method: "POST", path: "/api/autoreplies/[sessionId]", description: "Create auto reply", params: "Path: sessionId, Body: { keyword, response, matchType }" },
        { category: "Auto Reply", method: "GET", path: "/api/autoreplies/[sessionId]/[id]", description: "Get auto reply", params: "Path: sessionId, id" },
        { category: "Auto Reply", method: "PUT", path: "/api/autoreplies/[sessionId]/[id]", description: "Update auto reply", params: "Path: sessionId, id, Body: { ... }" },
        { category: "Auto Reply", method: "DELETE", path: "/api/autoreplies/[sessionId]/[id]", description: "Delete auto reply", params: "Path: sessionId, id" },

        // Auto Reply (Legacy)
        { category: "Auto Reply", method: "GET", path: "/api/autoreplies", description: "List auto replies [DEPRECATED]", params: "Query: sessionId" },
        { category: "Auto Reply", method: "POST", path: "/api/autoreplies", description: "Create auto reply [DEPRECATED]", params: "Body: { sessionId, keyword, ... }" },

        // Scheduler
        { category: "Scheduler", method: "GET", path: "/api/scheduler/[sessionId]", description: "List scheduled", params: "Path: sessionId" },
        { category: "Scheduler", method: "POST", path: "/api/scheduler/[sessionId]", description: "Create scheduled", params: "Path: sessionId, Body: { jid, content, sendAt }" },
        { category: "Scheduler", method: "GET", path: "/api/scheduler/[sessionId]/[id]", description: "Get scheduled", params: "Path: sessionId, id" },
        { category: "Scheduler", method: "PUT", path: "/api/scheduler/[sessionId]/[id]", description: "Update scheduled", params: "Path: sessionId, id, Body: { ... }" },
        { category: "Scheduler", method: "DELETE", path: "/api/scheduler/[sessionId]/[id]", description: "Delete scheduled", params: "Path: sessionId, id" },

        // Scheduler (Legacy)
        { category: "Scheduler", method: "GET", path: "/api/scheduler", description: "List scheduled [DEPRECATED]", params: "Query: sessionId" },
        { category: "Scheduler", method: "POST", path: "/api/scheduler", description: "Create scheduled [DEPRECATED]", params: "Body: { sessionId, content, ... }" },

        // Webhooks
        { category: "Webhooks", method: "GET", path: "/api/webhooks/[sessionId]", description: "List webhooks", params: "Path: sessionId" },
        { category: "Webhooks", method: "POST", path: "/api/webhooks/[sessionId]", description: "Create webhook", params: "Path: sessionId, Body: { name, url, events[] }" },
        { category: "Webhooks", method: "PUT", path: "/api/webhooks/[sessionId]/[id]", description: "Update webhook", params: "Path: sessionId, id, Body: { ... }" },
        { category: "Webhooks", method: "DELETE", path: "/api/webhooks/[sessionId]/[id]", description: "Delete webhook", params: "Path: sessionId, id" },

        // Webhooks (Legacy)
        { category: "Webhooks", method: "GET", path: "/api/webhooks", description: "List webhooks [DEPRECATED]", params: "Query: sessionId" },
        { category: "Webhooks", method: "POST", path: "/api/webhooks", description: "Create webhook [DEPRECATED]", params: "Body: { sessionId, url, ... }" },

        // Notifications
        { category: "Notifications", method: "GET", path: "/api/notifications", description: "List notifications", params: "-" },
        { category: "Notifications", method: "POST", path: "/api/notifications", description: "Create notification", params: "Body: { title, message, ... }" },
        { category: "Notifications", method: "PATCH", path: "/api/notifications/read", description: "Mark as read", params: "Body: { ids[] }" },
        { category: "Notifications", method: "DELETE", path: "/api/notifications/delete", description: "Delete notifications", params: "Query: id" },

        // Users
        { category: "Users", method: "GET", path: "/api/users", description: "List users", params: "-" },
        { category: "Users", method: "POST", path: "/api/users", description: "Create user", params: "Body: { name, email, password }" },
        { category: "Users", method: "GET", path: "/api/users/[id]", description: "Get user", params: "Path: id" },
        { category: "Users", method: "PATCH", path: "/api/users/[id]", description: "Update user", params: "Path: id, Body: { ... }" },
        { category: "Users", method: "DELETE", path: "/api/users/[id]", description: "Delete user", params: "Path: id" },
        { category: "Users", method: "GET", path: "/api/user/api-key", description: "Get API key", params: "-" },
        { category: "Users", method: "POST", path: "/api/user/api-key", description: "Generate API key", params: "-" },
        { category: "Users", method: "DELETE", path: "/api/user/api-key", description: "Revoke API key", params: "-" },

        // System
        { category: "System", method: "GET", path: "/api/settings/system", description: "Get system settings", params: "-" },
        { category: "System", method: "POST", path: "/api/settings/system", description: "Update system settings", params: "Body: { appName, logoUrl, timezone }" },
        { category: "System", method: "POST", path: "/api/status/[sessionId]/update", description: "Update status", params: "Path: sessionId, Body: { status }" },
        { category: "System", method: "GET", path: "/api/system/check-updates", description: "Check updates", params: "-" },
    ];


    const categoryNames: Record<string, string> = {
        Sessions: "Sessões", Groups: "Grupos", Profile: "Perfil", Messaging: "Mensagens",
        Chat: "Conversas", Contacts: "Contatos", Labels: "Etiquetas", "Auto Reply": "Respostas automáticas",
        Scheduler: "Agendamentos", Webhooks: "Webhooks", Notifications: "Notificações", Users: "Usuários", System: "Sistema",
    };
    const descriptions: Record<string, string> = {
        "Accept invite": "Aceitar convite", "Add/remove labels": "Adicionar/remover etiquetas", "Archive chat": "Arquivar conversa",
        "Block contact": "Bloquear contato", "Broadcast message": "Disparar mensagem em massa", "Check updates": "Verificar atualizações",
        "Check WhatsApp numbers": "Verificar números do WhatsApp", "Control session": "Controlar sessão", "Create auto reply": "Criar resposta automática",
        "Create group": "Criar grupo", "Create label": "Criar etiqueta", "Create new session": "Criar nova sessão", "Create notification": "Criar notificação",
        "Create scheduled": "Criar agendamento", "Create user": "Criar usuário", "Create webhook": "Criar webhook", "Delete auto reply": "Excluir resposta automática",
        "Delete label": "Excluir etiqueta", "Delete message": "Excluir mensagem", "Delete notifications": "Excluir notificações", "Delete scheduled": "Excluir agendamento",
        "Delete session": "Excluir sessão", "Delete user": "Excluir usuário", "Delete webhook": "Excluir webhook", "Download media": "Baixar mídia",
        "Filter by label": "Filtrar por etiqueta", "Forward message": "Encaminhar mensagem", "Generate API key": "Gerar chave da API", "Get API key": "Obter chave da API",
        "Get auto reply": "Obter resposta automática", "Get bot config": "Obter configuração do bot", "Get broadcast detail": "Obter detalhes do disparo",
        "Get broadcast history": "Obter histórico de disparos", "Get chat labels": "Obter etiquetas da conversa", "Get chats": "Obter conversas",
        "Get invite code": "Obter código do convite", "Get own profile": "Obter o próprio perfil", "Get profile": "Obter perfil", "Get profile picture": "Obter foto do perfil",
        "Get QR code": "Obter QR Code", "Get scheduled": "Obter agendamento", "Get session details": "Obter detalhes da sessão", "Get specific chat": "Obter conversa específica",
        "Get system settings": "Obter configurações do sistema", "Get user": "Obter usuário", "Leave group": "Sair do grupo", "List all sessions": "Listar todas as sessões",
        "List auto replies": "Listar respostas automáticas", "List contacts": "Listar contatos", "List groups": "Listar grupos", "List labels": "Listar etiquetas",
        "List notifications": "Listar notificações", "List scheduled": "Listar agendamentos", "List users": "Listar usuários", "List webhooks": "Listar webhooks",
        "Manage members": "Gerenciar participantes", "Mark as read": "Marcar como lida", "Mute chat": "Silenciar conversa", "Pin chat": "Fixar conversa",
        "Remove group picture": "Remover foto do grupo", "Remove picture": "Remover foto", "Report spam": "Denunciar spam", "Revoke API key": "Revogar chave da API",
        "Revoke invite": "Revogar convite", "Send contact": "Enviar contato", "Send list message": "Enviar mensagem em lista", "Send location": "Enviar localização",
        "Send message": "Enviar mensagem", "Send poll": "Enviar enquete", "Send presence": "Enviar presença", "Send reaction": "Enviar reação", "Send sticker": "Enviar figurinha",
        "Serve media file": "Disponibilizar arquivo de mídia", "Toggle disappearing": "Ativar/desativar mensagens temporárias", "Unblock contact": "Desbloquear contato",
        "Update auto reply": "Atualizar resposta automática", "Update bot config": "Atualizar configuração do bot", "Update chat labels": "Atualizar etiquetas da conversa",
        "Update description": "Atualizar descrição", "Update group name": "Atualizar nome do grupo", "Update group picture": "Atualizar foto do grupo", "Update label": "Atualizar etiqueta",
        "Update name": "Atualizar nome", "Update picture": "Atualizar foto", "Update scheduled": "Atualizar agendamento", "Update settings": "Atualizar configurações",
        "Update status": "Atualizar status", "Update system settings": "Atualizar configurações do sistema", "Update user": "Atualizar usuário", "Update webhook": "Atualizar webhook",
    };
    const translateDescription = (value: string) => {
        const deprecated = value.endsWith(" [DEPRECATED]");
        const base = deprecated ? value.slice(0, -13) : value;
        return `${descriptions[base] || base}${deprecated ? " [OBSOLETO]" : ""}`;
    };
    const translateParams = (value: string) => value.replaceAll("Path:", "Caminho:").replaceAll("Body:", "Corpo:").replaceAll("Query:", "Consulta:");
    const categories = ["Todos", ...Array.from(new Set(apiEndpoints.map(e => categoryNames[e.category] || e.category)))];

    const filteredEndpoints = apiEndpoints.filter(endpoint => {
        const matchesFilter = endpoint.path.toLowerCase().includes(filter.toLowerCase()) ||
            translateDescription(endpoint.description).toLowerCase().includes(filter.toLowerCase());
        const matchesCategory = selectedCategory === "Todos" || (categoryNames[endpoint.category] || endpoint.category) === selectedCategory;
        return matchesFilter && matchesCategory;
    });

    const getMethodColor = (method: string) => {
        switch (method) {
            case "GET": return "bg-green-100 text-green-800 border-green-300";
            case "POST": return "bg-blue-100 text-blue-800 border-blue-300";
            case "PUT": return "bg-yellow-100 text-yellow-800 border-yellow-300";
            case "PATCH": return "bg-orange-100 text-orange-800 border-orange-300";
            case "DELETE": return "bg-red-100 text-red-800 border-red-300";
            default: return "bg-gray-100 text-gray-800 border-gray-300";
        }
    };

    if (status === "loading") {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-gray-600">Carregando...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-background p-3 sm:p-6 text-foreground">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 sm:mb-8">
                    <div>
                        <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-foreground tracking-tight flex items-center gap-2">
                            <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                             Documentação da API
                        </h1>
                        <p className="text-gray-500 dark:text-muted-foreground mt-2">
                             Referência completa dos {apiEndpoints.length} endpoints da API.
                        </p>
                    </div>
                    <a
                        href="/docs"
                        target="_blank"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                        <Code className="w-4 h-4" />
                         Abrir Swagger UI
                        <ExternalLink className="w-4 h-4" />
                    </a>
                </div>

                {/* Master Documentation Alert */}
                <div className="bg-blue-50 dark:bg-blue-950/40 border-l-4 border-blue-500 p-4 rounded-r shadow-sm mb-6">
                    <div className="flex items-start">
                        <div className="flex-shrink-0">
                            <FileText className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">📘 Documentação do projeto disponível</h3>
                            <div className="mt-2 text-sm text-blue-700 dark:text-blue-400">
                                <p>
                                    Para detalhes sobre a <strong>arquitetura do projeto</strong>, o <strong>esquema do banco de dados</strong> e o <strong>roteamento do frontend</strong>,
                                    consulte a <a href="/docs/PROJECT_DOCUMENTATION.md" className="font-bold underline hover:text-blue-900 dark:hover:text-blue-200">documentação principal do projeto</a>.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Links */}
                <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-6 mb-6">
                    <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-foreground">Links rápidos</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <a
                            href="/docs"
                            target="_blank"
                            className="flex items-center p-4 border dark:border-[#2a3942] rounded-lg hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors group"
                        >
                            <Code className="w-10 h-10 text-blue-600 mr-4" />
                            <div className="flex-1">
                                <h3 className="font-medium text-gray-800 dark:text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400">Swagger UI</h3>
                                <p className="text-sm text-gray-600 dark:text-muted-foreground">Teste interativo da API</p>
                            </div>
                            <ExternalLink className="w-5 h-5 text-gray-400" />
                        </a>
                        <a
                            href="/api/docs"
                            target="_blank"
                            className="flex items-center p-4 border dark:border-[#2a3942] rounded-lg hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors group"
                        >
                            <FileText className="w-10 h-10 text-green-600 mr-4" />
                            <div className="flex-1">
                                <h3 className="font-medium text-gray-800 dark:text-foreground group-hover:text-green-600 dark:group-hover:text-green-400">Especificação OpenAPI</h3>
                                <p className="text-sm text-gray-600 dark:text-muted-foreground">Especificação JSON</p>
                            </div>
                            <ExternalLink className="w-5 h-5 text-gray-400" />
                        </a>
                        <div className="flex items-center p-4 border dark:border-[#2a3942] rounded-lg bg-gray-50 dark:bg-[#202c33]/50">
                            <div className="flex-1">
                                <h3 className="font-medium text-gray-800 dark:text-foreground">URL base</h3>
                                <p className="text-sm text-gray-600 dark:text-muted-foreground font-mono break-all">{process.env.NEXT_PUBLIC_API_URL || '/api'}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Buscar</label>
                            <input
                                type="text"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder="Buscar endpoints..."
                                className="w-full px-4 py-2 border dark:border-[#2a3942] bg-white dark:bg-[#202c33] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Categoria</label>
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full px-4 py-2 border dark:border-[#2a3942] bg-white dark:bg-[#202c33] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Endpoints List */}
                <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-[#2a3942]">
                            <thead className="bg-gray-50 dark:bg-[#202c33]">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Método</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parâmetros</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrição</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoria</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-[#111b21] divide-y divide-gray-200 dark:divide-[#2a3942]">
                                {filteredEndpoints.map((endpoint, index) => (
                                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-[#202c33]/60 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getMethodColor(endpoint.method)}`}>
                                                {endpoint.method}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <code className="text-sm text-gray-900 dark:text-[#00a884] font-mono">{endpoint.path}</code>
                                        </td>
                                        <td className="px-6 py-4 text-xs font-mono text-gray-600 dark:text-gray-300 max-w-xs break-words">
                                             {translateParams(endpoint.params || "-")}
                                        </td>
                                         <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{translateDescription(endpoint.description)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-[#202c33] text-gray-700 dark:text-gray-300 rounded border dark:border-[#2a3942]">
                                                 {categoryNames[endpoint.category] || endpoint.category}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filteredEndpoints.length === 0 && (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                             Nenhum endpoint corresponde aos critérios da busca.
                        </div>
                    )}
                </div>

                {/* Stats */}
                <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-4">
                        <div className="text-2xl font-bold text-blue-600">{apiEndpoints.length}</div>
                        <div className="text-sm text-gray-600 dark:text-muted-foreground">Total de endpoints</div>
                    </div>
                    <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-4">
                        <div className="text-2xl font-bold text-green-600">{categories.length - 1}</div>
                        <div className="text-sm text-gray-600 dark:text-muted-foreground">Categorias</div>
                    </div>
                    <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-4">
                        <div className="text-2xl font-bold text-yellow-600">{apiEndpoints.filter(e => e.method === "POST").length}</div>
                        <div className="text-sm text-gray-600 dark:text-muted-foreground">Endpoints POST</div>
                    </div>
                    <div className="bg-white dark:bg-[#111b21] dark:border dark:border-[#2a3942] rounded-lg shadow p-4">
                        <div className="text-2xl font-bold text-purple-600">{apiEndpoints.filter(e => e.method === "GET").length}</div>
                        <div className="text-sm text-gray-600 dark:text-muted-foreground">Endpoints GET</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
