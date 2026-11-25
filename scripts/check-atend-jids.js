const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const atendSteps = flow.steps.filter(s => s.id.startsWith('step_atend_chamado_'));
  atendSteps.forEach(s => {
    console.log(`${s.title}: notifyJid = ${s.notifyJid}`);
  });
}

check().finally(() => prisma.$disconnect());
