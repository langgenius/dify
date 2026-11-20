#!/bin/sh
set -eu
# Materialize the non-secret deployment config before per-job Landlock starts.
# A separate bind mount is not automatically readable beneath the /etc rule.
cp /etc/dify-browser.json /opt/dify-agent-tools/browser.json
exec "$@"
