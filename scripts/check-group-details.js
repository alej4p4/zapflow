const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const g = await prisma.group.findFirst({
    where: { jid: "120363415606283620@g.us" }
  });
  console.log("Grupo encontrado:", g);
}

check().finally(() => prisma.$disconnect());
