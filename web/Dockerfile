# Build context = repo root (see docker-compose.yml).
FROM rust:1 AS wasm
RUN rustup target add wasm32-unknown-unknown && cargo install wasm-pack --locked
WORKDIR /src
COPY core ./core
COPY samples ./samples
RUN cd core && wasm-pack build --target web --release --out-dir /out

FROM node:22 AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
COPY samples /samples
COPY --from=wasm /out ./src/wasm
RUN npm run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
