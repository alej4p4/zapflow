const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const stepFrete = flow.steps.find(s => s.id === 'step_ordem_frete');
  console.log("=== OPÇÕES DE FRETE CONFIGURADAS NO BANCO ===");
  stepFrete.options.forEach((opt, idx) => {
    console.log(`\nOpção ${idx + 1}: ${opt.title}`);
    console.log(`Descrição: ${opt.description}`);
  });
}

check().finally(() => prisma.$disconnect());
