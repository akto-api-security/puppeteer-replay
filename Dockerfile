FROM amazonlinux:2023

USER root
WORKDIR /app

# Install Java 17 (Corretto) + OS deps
# Notes:
# - AL2023 often includes curl-minimal/gnupg2-minimal; keep minimal to avoid conflicts
# - libappindicator + lsb-release are not available on AL2023; omit them
# - libgbm-dev is a build-time Ubuntu package; on AL2023 you want mesa-libgbm runtime
RUN dnf -y update && dnf install -y \
    java-17-amazon-corretto \
    wget \
    unzip \
    gnupg2-minimal \
    curl-minimal \
    ca-certificates \
    tzdata \
    liberation-fonts \
    alsa-lib \
    mesa-libgbm \
    at-spi2-atk \
    atk \
    cups-libs \
    dbus-libs \
    gdk-pixbuf2 \
    nspr \
    nss \
    libX11 \
    libXcomposite \
    libXdamage nodejs npm\
    libXrandr \
    xdg-utils \
    # commonly required by Chrome headless on RPM distros
    libXext \
    libXfixes \
    mesa-libEGL \
    mesa-libGL \
    pango \
    cairo \
    && dnf clean all

RUN dnf install -y libxkbcommon && dnf clean all

# Copy app sources (if you need them at runtime; otherwise remove this and only copy the jar)
COPY . /app/

# Install Chrome (x86_64 only) - Chrome for Testing
RUN wget -q "https://storage.googleapis.com/chrome-for-testing-public/138.0.7204.157/linux64/chrome-linux64.zip" -O /tmp/chrome-linux64.zip && \
    unzip /tmp/chrome-linux64.zip -d /opt/ && \
    rm /tmp/chrome-linux64.zip && \
    chmod +x /opt/chrome-linux64/chrome && \
    ln -sf /opt/chrome-linux64/chrome /usr/bin/google-chrome


ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome


RUN npm install

CMD ["node", "test.mjs"]

