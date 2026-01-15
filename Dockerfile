FROM node:lts

ARG NPM_REGISTRY=https://registry.npmjs.org

RUN mkdir -p /app

WORKDIR /app
COPY package.json /app

RUN npm config set registry ${NPM_REGISTRY} && npm i -g pnpm && pnpm install

COPY . /app/
RUN pnpm build

EXPOSE 5301
VOLUME [ "/data" ]
CMD ["npm", "start"]