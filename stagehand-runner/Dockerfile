FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
ENV STAGEHAND_RUNS_DIR=/app/runs
CMD ["node", "dist/index.js"]
