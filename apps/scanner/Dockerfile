FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/scanner ./apps/scanner
COPY packages/web-sdk/security.ts ./packages/web-sdk/security.ts
COPY packages/consent-domain/common.ts ./packages/consent-domain/common.ts
USER pwuser
CMD ["node","--import","tsx","apps/scanner/runner.ts"]
