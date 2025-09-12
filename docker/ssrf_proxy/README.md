# SSRF Proxy Configuration

This directory contains the Squid proxy configuration used to prevent Server-Side Request Forgery (SSRF) attacks in Dify.

## Security by Default

The default configuration (`squid.conf.template`) prevents SSRF attacks while allowing normal internet access:

- **Blocks all private/internal networks** (RFC 1918, loopback, link-local, etc.)
- **Only allows HTTP (80) and HTTPS (443) ports**
- **Allows all public internet resources** (operates as a blacklist for private networks)
- **Additional restrictions can be added** via custom configurations in `/etc/squid/conf.d/`

## Customizing the Configuration

### For Development/Local Environments

To allow additional domains or relax restrictions for your local environment:

1. Create a `conf.d` directory in your deployment
1. Copy example configurations from `conf.d.example/` and modify as needed
1. Mount the config files to `/etc/squid/conf.d/` in the container

### Example: Docker Compose

```yaml
services:
  ssrf-proxy:
    volumes:
      - ./my-proxy-configs:/etc/squid/conf.d:ro
```

### Example: Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: squid-custom-config
data:
  20-allow-external-domains.conf: |
    acl allowed_external dstdomain .example.com
    http_access allow allowed_external
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: ssrf-proxy
        volumeMounts:
        - name: custom-config
          mountPath: /etc/squid/conf.d
      volumes:
      - name: custom-config
        configMap:
          name: squid-custom-config
```

## Available Example Configurations

The `conf.d.example/` directory contains example configurations:

- **00-testing-environment.conf.example**: Configuration for CI/testing environments (NOT for production)
- **10-allow-internal-services.conf.example**: Allow internal services (use with caution!)
- **20-allow-external-domains.conf.example**: Allow specific external domains
- **30-allow-additional-ports.conf.example**: Allow additional ports
- **40-restrict-to-allowlist.conf.example**: Convert to whitelist mode (block all except allowed)

## Security Considerations

⚠️ **WARNING**: Relaxing these restrictions can expose your system to SSRF attacks!

- **Never allow access to private networks in production** unless absolutely necessary
- **Carefully review any domains you whitelist** to ensure they cannot be used for SSRF
- **Avoid allowing high port ranges** (1025-65535) as they can bypass security restrictions
- **Monitor proxy logs** for suspicious activity

## Default Blocked Networks

The following networks are blocked by default to prevent SSRF:

- `0.0.0.0/8` - "This" network
- `10.0.0.0/8` - Private network (RFC 1918)
- `127.0.0.0/8` - Loopback
- `169.254.0.0/16` - Link-local (RFC 3927)
- `172.16.0.0/12` - Private network (RFC 1918)
- `192.168.0.0/16` - Private network (RFC 1918)
- `224.0.0.0/4` - Multicast
- `fc00::/7` - IPv6 unique local addresses
- `fe80::/10` - IPv6 link-local
- `::1/128` - IPv6 loopback

## Development Mode

⚠️ **WARNING: Development mode DISABLES all SSRF protections! Only use in development environments!**

Development mode provides a zero-configuration environment that:

- Allows access to ALL private networks and localhost
- Allows access to cloud metadata endpoints
- Allows connections to any port
- Disables all SSRF protections for easier development

### Using Development Mode

#### Option 1: Environment Variable (Recommended)

Simply set the `SSRF_PROXY_DEV_MODE` environment variable to `true`:

```bash
# In your .env or middleware.env file
SSRF_PROXY_DEV_MODE=true

# Then start normally
docker-compose -f docker-compose.middleware.yaml up ssrf_proxy
```

Or set it directly in docker-compose:

```yaml
services:
  ssrf_proxy:
    environment:
      SSRF_PROXY_DEV_MODE: true
```

**Important Note about Docker Networking:**

When accessing services on your host machine from within Docker containers:

- Do NOT use `127.0.0.1` or `localhost` (these refer to the container itself)
- Instead use:
  - `host.docker.internal:port` (recommended, works on Mac/Windows/Linux with Docker 20.10+)
  - Your host machine's actual IP address
  - On Linux: the Docker bridge gateway (usually `172.17.0.1`)

Example:

```bash
# Wrong (won't work from inside container):
http://127.0.0.1:1234

# Correct (will work):
http://host.docker.internal:1234
```

The development mode uses `squid.conf.dev.template` which allows all connections.

## Testing

Comprehensive integration tests are available to validate the SSRF proxy configuration:

```bash
# Run from the api/ directory
cd ../../api
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py

# List available test cases
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --list-tests

# Use extended test suite
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --test-file test_cases_extended.yaml

# Test development mode (all requests should be allowed)
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --dev-mode
```

The test suite validates:

- Blocking of private networks and loopback addresses
- Blocking of cloud metadata endpoints
- Allowing of public internet resources
- Port restriction enforcement

See `api/tests/integration_tests/ssrf_proxy/TEST_CASES_README.md` for detailed testing documentation.

## Troubleshooting

If your application needs to access a service that's being blocked:

1. Check the Squid logs to identify what's being blocked
1. Create a custom configuration in `/etc/squid/conf.d/`
1. Only allow the minimum necessary access
1. Test thoroughly to ensure security is maintained

## File Structure

```
docker/ssrf_proxy/
├── squid.conf.template       # SSRF protection configuration  
├── docker-entrypoint.sh      # Container entrypoint script
├── conf.d.example/           # Example override configurations
│   ├── 00-testing-environment.conf.example
│   ├── 10-allow-internal-services.conf.example
│   ├── 20-allow-external-domains.conf.example
│   ├── 30-allow-additional-ports.conf.example
│   └── 40-restrict-to-allowlist.conf.example
├── conf.d.dev/               # Development mode configuration
│   └── 00-development-mode.conf  # Disables all SSRF protections
├── docker-compose.dev.yaml   # Docker Compose overlay for dev mode
└── README.md                 # This file
```
