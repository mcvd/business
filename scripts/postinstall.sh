#!/usr/bin/env bash

if [[ $NODE_ENV != "production" ]]; then
  npx husky install
fi
