FROM amazonlinux:2023

# Install Chromium + runtime deps + Node.js/npm
RUN dnf -y update && \
    dnf -y install \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      nodejs \
      npm \
      fontconfig \
      freetype \
      shadow-utils \
      xdg-utils \
      libX11 \
      libXcomposite \
      libXdamage \
      libXext \
      libXfixes \
      libXrandr \
      libxcb \
      libxkbcommon \
      alsa-lib \
      atk \
      at-spi2-atk \
      cups-libs \
      dbus-libs \
      gtk3 \
      pango \
      mesa-libgbm \
    && dnf clean all && rm -rf /var/cache/dnf

# Puppeteer: use system Chromium (don’t download its own)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/app
COPY . /usr/app

RUN npm install

CMD ["node", "test.mjs"]

