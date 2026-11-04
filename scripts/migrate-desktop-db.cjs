const { PrismaClient: MySQLClient } = require("../src/generated/prisma-mysql");
const { PrismaClient: SQLiteClient } = require("@prisma/client");

const mysql = new MySQLClient({
  datasources: { db: { url: process.env.MYSQL_DATABASE_URL } },
});
const sqlite = new SQLiteClient({
  datasources: { db: { url: process.env.DESKTOP_DATABASE_URL } },
});

const models = [
  "user",
  "session",
  "contact",
  "message",
  "group",
  "autoReply",
  "story",
  "scheduledMessage",
  "authState",
  "webhook",
  "webhookLog",
  "botConfig",
  "systemConfig",
  "label",
  "chatLabel",
  "notification",
  "sessionAccess",
  "broadcastLog",
  "broadcastRecipient",
];

async function main() {
  for (const model of models) {
    const rows = await mysql[model].findMany();
    if (!rows.length) continue;
    await sqlite[model].createMany({ data: rows });
    console.log(`Migrated ${rows.length} ${model} rows`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([mysql.$disconnect(), sqlite.$disconnect()]);
  });
