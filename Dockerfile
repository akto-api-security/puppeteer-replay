FROM node:20-slim

# Install Chromium and libraries equivalent to your Alpine setup
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    libnss3 \           # nss
    libfreetype6 \      # freetype
    libharfbuzz0b \     # harfbuzz
    fonts-freefont-ttf \# ttf-freefont
    fonts-liberation \  # extra common web fonts, often useful
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer which Chromium to use
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/app
COPY ./ /usr/app

RUN npm install
COPY test.mjs .


CMD ["node", "test.mjs"]

