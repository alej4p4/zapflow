const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const groups = await prisma.group.findMany({
    where: {
      subject: {
        contains: "COFCO",
        mode: "insensitive"
      }
    }
  });
  console.log("Grupos encontrados com COFCO:", groups.length);
  groups.forEach(g => {
    console.log(`- ${g.subject} (JID: ${g.jid})`);
  });
}

check().finally(() => prisma.$disconnect());
