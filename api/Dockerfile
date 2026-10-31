# API image: Node runs the TypeScript directly with tsx (same as "npm start").
FROM node:22-alpine
WORKDIR /app
# Copy package files first: Docker caches the npm install step until they change.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Run as the unprivileged "node" user, not root (least privilege again).
USER node
CMD ["npx", "tsx", "src/server.ts"]
