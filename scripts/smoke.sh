#!/usr/bin/env sh
set -e
curl -fs localhost/api/health | grep -q ok
curl -fs localhost/ | grep -qi cosmic
echo smoke ok
