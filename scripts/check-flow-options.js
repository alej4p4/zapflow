const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const atendStep = flow.steps.find(s => s.id === 'step_atendente_escolha');
  const ordemAnaStep = flow.steps.find(s => s.id === 'step_ordem_analista');
  console.log("=== STEP ATENDENTE ESCOLHA ===");
  console.log(JSON.stringify(atendStep?.options, null, 2));
  console.log("=== STEP ORDEM ANALISTA ===");
  console.log(JSON.stringify(ordemAnaStep?.options, null, 2));
}

check().finally(() => prisma.$disconnect());
