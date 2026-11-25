const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTypes() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const types = flow.steps.map(s => ({ id: s.id, type: s.type }));
  console.log("Tipos dos steps no banco:");
  console.log(types);
}

checkTypes().finally(() => prisma.$disconnect());
