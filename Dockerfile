# -----------------------------------------------------------
# Dockerfile – ZapFlow (Next.js 16 / Turbopack)
# -----------------------------------------------------------
# 1️⃣  Base image – Node 22 (versão usada localmente)
FROM node:22-alpine AS base
# 2️⃣  Set working directory
WORKDIR /app
# 3️⃣  Copiar apenas os arquivos necessários para instalar as dependências
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/
# (Se houver outros arquivos de dependência, copie aqui)
# 4️⃣  Instalar dependências (inclui Prisma)
RUN npm ci --legacy-peer-deps
# 5️⃣  Copiar todo o código fonte
COPY . .
# 6️⃣  Gerar o cliente Prisma e fazer o build da aplicação
RUN npx prisma generate && npm run build
# 7️⃣  Produção – usar a imagem “runtime” enxulta
FROM node:22-alpine AS runtime
WORKDIR /app
# Copiar apenas o que a aplicação realmente precisa
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/public ./public
COPY --from=base /app/next.config.ts ./
COPY --from=base /app/tsconfig.json ./
# Variáveis de ambiente recomendadas (ajuste conforme seu .env)
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Executa o servidor Next.js
CMD ["node", "node_modules/next/dist/cli/next", "start"]