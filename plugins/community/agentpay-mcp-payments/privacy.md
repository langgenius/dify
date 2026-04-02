# Privacy Policy

This plugin sends user-supplied tool parameters and credential-backed requests to AgentPay endpoints for payment operations.

## Data processed

- provider credentials configured by workspace admins
- tool input parameters passed at runtime
- response payloads returned by AgentPay MCP server/gateway

## Data retention

This plugin does not intentionally persist user data beyond runtime process memory.

## Security notes

- Never commit gateway keys into source control.
- Rotate keys if exposed.
- Restrict tool usage in production with least-privilege principles.
