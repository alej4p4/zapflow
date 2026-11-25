const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  const flow = JSON.parse(record.response);
  const handoffSteps = flow.steps.filter(s => s.type === 'handoff');
  console.log(`Total handoff steps: ${handoffSteps.length}`);
  handoffSteps.forEach(s => {
    console.log(`- ${s.id}: notifyJids = ${JSON.stringify(s.notifyJids)}`);
  });
}

check().finally(() => prisma.$disconnect());
