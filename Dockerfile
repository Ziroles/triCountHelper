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

# The front is deployed on its own: this image serves static files and proxies
# nothing. An empty VITE_API_URL would produce a bundle calling "/api" on an
# origin that has no such route — a build that only fails once in the user's
# browser. Better here.
RUN if [ -z "$VITE_API_URL" ]; then \
      echo "" >&2; \
      echo "VITE_API_URL is empty." >&2; \
      echo "  This image serves the PWA and nothing else: it has no /api to answer." >&2; \
      echo "  Give it the API's public URL:" >&2; \
      echo "    --build-arg VITE_API_URL=https://api.example.com" >&2; \
      echo "  Or, if a gateway of yours routes /api to the API, say so explicitly:" >&2; \
      echo "    --build-arg VITE_API_URL=/api" >&2; \
      echo "" >&2; \
      exit 1; \
    fi

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
