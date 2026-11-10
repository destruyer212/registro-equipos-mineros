FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG RELEASE_ID
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build && node -e 'require("node:fs").writeFileSync("dist/release.json", JSON.stringify({ release: process.argv[1] }))' "$RELEASE_ID"

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
