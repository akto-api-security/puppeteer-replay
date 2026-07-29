FROM ubuntu:26.04

# Puppeteer's own downloaded Chrome build lives here regardless of which
# user's $HOME is active, so build-time download and runtime resolution agree.
ENV PUPPETEER_CACHE_DIR=/usr/app/.cache/puppeteer

# Ubuntu's own "chromium-browser" package is a snap stub and won't run in a
# container without snapd, so Node comes from NodeSource and Chrome comes
# from Puppeteer's own downloader instead.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      gnupg \
      unzip \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Chrome's sandbox refuses to start as root ("Running as root without
# --no-sandbox is not supported"), so the app runs as this dedicated user.
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video -m pptruser

WORKDIR /usr/app
COPY package.json package-lock.json ./
RUN npm install

# Downloads the Chrome build Puppeteer is tested against and installs the
# system libraries it needs to run (nss, atk, gtk, etc.).
RUN apt-get update \
    && npx puppeteer browsers install chrome --install-deps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# npm/npx/corepack aren't needed at runtime (CMD only runs `node`) and the
# bundled npm carries its own vulnerable transitive deps (tar, undici, etc.).
RUN rm -rf /usr/lib/node_modules/npm /usr/lib/node_modules/corepack \
           /usr/bin/npm /usr/bin/npx /usr/bin/corepack

# Canonical's Pebble service manager ships baked into the ubuntu:26.04 base
# image itself (not even an apt package). We never invoke it and it carries
# its own vulnerable golang.org/x/net dependency.
RUN rm -f /usr/bin/pebble

COPY ./ /usr/app
# Files above were copied/downloaded as root; pptruser needs ownership to
# read the app code and execute the downloaded Chrome binary at runtime.
RUN chown -R pptruser:pptruser /usr/app

USER pptruser

CMD ["node", "test.mjs"]
