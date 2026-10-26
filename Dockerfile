FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 SITE_DIR=/app/codigo-fuente
WORKDIR /app/codigo-fuente
COPY codigo-fuente/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY codigo-fuente/ ./
WORKDIR /app
COPY deploy/server.cjs ./deploy/server.cjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/server.cjs"]
