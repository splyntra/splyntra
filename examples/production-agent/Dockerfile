# SPDX-License-Identifier: FSL-1.1-ALv2
# Multi-stage production image for the triage agent service.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER app
EXPOSE 8080
# SIGTERM is delivered straight to node (PID 1) so the graceful drain runs.
CMD ["node", "dist/server.js"]
