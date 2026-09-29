# Build stage — installs devDependencies too, so esbuild can produce widget.min.js.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage — production dependencies only.
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["node", "src/index.js"]
