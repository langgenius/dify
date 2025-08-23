# SSRF Proxy Configuration

This directory contains the Squid proxy configuration used to prevent Server-Side Request Forgery (SSRF) attacks in Dify.

## Security by Default

The default configuration (`squid.conf.template`) is **strict by default** to prevent SSRF attacks:

- **Blocks all private/internal networks** (RFC 1918, loopback, link-local, etc.)
- **Only allows HTTP (80) and HTTPS (443) ports**
- **Allows access to Dify marketplace** (marketplace.dify.ai) by default
- **Denies all other requests by default** unless explicitly allowed

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

## Troubleshooting

If your application needs to access a service that's being blocked:

1. Check the Squid logs to identify what's being blocked
1. Create a custom configuration in `/etc/squid/conf.d/`
1. Only allow the minimum necessary access
1. Test thoroughly to ensure security is maintained

## File Structure

```
docker/ssrf_proxy/
├── squid.conf.template       # Strict default configuration
├── docker-entrypoint.sh      # Container entrypoint script
├── conf.d.example/           # Example override configurations
│   ├── 00-testing-environment.conf.example
│   ├── 10-allow-internal-services.conf.example
│   ├── 20-allow-external-domains.conf.example
│   └── 30-allow-additional-ports.conf.example
└── README.md                 # This file
```
