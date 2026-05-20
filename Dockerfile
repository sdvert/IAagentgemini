FROM node:20-alpine

RUN apk add --no-cache python3 make g++ sqlite git

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/auth_info /app/data

VOLUME ["/app/auth_info", "/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s \
  CMD node -e "process.exit(0)"

CMD ["node", "src/index.js"]
