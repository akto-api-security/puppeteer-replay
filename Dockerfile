FROM alpine

# Installs latest Chromium (100) package.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs \
      yarn

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/app
COPY ./ /usr/app

# Puppeteer v13.5.0 works with Chromium 100.
# RUN yarn add puppeteer@13.5.0
RUN apk add --update npm


RUN npm install
COPY test.mjs .


CMD ["node", "test.mjs"]

