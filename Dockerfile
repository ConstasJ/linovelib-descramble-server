FROM node:22-slim

ARG NPM_REGISTRY=https://registry.npmjs.org

RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app

WORKDIR /app
COPY package.json /app

RUN npm config set registry ${NPM_REGISTRY} && npm i -g pnpm && pnpm install --dangerously-allow-all-builds

COPY . /app/
RUN pnpm build

EXPOSE 5301
VOLUME [ "/app/data" ]
CMD ["npm", "start"]