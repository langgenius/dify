# System Credentials Directory

All `.yaml`, `.yml`, and `.json` files in this directory are loaded at startup
and merged into the egress proxy's **system credential tier**. Files are loaded
in alphabetical order; later files override earlier ones on `provider/name`
conflicts.

Files matching `*.cred.yaml`, `*.cred.yml`, and `*.cred.json` are gitignored
(see `.gitignore`) to prevent accidental commits of real secrets.

## Example: simple header injection (API key)

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

## Example: AWS S3 with SigV4 re-signing

```yaml
credentials:
  - provider: aws
    name: s3_prod
    value:                              # structured value (object, not string)
      access_key_id: AKIAIOSFODNN7EXAMPLE
      secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
      session_token: ""                 # optional, only for temporary credentials
    env_names:                          # one credential → multiple env vars
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
      - AWS_SESSION_TOKEN
    inject:
      type: aws-sigv4
      aws_sigv4:
        service: s3                     # defaults to "s3" if omitted
        # region: us-east-1             # omit to auto-extract from hostname
        domains:
          - "*.amazonaws.com"
```

The proxy strips any client-supplied AWS auth headers and re-signs with the
real credentials, so both `curl` (no signature) and `aws cli` (placeholder-based
fake signature from env vars) work transparently.

## Example: Cloudflare R2 (S3-compatible)

```yaml
credentials:
  - provider: cloudflare
    name: r2_prod
    value:
      access_key_id: <R2 Access Key ID>
      secret_access_key: <R2 Secret Access Key>
    env_names:
      - AWS_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY
    inject:
      type: aws-sigv4
      aws_sigv4:
        region: auto          # R2 is region-less; must set explicitly
        service: s3
        domains:
          - "*.r2.cloudflarestorage.com"
```

## Field reference

| Field | Description |
|---|---|
| `provider` | Credential provider namespace (e.g. `tavily`, `aws`) |
| `name` | Credential name within the provider (e.g. `api_key`, `s3_prod`) |
| `value` | The secret value — a string for simple credentials, or an object for structured credentials (e.g. AWS) |
| `env_name` | Single env var name exposed to jobs as a `__secret:provider/name__` placeholder (optional; auto-derived as `PROVIDER_NAME` uppercased if omitted) |
| `env_names` | Multiple env var names, all pointing to the same `__secret:provider/name__` placeholder (for structured credentials like AWS that need several standard env vars) |
| `inject.type` | Injection policy: `http-header` or `aws-sigv4` |
| `inject.http_header.name` | HTTP header to inject (e.g. `Authorization`) |
| `inject.http_header.expr` | Go text/template with `{{.Value}}` (e.g. `Bearer {{.Value}}`) |
| `inject.http_header.domains` | Host patterns to match (empty = all; supports `*.example.com`) |
| `inject.aws_sigv4.region` | AWS region for signing (omit to auto-extract from hostname; use `auto` for R2) |
| `inject.aws_sigv4.service` | AWS service name (e.g. `s3`, `execute-api`; defaults to `s3`) |
| `inject.aws_sigv4.domains` | Host patterns to match (empty = all; supports `*.example.com`) |

## How it works

1. At container startup, the egress proxy loads all manifest files from this
   directory (mounted read-only at `/etc/shellctl/credentials`).
2. Credentials enter the resolver's **system tier** — shared across all sandbox
   sessions, never mutated at runtime.
3. When a job makes an outbound HTTP request through the proxy:
   - If the request host matches a credential's `domains`, the proxy
     **proactively injects** the credential (header or signature).
   - If the request contains `__secret:provider/name__` placeholders in headers
     or query params, the proxy **replaces** them with the real value (string
     credentials only; structured credentials are not substituted into text).
4. Jobs receive env vars like `TAVILY_API_KEY=__secret:tavily/api_key__` — a
   placeholder, not the real secret. The proxy resolves it transparently.

### AWS SigV4 details

For `aws-sigv4` credentials, the proxy:

1. **Strips** any client-supplied `Authorization`, `X-Amz-Date`,
   `X-Amz-Content-Sha256`, and `X-Amz-Security-Token` headers.
2. **Detects body signing mode** from the client's `X-Amz-Content-Sha256`:
   - Hex SHA-256 hash: buffers body (≤10 MiB), computes hash, signs with it.
   - `UNSIGNED-PAYLOAD`: signs headers only, no body hash.
   - `STREAMING-UNSIGNED-PAYLOAD-TRAILER`: streams body through, signs headers only.
   - Other `STREAMING-*` variants: rejected (cannot reproduce per-chunk signatures).
   - Absent: treated as `UNSIGNED-PAYLOAD`.
3. **Extracts region** from the hostname (e.g. `s3.us-east-1.amazonaws.com` →
   `us-east-1`), or uses the explicit `region` from the policy. R2 hostnames
   (`.r2.cloudflarestorage.com`) resolve to `auto`.
4. **Re-signs** with real credentials using `aws-sdk-go-v2`.

This means `aws cli` / `boto3` (which sign with placeholder env vars, producing
a fake signature) and `curl` (which doesn't sign at all) both work — the proxy
overwrites the signature with real credentials.

### Limitations

- `__secret:provider/name__` placeholders for structured (non-string) credentials
  are not substituted into request text — they are only used via the injection
  policy.
- Chunk-signed streaming uploads (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`) are
  rejected. Use unsigned payload mode instead.
- Body buffering for signed mode is capped at 10 MiB.
- SigV4 is sensitive to clock skew (±15 minutes). Ensure NTP is running.
