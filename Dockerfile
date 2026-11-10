# MeshChat relay + web UI in one image.
# Build:  docker build -t meshchat .
# Run:    docker run -p 8787:8787 -v meshchat-data:/data meshchat

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    MESHCHAT_PORT=8787 \
    MESHCHAT_HOST=0.0.0.0 \
    MESHCHAT_DATA=/data \
    MESHCHAT_POW=16 \
    MESHCHAT_TTL_DAYS=7
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/relay/dist ./packages/relay/dist
COPY --from=build /app/packages/relay/public ./packages/relay/public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MESHCHAT_PORT||8787)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/relay/dist/relay.mjs"]
