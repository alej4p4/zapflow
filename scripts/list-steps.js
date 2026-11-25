const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  console.log("Steps do fluxo:");
  flow.steps.forEach((s, idx) => {
    console.log(`[${idx + 1}] ID: ${s.id} | Título: ${s.title} | Tipo: ${s.type}`);
  });
}

check().finally(() => prisma.$disconnect());
