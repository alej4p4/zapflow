const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SESSION_DB_ID = "cmwjmsdfu03rew2isouachz4m"; // Alexandre Daniel (sessionId: 1e754120)
const CHATBOT_FLOW_KEYWORD = "__CHATBOT_FLOW__";

const ANALYST_JIDS = {
  vinicius: "5566999583468@s.whatsapp.net",
  alexandre: "5566996175239@s.whatsapp.net",
  marcelo: "5566996692215@s.whatsapp.net",
  edvaldo: "5566996473868@s.whatsapp.net"
};

const OPERACAO_COFCO_GROUP_JID = "120363415606283620@g.us";

const transportFlow = {
  enabled: true,
  name: "Atendimento de Transporte - COFCO",
  triggerMode: "ALWAYS_WHEN_IDLE",
  triggerKeywords: ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "menu", "frete", "carga", "descarga", "ordem", "faturamento"],
  cooldownHours: 1,
  stepTimeoutMinutes: 30,
  menuStyle: "numbered",
  startStepId: "step_welcome",
  steps: [
    // ─── MENU PRINCIPAL ───
    {
      id: "step_welcome",
      title: "Menu Principal",
      type: "menu",
      messages: [
        "Olá! Seja bem-vindo ao atendimento de transporte.\n🇨🇳 *COFCO TRANSPORTES* 🇧🇷\n🇨🇳 *FILIAL BARRA DO GARÇAS-MT* 🇧🇷\n\nDigite o número da opção desejada:"
      ],
      saveToVar: "opcao_principal",
      menuButtonText: "Escolher Opção",
      options: [
        {
          id: "opt_ordem_carregamento",
          title: "1️⃣ Ordem de Carregamento",
          nextStepId: "step_ordem_frete"
        },
        {
          id: "opt_agendamento_descarga",
          title: "2️⃣ Agendamento de Descarga",
          nextStepId: "step_descarga_destino"
        },
        {
          id: "opt_faturamento_notas",
          title: "3️⃣ Faturamento de Notas",
          nextStepId: "step_faturamento_placa"
        },
        {
          id: "opt_falar_atendente",
          title: "4️⃣ Falar com um Atendente",
          nextStepId: "step_atendente_escolha"
        }
      ]
    },

    // ─── OPÇÃO 1: ORDEM DE CARREGAMENTO (TODOS OS DETALHES COMPLETOS) ───
    {
      id: "step_ordem_frete",
      title: "Ordem - Escolha do Frete",
      type: "menu",
      messages: [
        "Informe qual frete deseja carregar:\n\n*(Consulte abaixo os fretes disponíveis hoje com todos os detalhes)*"
      ],
      saveToVar: "frete_escolhido",
      menuButtonText: "Escolher Frete",
      options: [
        {
          id: "opt_frete_1",
          title: "1 - CANARANA (FAZ SANTA CARMEM) x UBERABA - R$ 290,00",
          description: "📍Coleta: FAZ SANTA CARMEM | Dest: UBERABA | Milho | Lote: 1000025900 | R$ 290,00 Cheio (com pedágio) | 9 eixo e 4 eixo",
          nextStepId: "step_ordem_cpf"
        },
        {
          id: "opt_frete_2",
          title: "2 - QUERENCIA (ARMZ AMÉRICA) x UBERABA - R$ 280,00",
          description: "📍Coleta: ARMZ AMÉRICA | Dest: UBERABA | Milho | Lote: 1000026029 | R$ 280,00 Cheio (com pedágio) | 9 eixo e 4 eixo",
          nextStepId: "step_ordem_cpf"
        },
        {
          id: "opt_frete_3",
          title: "3 - CANARANA (ARMZ CUNHA) x SANTOS - R$ 407,00",
          description: "📍Coleta: ARMZ CUNHA | Dest: SANTOS | Milho | Lote: 1000026101 | R$ 407,00 Cheio (com pedágio) | 9 eixo e 4 eixo",
          nextStepId: "step_ordem_cpf"
        },
        {
          id: "opt_frete_4",
          title: "4 - CANARANA (FAZ. DALLASTA) x SANTOS - R$ 407,00",
          description: "📍Coleta: FAZ. DALLASTA | Dest: SANTOS | Milho | Lote: 1000026009 | R$ 407,00 Cheio (com pedágio) | 9 eixo e 4 eixo",
          nextStepId: "step_ordem_cpf"
        },
        {
          id: "opt_frete_5",
          title: "5 - CANARANA (FAZ SANTA CARMEM) x SANTOS - R$ 414,00",
          description: "📍Coleta: FAZ SANTA CARMEM | Dest: SANTOS | Milho | Lote: 1000026044 | R$ 414,00 Cheio (com pedágio) | 9 eixo e 4 eixo",
          nextStepId: "step_ordem_cpf"
        }
      ]
    },
    {
      id: "step_ordem_cpf",
      title: "Ordem - Solicitar CPF",
      type: "collect_input",
      messages: [
        "Perfeito! Você selecionou:\n*{frete_escolhido}*\n\nPor favor, digite o *CPF do Motorista* (somente números):"
      ],
      saveToVar: "motorista_cpf",
      validationRegex: "^\\d{11}$",
      validationErrorMessage: "CPF inválido. Por favor, digite os 11 números do seu CPF sem pontos ou traços.",
      nextStepId: "step_ordem_nome"
    },
    {
      id: "step_ordem_nome",
      title: "Ordem - Primeiro Nome do Motorista",
      type: "collect_input",
      messages: [
        "Obrigado! Agora digite o *Primeiro Nome do Motorista*:"
      ],
      saveToVar: "motorista_nome",
      nextStepId: "step_ordem_placa"
    },
    {
      id: "step_ordem_placa",
      title: "Ordem - Placa do Veículo",
      type: "collect_input",
      messages: [
        "Informe a *Placa do Veículo / Cavalo*:"
      ],
      saveToVar: "motorista_placa",
      nextStepId: "step_ordem_telefone"
    },
    {
      id: "step_ordem_telefone",
      title: "Ordem - Telefone de Contato",
      type: "collect_input",
      messages: [
        "Informe o *Telefone / WhatsApp com DDD* para contato:"
      ],
      saveToVar: "motorista_telefone",
      nextStepId: "step_ordem_analista"
    },
    {
      id: "step_ordem_analista",
      title: "Ordem - Escolher Analista",
      type: "menu",
      messages: [
        "Com qual analista responsável você deseja prosseguir para a emissão da Ordem?"
      ],
      saveToVar: "analista_escolhido",
      menuButtonText: "Escolher Analista",
      options: [
        {
          id: "opt_ordem_ana_vinicius",
          title: "Vinicius - (66) 99958-3468",
          nextStepId: "step_ordem_fim_vinicius"
        },
        {
          id: "opt_ordem_ana_alexandre",
          title: "Alexandre - (66) 99617-5239",
          nextStepId: "step_ordem_fim_alexandre"
        },
        {
          id: "opt_ordem_ana_marcelo",
          title: "Marcelo - (66) 99669-2215",
          nextStepId: "step_ordem_fim_marcelo"
        },
        {
          id: "opt_ordem_ana_edvaldo",
          title: "Edvaldo - (66) 99647-3868",
          nextStepId: "step_ordem_fim_edvaldo"
        }
      ]
    },
    {
      id: "step_ordem_fim_vinicius",
      title: "Ordem - Concluído Vinicius",
      type: "handoff",
      messages: [
        "✅ *Ordem de Carregamento Registrada com Sucesso!*\n\n📋 *Resumo dos Dados:*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome} (CPF: {motorista_cpf})\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}\n• Analista: Vinicius\n\nO analista *Vinicius* e a equipe já foram notificados e darão continuidade ao atendimento!"
      ],
      notifyJids: [ANALYST_JIDS.vinicius, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *NOVA SOLICITAÇÃO DE ORDEM DE CARREGAMENTO*\n\n• Analista: *Vinicius*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome}\n• CPF: {motorista_cpf}\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}"
    },
    {
      id: "step_ordem_fim_alexandre",
      title: "Ordem - Concluído Alexandre",
      type: "handoff",
      messages: [
        "✅ *Ordem de Carregamento Registrada com Sucesso!*\n\n📋 *Resumo dos Dados:*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome} (CPF: {motorista_cpf})\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}\n• Analista: Alexandre\n\nO analista *Alexandre* e a equipe já foram notificados e darão continuidade ao atendimento!"
      ],
      notifyJids: [ANALYST_JIDS.alexandre, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *NOVA SOLICITAÇÃO DE ORDEM DE CARREGAMENTO*\n\n• Analista: *Alexandre*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome}\n• CPF: {motorista_cpf}\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}"
    },
    {
      id: "step_ordem_fim_marcelo",
      title: "Ordem - Concluído Marcelo",
      type: "handoff",
      messages: [
        "✅ *Ordem de Carregamento Registrada com Sucesso!*\n\n📋 *Resumo dos Dados:*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome} (CPF: {motorista_cpf})\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}\n• Analista: Marcelo\n\nO analista *Marcelo* e a equipe já foram notificados e darão continuidade ao atendimento!"
      ],
      notifyJids: [ANALYST_JIDS.marcelo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *NOVA SOLICITAÇÃO DE ORDEM DE CARREGAMENTO*\n\n• Analista: *Marcelo*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome}\n• CPF: {motorista_cpf}\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}"
    },
    {
      id: "step_ordem_fim_edvaldo",
      title: "Ordem - Concluído Edvaldo",
      type: "handoff",
      messages: [
        "✅ *Ordem de Carregamento Registrada com Sucesso!*\n\n📋 *Resumo dos Dados:*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome} (CPF: {motorista_cpf})\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}\n• Analista: Edvaldo\n\nO analista *Edvaldo* e a equipe já foram notificados e darão continuidade ao atendimento!"
      ],
      notifyJids: [ANALYST_JIDS.edvaldo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *NOVA SOLICITAÇÃO DE ORDEM DE CARREGAMENTO*\n\n• Analista: *Edvaldo*\n• Frete: {frete_escolhido}\n• Motorista: {motorista_nome}\n• CPF: {motorista_cpf}\n• Placa: {motorista_placa}\n• Contato: {motorista_telefone}"
    },

    // ─── OPÇÃO 2: AGENDAMENTO DE DESCARGA ───
    {
      id: "step_descarga_destino",
      title: "Descarga - Destino",
      type: "menu",
      messages: [
        "Selecione o destino para o agendamento de descarga:"
      ],
      saveToVar: "descarga_destino",
      menuButtonText: "Escolher Destino",
      options: [
        {
          id: "opt_descarga_santos",
          title: "1 - Santos",
          nextStepId: "step_descarga_placa"
        },
        {
          id: "opt_descarga_uberaba",
          title: "2 - Uberaba",
          nextStepId: "step_descarga_placa"
        },
        {
          id: "opt_descarga_outros",
          title: "3 - Outro Destino",
          nextStepId: "step_descarga_placa"
        }
      ]
    },
    {
      id: "step_descarga_placa",
      title: "Descarga - Placa",
      type: "collect_input",
      messages: [
        "Destino selecionado: *{descarga_destino}*\n\nPor favor, digite a *Placa do Veículo*:"
      ],
      saveToVar: "descarga_placa",
      nextStepId: "step_descarga_nota"
    },
    {
      id: "step_descarga_nota",
      title: "Descarga - Número da Nota",
      type: "collect_input",
      messages: [
        "Digite o *Número da Nota Fiscal (NF)* ou envie uma foto do comprovante:"
      ],
      saveToVar: "descarga_nota",
      nextStepId: "step_descarga_analista"
    },
    {
      id: "step_descarga_analista",
      title: "Descarga - Escolher Analista",
      type: "menu",
      messages: [
        "Qual analista deve receber este agendamento?"
      ],
      saveToVar: "analista_escolhido",
      menuButtonText: "Escolher Analista",
      options: [
        {
          id: "opt_descarga_ana_vinicius",
          title: "Vinicius - (66) 99958-3468",
          nextStepId: "step_descarga_fim_vinicius"
        },
        {
          id: "opt_descarga_ana_alexandre",
          title: "Alexandre - (66) 99617-5239",
          nextStepId: "step_descarga_fim_alexandre"
        },
        {
          id: "opt_descarga_ana_marcelo",
          title: "Marcelo - (66) 99669-2215",
          nextStepId: "step_descarga_fim_marcelo"
        },
        {
          id: "opt_descarga_ana_edvaldo",
          title: "Edvaldo - (66) 99647-3868",
          nextStepId: "step_descarga_fim_edvaldo"
        }
      ]
    },
    {
      id: "step_descarga_fim_vinicius",
      title: "Descarga - Concluído Vinicius",
      type: "handoff",
      messages: [
        "✅ *Agendamento de Descarga Encaminhado!*\n\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}\n• Responsável: Vinicius\n\nO analista Vinicius responderá em instantes."
      ],
      notifyJids: [ANALYST_JIDS.vinicius, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *SOLICITAÇÃO DE AGENDAMENTO DE DESCARGA*\n\n• Analista: *Vinicius*\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}"
    },
    {
      id: "step_descarga_fim_alexandre",
      title: "Descarga - Concluído Alexandre",
      type: "handoff",
      messages: [
        "✅ *Agendamento de Descarga Encaminhado!*\n\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}\n• Responsável: Alexandre\n\nO analista Alexandre responderá em instantes."
      ],
      notifyJids: [ANALYST_JIDS.alexandre, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *SOLICITAÇÃO DE AGENDAMENTO DE DESCARGA*\n\n• Analista: *Alexandre*\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}"
    },
    {
      id: "step_descarga_fim_marcelo",
      title: "Descarga - Concluído Marcelo",
      type: "handoff",
      messages: [
        "✅ *Agendamento de Descarga Encaminhado!*\n\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}\n• Responsável: Marcelo\n\nO analista Marcelo responderá em instantes."
      ],
      notifyJids: [ANALYST_JIDS.marcelo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *SOLICITAÇÃO DE AGENDAMENTO DE DESCARGA*\n\n• Analista: *Marcelo*\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}"
    },
    {
      id: "step_descarga_fim_edvaldo",
      title: "Descarga - Concluído Edvaldo",
      type: "handoff",
      messages: [
        "✅ *Agendamento de Descarga Encaminhado!*\n\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}\n• Responsável: Edvaldo\n\nO analista Edvaldo responderá em instantes."
      ],
      notifyJids: [ANALYST_JIDS.edvaldo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🚨 *SOLICITAÇÃO DE AGENDAMENTO DE DESCARGA*\n\n• Analista: *Edvaldo*\n• Destino: {descarga_destino}\n• Placa: {descarga_placa}\n• Nota: {descarga_nota}"
    },

    // ─── OPÇÃO 3: FATURAMENTO DE NOTAS ───
    {
      id: "step_faturamento_placa",
      title: "Faturamento - Placa",
      type: "collect_input",
      messages: [
        "🧾 *Faturamento de Notas*\n\nPor favor, informe a *Placa do Veículo*:"
      ],
      saveToVar: "faturamento_placa",
      nextStepId: "step_faturamento_obs"
    },
    {
      id: "step_faturamento_obs",
      title: "Faturamento - Observações",
      type: "collect_input",
      messages: [
        "Envie os detalhes ou foto do comprovante / canhoto assinado:"
      ],
      saveToVar: "faturamento_detalhes",
      nextStepId: "step_faturamento_analista"
    },
    {
      id: "step_faturamento_analista",
      title: "Faturamento - Analista",
      type: "menu",
      messages: [
        "Escolha o analista para enviar os comprovantes de faturamento:"
      ],
      saveToVar: "analista_escolhido",
      menuButtonText: "Escolher Analista",
      options: [
        {
          id: "opt_fat_ana_vinicius",
          title: "Vinicius - (66) 99958-3468",
          nextStepId: "step_fat_fim_vinicius"
        },
        {
          id: "opt_fat_ana_alexandre",
          title: "Alexandre - (66) 99617-5239",
          nextStepId: "step_fat_fim_alexandre"
        },
        {
          id: "opt_fat_ana_marcelo",
          title: "Marcelo - (66) 99669-2215",
          nextStepId: "step_fat_fim_marcelo"
        },
        {
          id: "opt_fat_ana_edvaldo",
          title: "Edvaldo - (66) 99647-3868",
          nextStepId: "step_fat_fim_edvaldo"
        }
      ]
    },
    {
      id: "step_fat_fim_vinicius",
      title: "Faturamento - Concluído Vinicius",
      type: "handoff",
      messages: [
        "✅ *Faturamento Registrado!*\n\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}\n• Analista: Vinicius\n\nOs dados foram enviados para o analista e a equipe!"
      ],
      notifyJids: [ANALYST_JIDS.vinicius, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🧾 *COMPROVANTE / FATURAMENTO DE NOTAS*\n\n• Analista: *Vinicius*\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}"
    },
    {
      id: "step_fat_fim_alexandre",
      title: "Faturamento - Concluído Alexandre",
      type: "handoff",
      messages: [
        "✅ *Faturamento Registrado!*\n\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}\n• Analista: Alexandre\n\nOs dados foram enviados para o analista e a equipe!"
      ],
      notifyJids: [ANALYST_JIDS.alexandre, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🧾 *COMPROVANTE / FATURAMENTO DE NOTAS*\n\n• Analista: *Alexandre*\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}"
    },
    {
      id: "step_fat_fim_marcelo",
      title: "Faturamento - Concluído Marcelo",
      type: "handoff",
      messages: [
        "✅ *Faturamento Registrado!*\n\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}\n• Analista: Marcelo\n\nOs dados foram enviados para o analista e a equipe!"
      ],
      notifyJids: [ANALYST_JIDS.marcelo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🧾 *COMPROVANTE / FATURAMENTO DE NOTAS*\n\n• Analista: *Marcelo*\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}"
    },
    {
      id: "step_fat_fim_edvaldo",
      title: "Faturamento - Concluído Edvaldo",
      type: "handoff",
      messages: [
        "✅ *Faturamento Registrado!*\n\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}\n• Analista: Edvaldo\n\nOs dados foram enviados para o analista e a equipe!"
      ],
      notifyJids: [ANALYST_JIDS.edvaldo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "🧾 *COMPROVANTE / FATURAMENTO DE NOTAS*\n\n• Analista: *Edvaldo*\n• Placa: {faturamento_placa}\n• Detalhes: {faturamento_detalhes}"
    },

    // ─── OPÇÃO 4: FALAR COM UM ATENDENTE ───
    {
      id: "step_atendente_escolha",
      title: "Atendentes",
      type: "menu",
      messages: [
        "Escolha diretamente o analista com quem deseja conversar:"
      ],
      saveToVar: "atendente_escolhido",
      menuButtonText: "Escolher Atendente",
      options: [
        {
          id: "opt_atend_vinicius",
          title: "📞 Vinicius: (66) 99958-3468",
          nextStepId: "step_atend_chamado_vinicius"
        },
        {
          id: "opt_atend_alexandre",
          title: "📞 Alexandre: (66) 99617-5239",
          nextStepId: "step_atend_chamado_alexandre"
        },
        {
          id: "opt_atend_marcelo",
          title: "📞 Marcelo: (66) 99669-2215",
          nextStepId: "step_atend_chamado_marcelo"
        },
        {
          id: "opt_atend_edvaldo",
          title: "📞 Edvaldo: (66) 99647-3868",
          nextStepId: "step_atend_chamado_edvaldo"
        }
      ]
    },
    {
      id: "step_atend_chamado_vinicius",
      title: "Atendente Vinicius",
      type: "handoff",
      messages: [
        "Transferindo seu atendimento para *Vinicius* ((66) 99958-3468).\nA equipe e o analista já foram avisados e responderão em breve!"
      ],
      notifyJids: [ANALYST_JIDS.vinicius, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "👤 *NOVO CONTATO SOLICITADO NO BOT*\n• Atendente escolhido: *Vinicius*\nO contato está aguardando atendimento."
    },
    {
      id: "step_atend_chamado_alexandre",
      title: "Atendente Alexandre",
      type: "handoff",
      messages: [
        "Transferindo seu atendimento para *Alexandre* ((66) 99617-5239).\nA equipe e o analista já foram avisados e responderão em breve!"
      ],
      notifyJids: [ANALYST_JIDS.alexandre, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "👤 *NOVO CONTATO SOLICITADO NO BOT*\n• Atendente escolhido: *Alexandre*\nO contato está aguardando atendimento."
    },
    {
      id: "step_atend_chamado_marcelo",
      title: "Atendente Marcelo",
      type: "handoff",
      messages: [
        "Transferindo seu atendimento para *Marcelo* ((66) 99669-2215).\nA equipe e o analista já foram avisados e responderão em breve!"
      ],
      notifyJids: [ANALYST_JIDS.marcelo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "👤 *NOVO CONTATO SOLICITADO NO BOT*\n• Atendente escolhido: *Marcelo*\nO contato está aguardando atendimento."
    },
    {
      id: "step_atend_chamado_edvaldo",
      title: "Atendente Edvaldo",
      type: "handoff",
      messages: [
        "Transferindo seu atendimento para *Edvaldo* ((66) 99647-3868).\nA equipe e o analista já foram avisados e responderão em breve!"
      ],
      notifyJids: [ANALYST_JIDS.edvaldo, OPERACAO_COFCO_GROUP_JID],
      notifyMessage: "👤 *NOVO CONTATO SOLICITADO NO BOT*\n• Atendente escolhido: *Edvaldo*\nO contato está aguardando atendimento."
    }
  ]
};

async function main() {
  console.log("Atualizando com todos os dados completos dos fretes...");
  const existing = await prisma.autoReply.findFirst({
    where: {
      sessionId: SESSION_DB_ID,
      keyword: CHATBOT_FLOW_KEYWORD
    }
  });

  let result;
  if (existing) {
    result = await prisma.autoReply.update({
      where: { id: existing.id },
      data: {
        response: JSON.stringify(transportFlow, null, 2)
      }
    });
  } else {
    result = await prisma.autoReply.create({
      data: {
        sessionId: SESSION_DB_ID,
        keyword: CHATBOT_FLOW_KEYWORD,
        response: JSON.stringify(transportFlow, null, 2),
        matchType: "EXACT"
      }
    });
  }

  console.log("Fluxo atualizado com sucesso no banco de dados! ID:", result.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
