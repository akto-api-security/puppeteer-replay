FROM alpine AS build

RUN apk add --no-cache nodejs npm

WORKDIR /usr/app
COPY package.json package-lock.json ./
RUN npm install
COPY ./ /usr/app

FROM alpine

# Installs latest Chromium package.
RUN apk upgrade --no-cache && apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/app
COPY --from=build /usr/app /usr/app

CMD ["node", "test.mjs"]

