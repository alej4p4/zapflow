const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAlertFormat() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const step = flow.steps.find(s => s.id === 'step_ordem_fim_marcelo');
  console.log("DESTINATÁRIOS CONFIGURADOS PARA O MARCELO:");
  console.log("1. Privado do Marcelo:", step.notifyJids[0]);
  console.log("2. Grupo OPERAÇÃO DIÁRIA COFCO:", step.notifyJids[1]);
  console.log("\nMENSAGEM QUE SERÁ DISPARADA:");
  console.log(step.notifyMessage);
}

testAlertFormat().finally(() => prisma.$disconnect());
