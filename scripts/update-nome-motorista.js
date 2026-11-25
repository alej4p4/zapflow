const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function update() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  if (!record) {
    console.log("Fluxo não encontrado!");
    return;
  }

  const flow = JSON.parse(record.response);
  const stepNome = flow.steps.find(s => s.id === 'step_ordem_nome');
  if (stepNome) {
    console.log("Mensagem anterior:", stepNome.messages);
    stepNome.messages = [
      "Obrigado! Agora digite o *Primeiro Nome do Motorista*:"
    ];
    stepNome.title = "Ordem - Primeiro Nome do Motorista";
    console.log("Nova mensagem:", stepNome.messages);
  }

  await prisma.autoReply.update({
    where: { id: record.id },
    data: { response: JSON.stringify(flow, null, 2) }
  });

  console.log("Fluxo atualizado com sucesso no banco de dados!");
}

update().finally(() => prisma.$disconnect());
