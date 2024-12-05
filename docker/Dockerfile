# Base image
FROM ubuntu:20.04

# Install dependencies and Tailscale
RUN apt-get update && apt-get install -y \
    curl gnupg apt-transport-https ca-certificates && \
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.gpg | apt-key add - && \
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.list | tee /etc/apt/sources.list.d/tailscale.list && \
    apt-get update && apt-get install -y tailscale && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory and copy project files
WORKDIR /app
COPY . .

# Entrypoint
CMD ["./start.sh"]
