FROM node:12.15.0

COPY src /garage

RUN cd /garage \
    && npm install --production

WORKDIR /garage
VOLUME /garage/config

ENTRYPOINT node /garage/index.js