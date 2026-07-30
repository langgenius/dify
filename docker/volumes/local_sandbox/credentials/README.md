# System Credentials Directory

All `.yaml`, `.yml`, and `.json` files in this directory are loaded at startup
and merged into the egress proxy's **system credential tier**. Files are loaded
in alphabetical order; later files override earlier ones on `provider/name`
conflicts.

Files matching `*.cred.yaml`, `*.cred.yml`, and `*.cred.json` are gitignored
(see `.gitignore`) to prevent accidental commits of real secrets.

## Example manifest

Create a file like `tavily.cred.yaml` (gitignored):

```yaml
credentials:
  - provider: tavily
    name: api_key
    value: tvly-dev-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    env_name: TAVILY_API_KEY
    inject:
      type: http-header
      http_header:
        name: Authorization
        expr: "Bearer {{.Value}}"
        domains:
          - api.tavily.com
```

## Field reference

| Field | Description |
|---|---|
| `provider` | Credential provider namespace (e.g. `tavily`) |
| `name` | Credential name within the provider (e.g. `api_key`) |
| `value` | The actual secret value |
| `env_name` | Env var name exposed to jobs as a `__secret:provider/name__` placeholder (optional; auto-derived as `PROVIDER_NAME` uppercased if omitted) |
| `inject.type` | Injection policy: `http-header` |
| `inject.http_header.name` | HTTP header to inject (e.g. `Authorization`) |
| `inject.http_header.expr` | Go text/template with `{{.Value}}` (e.g. `Bearer {{.Value}}`) |
| `inject.http_header.domains` | Host patterns to match (empty = all; supports `*.example.com`) |

## How it works

1. At container startup, the egress proxy loads all manifest files from this
   directory (mounted read-only at `/etc/shellctl/credentials`).
2. Credentials enter the resolver's **system tier** — shared across all sandbox
   sessions, never mutated at runtime.
3. When a job makes an outbound HTTP request through the proxy:
   - If the request host matches a credential's `domains`, the proxy
     **proactively injects** the header (e.g. `Authorization: Bearer <value>`).
   - If the request contains `__secret:provider/name__` placeholders in headers
     or query params, the proxy **replaces** them with the real value.
4. Jobs receive env vars like `TAVILY_API_KEY=__secret:tavily/api_key__` — a
   placeholder, not the real secret. The proxy resolves it transparently.
