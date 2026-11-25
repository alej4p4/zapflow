const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const record = await prisma.autoReply.findFirst({
    where: { keyword: '__CHATBOT_FLOW__' }
  });
  if (!record) {
    console.log("Fluxo não encontrado!");
    return;
  }
  const flow = JSON.parse(record.response);
  console.log("=== VERIFICAÇÃO DOS PASSOS DE NOTIFICAÇÃO ===");
  const notifySteps = flow.steps.filter(s => s.notifyJid || s.notifyJids);
  notifySteps.forEach(s => {
    console.log(`\nStep ID: ${s.id} (${s.title})`);
    console.log(`- notifyJid:  ${s.notifyJid || "nenhum"}`);
    console.log(`- notifyJids: ${JSON.stringify(s.notifyJids || [])}`);
    console.log(`- notifyMessage:\n${s.notifyMessage}`);
  });
}

check().finally(() => prisma.$disconnect());
