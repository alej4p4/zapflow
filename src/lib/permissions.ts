export interface TabDefinition {
    path: string;
    label: string;
    category: "Principal" | "Mensagens" | "Contatos" | "Automação" | "Administração" | "Desenvolvedor";
    description: string;
    superadminOnly?: boolean;
}

export const SYSTEM_TABS: TabDefinition[] = [
    // Principal
    {
        path: "/dashboard",
        label: "Painel",
        category: "Principal",
        description: "Métricas ao vivo, gráfico de pico 24h, resumo do funil de vendas e atalhos rápidos"
    },
    {
        path: "/dashboard/sessions",
        label: "Sessões / QR",
        category: "Principal",
        description: "Conexão com WhatsApp Web, QR Code e gerenciamento de instâncias ativas"
    },

    // Mensagens
    {
        path: "/dashboard/chat",
        label: "Conversas",
        category: "Mensagens",
        description: "Atendimento ao cliente em tempo real, busca global de mensagens e envio de mídias"
    },
    {
        path: "/dashboard/kanban",
        label: "Kanban CRM",
        category: "Mensagens",
        description: "Quadro CRM em colunas com arrastar e soltar de contatos e funil de vendas"
    },
    {
        path: "/dashboard/broadcast",
        label: "Disparo em massa",
        category: "Mensagens",
        description: "Disparos programados para múltiplos contatos com intervalos anti-ban"
    },
    {
        path: "/dashboard/sticker",
        label: "Criador de figurinhas",
        category: "Mensagens",
        description: "Conversão e envio de imagens para figurinhas animadas do WhatsApp"
    },

    // Contatos
    {
        path: "/dashboard/contacts",
        label: "Contatos",
        category: "Contatos",
        description: "Cadastro de clientes, importação de agenda e exportação para CSV/Excel"
    },
    {
        path: "/dashboard/groups",
        label: "Grupos",
        category: "Contatos",
        description: "Gerenciamento de grupos do WhatsApp, listagem de participantes e links"
    },
    {
        path: "/dashboard/labels",
        label: "Etiquetas",
        category: "Contatos",
        description: "Etiquetas coloridas personalizadas para classificação e funil de leads"
    },

    // Automação
    {
        path: "/dashboard/bot-settings",
        label: "Configurações do bot",
        category: "Automação",
        description: "Configuração do bot, modelos pré-configurados e simulador de testes"
    },
    {
        path: "/dashboard/autoreply",
        label: "Respostas automáticas",
        category: "Automação",
        description: "Fluxos de autoatendimento e respostas por palavras-chave"
    },
    {
        path: "/dashboard/profile",
        label: "Perfil do bot",
        category: "Automação",
        description: "Foto de perfil, nome público e recado do WhatsApp"
    },
    {
        path: "/dashboard/scheduler",
        label: "Agendamentos",
        category: "Automação",
        description: "Programação de mensagens e lembretes para envio futuro automático"
    },
    {
        path: "/dashboard/webhooks",
        label: "Webhooks e API",
        category: "Automação",
        description: "Integração via Webhooks para eventos externos e sistemas de terceiros"
    },

    // Administração
    {
        path: "/dashboard/media",
        label: "Gerenciador de mídia",
        category: "Administração",
        description: "Visualização e limpeza de fotos, vídeos, áudios e PDFs salvos no servidor"
    },
    {
        path: "/dashboard/sessions/access",
        label: "Acesso às sessões",
        category: "Administração",
        description: "Permissões de quais atendentes podem ver e usar cada sessão do WhatsApp"
    },
    {
        path: "/dashboard/users",
        label: "Usuários & Perfis",
        category: "Administração",
        description: "Controle de usuários, senhas e permissões granulares por abas",
        superadminOnly: true
    },
    {
        path: "/dashboard/settings",
        label: "Configurações",
        category: "Administração",
        description: "Identidade visual do aplicativo, nome, logotipo e fuso horário"
    },
    {
        path: "/dashboard/system-monitor",
        label: "Monitor do sistema",
        category: "Administração",
        description: "Consumo de memória, status dos serviços e diagnóstico do servidor",
        superadminOnly: true
    },
    {
        path: "/dashboard/notifications",
        label: "Notificações",
        category: "Administração",
        description: "Histórico de alertas e eventos do sistema",
        superadminOnly: true
    }
];

// Presets for quick assignment
export const PERMISSION_PRESETS = [
    {
        id: "attendant",
        name: "Atendente Padrão",
        description: "Acesso às conversas, kanban, contatos e agendamentos",
        paths: [
            "/dashboard/chat",
            "/dashboard/kanban",
            "/dashboard/contacts",
            "/dashboard/labels",
            "/dashboard/scheduler"
        ]
    },
    {
        id: "marketing",
        name: "Marketing & Campanhas",
        description: "Acesso a disparos em massa, contatos, grupos e figurinhas",
        paths: [
            "/dashboard",
            "/dashboard/chat",
            "/dashboard/kanban",
            "/dashboard/broadcast",
            "/dashboard/contacts",
            "/dashboard/groups",
            "/dashboard/labels",
            "/dashboard/scheduler",
            "/dashboard/sticker"
        ]
    },
    {
        id: "manager",
        name: "Gerente Operacional",
        description: "Acesso completo ao painel, mensagens, automações e contatos",
        paths: [
            "/dashboard",
            "/dashboard/sessions",
            "/dashboard/chat",
            "/dashboard/kanban",
            "/dashboard/broadcast",
            "/dashboard/sticker",
            "/dashboard/contacts",
            "/dashboard/groups",
            "/dashboard/labels",
            "/dashboard/bot-settings",
            "/dashboard/autoreply",
            "/dashboard/profile",
            "/dashboard/scheduler",
            "/dashboard/media"
        ]
    },
    {
        id: "all",
        name: "Todas as Abas",
        description: "Marca acesso a todas as abas operacionais do sistema",
        paths: SYSTEM_TABS.map(t => t.path)
    }
];

/**
 * Checks whether a given path is allowed for a user.
 */
export function isRouteAllowed(
    pathname: string,
    role?: string | null,
    permissions?: string[] | null
): boolean {
    // SuperAdmin always has full access
    if (role === "SUPERADMIN") return true;

    // Check superadmin only routes
    const tabDef = SYSTEM_TABS.find(t => t.path === pathname || (t.path !== "/dashboard" && pathname.startsWith(t.path + "/")));
    if (tabDef?.superadminOnly && role !== "SUPERADMIN") {
        return false;
    }

    // If explicit permissions list exists
    if (Array.isArray(permissions)) {
        if (permissions.length === 0) return false;
        return permissions.some(allowedPath => {
            if (pathname === allowedPath) return true;
            if (allowedPath !== "/dashboard" && pathname.startsWith(allowedPath)) return true;
            return false;
        });
    }

    // Default permissions for OWNER / STAFF when not explicitly configured
    return true;
}
