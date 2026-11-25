export const CHATBOT_FLOW_KEYWORD = "__CHATBOT_FLOW__";

export type FlowStepType = "message" | "collect_input" | "menu" | "handoff";

export interface FlowMenuOption {
    id: string;
    title: string;
    description?: string;
    nextStepId: string;
    /** If set to false, option is hidden from the menu (useful for off-duty/vacation) */
    enabled?: boolean;
}

export interface FlowStep {
    id: string;
    title: string;
    type: FlowStepType;
    /** Messages sent when entering this step (supports multiple short bubbles) */
    messages: string[];
    /** Variable name to store user's text or chosen option title (e.g. "nome_cliente", "setor") */
    saveToVar?: string;
    /** Next step ID for "message" and "collect_input" steps */
    nextStepId?: string;
    /** Menu button label for WhatsApp Interactive List (e.g. "Escolher Opções") */
    menuButtonText?: string;
    /** Menu options for "menu" steps */
    options?: FlowMenuOption[];
    /** Pause duration in minutes on "handoff" steps */
    handoffPauseMinutes?: number;
    /** Optional Kanban column / Label name to move the contact into when entering this step */
    kanbanLabelName?: string;
    /** Optional target WhatsApp JID (number@s.whatsapp.net or group@g.us) to send a notification alert to */
    notifyJid?: string;
    /** Optional additional target WhatsApp JIDs (e.g. group and individual analyst) */
    notifyJids?: string[];
    /** Optional message template to send to notifyJid / notifyJids */
    notifyMessage?: string;
}

export interface ChatbotFlowConfig {
    enabled: boolean;
    name: string;
    triggerMode: "ALWAYS_WHEN_IDLE" | "KEYWORD";
    triggerKeywords: string[];
    cooldownHours: number;
    stepTimeoutMinutes: number;
    menuStyle: "list" | "numbered";
    startStepId: string;
    steps: FlowStep[];
}

export const DEFAULT_RECEPTION_FLOW: ChatbotFlowConfig = {
    enabled: true,
    name: "Recepção Kerdole (Modelo do Vídeo)",
    triggerMode: "ALWAYS_WHEN_IDLE",
    triggerKeywords: ["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "menu"],
    cooldownHours: 1,
    stepTimeoutMinutes: 30,
    menuStyle: "numbered",
    startStepId: "step_ask_name",
    steps: [
        {
            id: "step_ask_name",
            title: "1. Saudação e Pergunta do Nome",
            type: "collect_input",
            messages: [
                "Olá! {saudacao}! 😊 tudo bem ?",
                "Seja bem-vindo ao {empresa}! 🏡",
                "Antes de começarmos, como posso te chamar? 🤔",
            ],
            saveToVar: "nome_cliente",
            nextStepId: "step_client_type",
            kanbanLabelName: "🆕 Novo Contato / Triagem",
        },
        {
            id: "step_client_type",
            title: "2. Já é cliente ou 1º contato?",
            type: "menu",
            messages: [
                "Perfeitoo!! 😊 {nome_cliente}\nAgora me conta...",
                "Você já é cliente da {empresa} ou está entrando em contato pela primeira vez?",
            ],
            saveToVar: "perfil_cliente",
            menuButtonText: "Escolher Opções",
            options: [
                {
                    id: "opt_existing",
                    title: "✅ Já sou cliente",
                    description: "",
                    nextStepId: "step_sector",
                },
                {
                    id: "opt_new",
                    title: "✨ É meu primeiro contato",
                    description: "",
                    nextStepId: "step_sector",
                },
            ],
        },
        {
            id: "step_sector",
            title: "3. Escolha do Setor / Serviço",
            type: "menu",
            messages: [
                "Otimo!!",
                "Quero entender melhor o que você procura para poder ajudar da melhor forma possível.\n\nEscolha por gentileza alguma das opções abaixo...",
            ],
            saveToVar: "setor",
            menuButtonText: "Escolher Opções",
            options: [
                {
                    id: "opt_locacao",
                    title: "🏡 LOCAÇÃO",
                    description: "Aluguel de Imóveis",
                    nextStepId: "step_locacao_perguntas",
                },
                {
                    id: "opt_compra",
                    title: "💰 COMPRA",
                    description: "Compra de Imóveis",
                    nextStepId: "step_compra_perguntas",
                },
                {
                    id: "opt_venda",
                    title: "🏷️ VENDA",
                    description: "Venda de Imóveis",
                    nextStepId: "step_venda_perguntas",
                },
                {
                    id: "opt_construir",
                    title: "🚧 CONSTRUIR, REFORMAR OU AMPLIAR",
                    description: "Construtora e Obras",
                    nextStepId: "step_construir_perguntas",
                },
                {
                    id: "opt_projetos",
                    title: "📐 PROJETOS E REGULARIZAÇÃO",
                    description: "Projetos e Documentação",
                    nextStepId: "step_projetos_perguntas",
                },
                {
                    id: "opt_moveis",
                    title: "🛋️ MÓVEIS PLANEJADOS",
                    description: "Móveis sob medida",
                    nextStepId: "step_moveis_perguntas",
                },
                {
                    id: "opt_equipe",
                    title: "👥 Falar com a equipe",
                    description: "Atendimento humano imediato",
                    nextStepId: "step_handoff",
                },
            ],
        },
        // ─── 4A. LOCAÇÃO (Perguntas Específicas) ───
        {
            id: "step_locacao_perguntas",
            title: "4A. Locação - Perguntas de Perfil",
            type: "collect_input",
            messages: [
                "Ótima escolha! 🏡\nPara te ajudarmos a encontrar o imóvel ideal para locação, por favor responda:\n\n1. Em qual bairro ou região você gostaria de morar?\n2. Qual faixa de valor você pretende pagar de aluguel?\n3. Que tipo de imóvel você procura? (casa / apartamento / kitnet / comercial)\n4. Se tiver alguma preferência específica, pode me informar também...\n\nVocê pode me mandar tudo em uma única mensagem aqui embaixo 👇",
            ],
            saveToVar: "detalhes_locacao",
            nextStepId: "step_handoff_locacao",
            kanbanLabelName: "🏠 Locação / Triagem",
        },
        // ─── 4B. COMPRA (Perguntas Específicas) ───
        {
            id: "step_compra_perguntas",
            title: "4B. Compra - Perguntas de Perfil",
            type: "collect_input",
            messages: [
                "Excelente decisão! 🏡✨\nPara entendermos seu momento e te apresentarmos as melhores opções de compra:\n\n1. Pretende comprar com recurso próprio ou pelo Financiamento Habitacional?\n2. Se for financiamento, já conhece os critérios para aprovação de crédito? Tem algum profissional já te acompanhando neste processo?\n3. Gostaria de fazer sua simulação e conhecer as melhores condições para seu perfil?\n\nPode responder tudo aqui em uma mensagem 👇",
            ],
            saveToVar: "detalhes_compra",
            nextStepId: "step_handoff_compra",
            kanbanLabelName: "💰 Compra / Triagem",
        },
        // ─── 4C. VENDA (Perguntas Específicas) ───
        {
            id: "step_venda_perguntas",
            title: "4C. Venda - Perguntas do Imóvel",
            type: "collect_input",
            messages: [
                "Será um prazer ajudar você a vender seu imóvel com segurança e tranquilidade!! 🤝✨\n\nPara entendermos melhor, por favor responda algumas perguntas:\n\n1. Qual a localização do imóvel (bairro e cidade)?\n2. Qual tipo de imóvel? (casa, apartamento, terreno, comercial, outros)\n3. A documentação do imóvel está regularizada?\n4. O imóvel possui algum financiamento ou dívida?\n5. Qual a área do terreno e a área construída?\n6. Qual valor você pretende pedir pelo imóvel?\n7. Me passe a descrição do imóvel.\n8. Você já possui fotos e vídeos recentes do imóvel?\n\nPode me enviar as respostas aqui 👇",
            ],
            saveToVar: "detalhes_venda",
            nextStepId: "step_handoff_venda",
            kanbanLabelName: "🏷️ Venda / Triagem",
        },
        // ─── 4D. CONSTRUIR / REFORMAR ───
        {
            id: "step_construir_perguntas",
            title: "4D. Construir / Reformar - Perguntas",
            type: "collect_input",
            messages: [
                "Perfeito, {nome_cliente}! 🚧\nPara agilizar seu atendimento com nossa construtora, pode escrever aqui em uma mensagem o que você gostaria de construir, reformar ou ampliar (tipo de obra, localização e tamanho aproximado) 👇",
            ],
            saveToVar: "detalhes_construcao",
            nextStepId: "step_handoff",
            kanbanLabelName: "🚧 Construtora / Triagem",
        },
        // ─── 4E. PROJETOS E REGULARIZAÇÃO ───
        {
            id: "step_projetos_perguntas",
            title: "4E. Projetos - Perguntas",
            type: "collect_input",
            messages: [
                "Perfeito, {nome_cliente}! 📐\nPara agilizar seu atendimento em projetos e documentação, nos conte aqui em uma mensagem qual tipo de projeto ou regularização você precisa para seu imóvel 👇",
            ],
            saveToVar: "detalhes_projetos",
            nextStepId: "step_handoff",
            kanbanLabelName: "📐 Projetos / Triagem",
        },
        // ─── 4F. MÓVEIS PLANEJADOS ───
        {
            id: "step_moveis_perguntas",
            title: "4F. Móveis Planejados - Perguntas",
            type: "collect_input",
            messages: [
                "Perfeito, {nome_cliente}! 🛋️\nPara planejarmos seus ambientes sob medida, nos conte aqui em uma mensagem quais cômodos ou móveis você deseja planejar 👇",
            ],
            saveToVar: "detalhes_moveis",
            nextStepId: "step_handoff",
            kanbanLabelName: "🛋️ Móveis / Triagem",
        },
        // ─── 5A. Handoff Específico Locação ───
        {
            id: "step_handoff_locacao",
            title: "5A. Finalização - Locação",
            type: "handoff",
            messages: [
                "😁 Perfeito, {nome_cliente}!\nNossa equipe de *LOCAÇÃO* já recebeu todas as suas preferências e em instantes um atendente dará continuidade ao seu atendimento.\n\nObrigado pela confiança! 💙",
            ],
            handoffPauseMinutes: 60,
            kanbanLabelName: "🏠 Locação / Em Atendimento",
        },
        // ─── 5B. Handoff Específico Compra ───
        {
            id: "step_handoff_compra",
            title: "5B. Finalização - Compra",
            type: "handoff",
            messages: [
                "😁 Perfeito, {nome_cliente}!\nNossa equipe já recebeu suas respostas sobre *COMPRA* e em instantes um especialista entrará em contato para te apresentar as melhores opções e simulações.\n\nObrigado pela confiança! 💙",
            ],
            handoffPauseMinutes: 60,
            kanbanLabelName: "💰 Compra / Em Atendimento",
        },
        // ─── 5C. Handoff Específico Venda ───
        {
            id: "step_handoff_venda",
            title: "5C. Finalização - Venda",
            type: "handoff",
            messages: [
                "😁 Perfeito, {nome_cliente}!\nRecebemos todas as informações do seu imóvel para *VENDA*. Nossa equipe de corretores já está avaliando os dados e em instantes falará com você!\n\nObrigado pela confiança! 💙",
            ],
            handoffPauseMinutes: 60,
            kanbanLabelName: "🏷️ Venda / Em Atendimento",
        },
        // ─── 5D. Handoff Geral ───
        {
            id: "step_handoff",
            title: "5D. Encaminhar para Atendente Humano",
            type: "handoff",
            messages: [
                "😁 Perfeito!\nNossa equipe já recebeu suas informações ({nome_cliente} - {setor}) e em instantes dará continuidade ao seu atendimento.\n\nObrigado pela confiança! 💙",
            ],
            handoffPauseMinutes: 60,
            kanbanLabelName: "💬 Em Atendimento",
        },
    ],
};

export function applyFlowVariables(
    template: string,
    vars: Record<string, string>,
    context: { greeting: string; botName: string; pushName: string }
): string {
    const fallbackName = vars.nome_cliente || context.pushName || "cliente";
    const firstName = fallbackName.trim().split(/\s+/)[0] || "cliente";
    // Normalize any legacy double curly braces {{var}} to {var} first
    let result = template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, "{$1}")
        .replace(/\{saudacao\}/gi, context.greeting)
        .replace(/\{empresa\}/gi, context.botName || "ZapFlow")
        .replace(/\{nome_completo\}/gi, context.pushName || fallbackName)
        .replace(/\{primeiro_nome\}/gi, firstName)
        .replace(/\{nome\}/gi, fallbackName);

    for (const [k, v] of Object.entries(vars)) {
        if (!k) continue;
        const safeRegex = new RegExp(`\\{${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "gi");
        result = result.replace(safeRegex, v || "");
    }
    return result;
}
