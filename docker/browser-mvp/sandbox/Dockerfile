ARG SANDBOX_IMAGE=dify-agent-local-sandbox:browser-mvp-base
FROM ${SANDBOX_IMAGE}
USER root
ARG CHROME_DEVTOOLS_VERSION=1.13.0
RUN npm install --global --ignore-scripts --no-audit --no-fund chrome-devtools-mcp@${CHROME_DEVTOOLS_VERSION}
COPY docker/browser-mvp/sandbox/browser-cli.mjs /usr/local/bin/dify-browser
RUN chmod 755 /usr/local/bin/dify-browser
COPY docker/browser-mvp/sandbox/skill /opt/dify-agent-tools/skills/chrome-devtools-cli
COPY docker/browser-mvp/sandbox/start.sh /usr/local/bin/start-browser-sandbox
RUN chmod 755 /usr/local/bin/start-browser-sandbox && chown dify:dify /opt/dify-agent-tools
USER dify
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/start-browser-sandbox"]
CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004", "--require-auth-token"]
