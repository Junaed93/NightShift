# Sandbox for unattended runs. The agent gets no credentials it does not need.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates ripgrep jq \
  && rm -rf /var/lib/apt/lists/*

# TODO: install the harness you actually use.
# RUN npm install -g @anthropic-ai/claude-code

COPY package.json /opt/nightshift/package.json
COPY src /opt/nightshift/src
COPY prompts /opt/nightshift/prompts

WORKDIR /work
ENTRYPOINT ["node", "/opt/nightshift/src/cli.mjs"]
CMD ["run", "--cwd", "/work"]
