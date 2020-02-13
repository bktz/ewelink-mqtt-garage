#!/usr/bin/env bash

docker run \
  -it \
  --rm \
  --name garage \
  -v "$(pwd)"/src/config:/garage/config \
  bktz/ewelink-mqtt-garage:local