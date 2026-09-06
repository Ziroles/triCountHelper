FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Ces valeurs sont intégrées au paquet livré et donc PUBLIQUES.
# N'y placez jamais de secret : la clé Gemini et le jeton d'appareil vivent
# côté API, pas dans le bundle.
ARG VITE_API_URL=
ARG VITE_SIGNUP_KEY=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SIGNUP_KEY=$VITE_SIGNUP_KEY

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
