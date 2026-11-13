# Защищённый минимальный контейнер MeshChat (Node.js 20 Alpine, без root-прав).
# Внешних npm-зависимостей на сервере нет — нулевой риск supply-chain атак при сборке.

FROM node:20-alpine

LABEL org.opencontainers.image.title="MeshChat" \
      org.opencontainers.image.description="Anonymous E2E-encrypted multi-transport P2P mesh messenger"

WORKDIR /app

# Создаём выделенный каталог под зашифрованные ящики и блобы с правами непривилегированного пользователя node
RUN mkdir -p /data && chown -R node:node /data /app

COPY --chown=node:node package.json MeshChat.apk* ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node tools ./tools

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    STRICT_FRAME=1

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
