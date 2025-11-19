FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    libnss3 \
    libfreetype6 \
    libharfbuzz0b \
    fonts-freefont-ttf \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer which Chromium to use
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/app
COPY ./ /usr/app

RUN npm install
COPY test.mjs .


CMD ["node", "test.mjs"]

