FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# These values are baked into the shipped bundle and are therefore PUBLIC.
# Never put a secret here: the Gemini key and the device token live on the API
# side, not in the bundle.
ARG VITE_API_URL=
ARG VITE_SIGNUP_KEY=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SIGNUP_KEY=$VITE_SIGNUP_KEY

RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Adresse de l'API vers laquelle /api/ est mandaté. Substituée au démarrage
# dans le gabarit nginx (script 20-envsubst-on-templates.sh de l'image).
# À redéfinir si le conteneur de l'API porte un autre nom :
#   docker run -e SPLITTICKET_API=mon-api:8787 …
ENV SPLITTICKET_API=tricount-api:8787 \
    SPLITTICKET_RESOLVER=127.0.0.11 \
    NGINX_ENVSUBST_FILTER=^SPLITTICKET_

COPY docker/templates/ /etc/nginx/templates/
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
