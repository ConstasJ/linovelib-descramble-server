FROM node:22-alpine

ARG NPM_REGISTRY=https://registry.npmjs.org

RUN mkdir -p /app

WORKDIR /app
COPY package.json /app

RUN npm config set registry ${NPM_REGISTRY} && npm i -g pnpm && pnpm install --dangerously-allow-all-builds

COPY . /app/
RUN pnpm build

EXPOSE 5301
VOLUME [ "/app/data" ]
CMD ["npm", "start"]