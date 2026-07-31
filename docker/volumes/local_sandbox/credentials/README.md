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
      config:
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
      config:
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
      config:
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
| `inject.config` | Type-specific config payload (see examples above) |
