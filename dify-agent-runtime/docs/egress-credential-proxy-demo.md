# Egress Credential Proxy — Demo Guide

This guide demonstrates the multi-tenant egress credential proxy system for Dify Agent's local sandbox. It walks through configuring a system-level credential manifest, understanding the architecture, and verifying that credentials are injected transparently — without ever appearing as plaintext environment variables in the job process.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  local_sandbox container                                            │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────┐    ┌───────────────┐  │
│  │  Agent Job   │    │  Egress MITM Proxy   │    │  Squid (SSRF) │  │
│  │  (tmux)      │───▶│  127.0.0.1:18080     │───▶│  agent_ssrf   │  │
│  │              │    │                      │    │  _proxy:3128  │  │
│  │  env:        │    │  ┌────────────────┐  │    └──────┬────────┘  │
│  │  HTTP_PROXY  │    │  │   Resolver     │  │           │           │
│  │  HTTPS_PROXY │    │  │  system tier   │  │           ▼           │
│  │  TAVILY_API_ │    │  │  session tier  │  │     ┌──────────┐      │
│  │  KEY=__secret│    │  │  (per sandbox) │  │     │ Internet │      │
│  │  :tavily/    │    │  └────────────────┘  │     │  (e.g.   │      │
│  │  api_key__   │    │                      │     │  tavily) │      │
│  └──────────────┘    │  1. Inject headers   │     └──────────┘      │
│                      │  2. Replace          │                       │
│                      │     placeholders     │                       │
│                      │  3. Strip Proxy-Auth │                       │
│                      └──────────────────────┘                       │
│                                                                     │
│  system-credentials.yaml ──▶ loaded at startup into system tier     │
│  (mounted read-only via Docker volume)                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Key components

- **System credential manifest** (`system-credentials.yaml`): Mounted into the container via Docker volume. Parsed at startup (YAML or JSON). Credentials enter the Resolver's **system tier** — shared across all sandbox sessions, never mutated at runtime.

- **Session credentials**: Registered per sandbox session via `PUT /v1/prepare` API (with `sandbox_id`). Stored in the Resolver's **session tier** — isolated per sandbox, no cross-session leakage. Session credentials shadow system credentials on key conflict.

- **Egress MITM Proxy** (`127.0.0.1:18080`): Intercepts all outbound HTTP/HTTPS traffic from agent jobs. For HTTPS, it performs TLS interception using a per-container CA (generated fresh at startup, installed into the system trust store). The proxy:
  1. Extracts `sandbox_id` from the `Proxy-Authorization` header (embedded as Basic-Auth userinfo in the proxy URL).
  2. **Proactively injects** credential headers based on domain-matching policies (e.g. `Authorization: Bearer <token>` for `api.tavily.com`).
  3. **Replaces placeholders** like `__secret:tavily/api_key__` in request headers and URL query parameters with resolved credential values.
  4. Strips the `Proxy-Authorization` header before forwarding.

- **Squid SSRF proxy** (`agent_ssrf_proxy:3128`): Upstream of the egress proxy. Enforces network-level egress restrictions (deny private networks, allow public internet).

- **Per-container CA**: Generated at startup by `egressproxy.GenerateCA()`. Installed into the system trust store via `update-ca-certificates` (Dockerfile grants the non-root `dify` user write access to the necessary paths). This means **all** tools — including `apt-get`, `wget`, Java, etc. — trust the MITM proxy's TLS certificates without needing per-tool env vars.

---

## Step 1: Configure the credential manifest

Create the system credential manifest at `docker/volumes/local_sandbox/system-credentials.yaml`:

```yaml
credentials:
  - provider: tavily
    name: api_key
    value: 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
    env_name: TAVILY_API_KEY
    inject:
      type: http-header
      http_header:
        name: Authorization
        expr: "Bearer {{.Value}}"
        domains:
          - api.tavily.com
```
