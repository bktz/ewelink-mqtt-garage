
FROM node:12.15.0-alpine3.11

COPY src /garage

RUN cd /garage \
    && npm install --production

WORKDIR /garage
VOLUME /garage/config

ENTRYPOINT node /garage/index.js