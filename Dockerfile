FROM node:22-alpine
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
