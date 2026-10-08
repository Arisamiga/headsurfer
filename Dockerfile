# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

# Vite replaces this browser-visible build-time value. The production default is
# the model prepared by scripts/copy-mediapipe.mjs in public/mediapipe/.
ARG VITE_FACE_MODEL_URL=/mediapipe/face_landmarker.task
ENV VITE_FACE_MODEL_URL=${VITE_FACE_MODEL_URL}

RUN npm run build && node scripts/precompress.mjs dist

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
