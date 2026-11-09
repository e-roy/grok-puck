# The desk bridge, for the always-on machine (run it with compose.yaml).
# pnpm comes from corepack at a pinned version; installs follow pnpm-lock.yaml exactly, so the
# 7-day minimum package age checked when the lockfile was made still holds.
# The admin page is its own workspace package (admin/): built here, and only its files are kept.

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json admin/
RUN pnpm install --frozen-lockfile --filter desk-bridge-admin
COPY admin admin
RUN pnpm build:admin

FROM node:24-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json admin/
RUN pnpm install --frozen-lockfile --prod --filter desk-bridge
COPY src src
COPY --from=build /app/admin/dist admin/dist
ENV NODE_ENV=production DATA_DIR=/data
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787 8788
CMD ["node", "src/main.ts"]
