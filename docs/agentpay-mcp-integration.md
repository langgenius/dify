# AgentPay MCP Payments Integration Guide

This guide explains how to connect and use the AgentPay MCP Payments plugin with Dify, enabling agents and workflows to discover, fund, and invoke paid tools securely.

---

## 1. Prerequisites
- Dify instance (v1.13.0+ recommended)
- AgentPay MCP server (HTTP or stdio)
- AgentPay Gateway Key (starts with `apg_...`)
- (Optional) Node.js for local stdio mode

---

## 2. Get Your AgentPay Gateway Key
Register for a gateway key:
```bash
curl -X POST https://agentpay.metaltorque.dev/gateway/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```
Save the returned key (format: `apg_...`).

---

## 3. Start the AgentPay MCP Server
- **Recommended (HTTP):**
  ```bash
  npx -y supergateway --stdio "npx -y mcp-server-agentpay" --port 8000
  # HTTP endpoints: http://localhost:8000/message (POST), http://localhost:8000/sse (SSE)
  ```
- **Direct stdio (fallback):**
  ```bash
  npx -y mcp-server-agentpay
  ```

---

## 4. Add MCP Server in Dify
1. Go to **Tools → MCP → Add MCP Server (HTTP)**
2. Fill in:
   - **Server URL:** `http://localhost:8000/message` (or your HTTP endpoint)
   - **Name:** `AgentPay`
   - **Server Identifier:** `agentpay`
   - **Headers:** Add `X-AgentPay-Gateway-Key: apg_...`
   - **Dynamic Client Registration:** OFF
   - Leave Client ID/Secret blank
3. Save and authorize.
4. Click **Fetch Tools** to load available tools.

---

## 5. Attach Tools to Agents/Workflows
- Enable tools like `discover_tools`, `check_balance`, `call_tool` in your workflow or agent config.
- Example prompts:
  - "Search for web scraping tools."
  - "Check my AgentPay balance."
  - "Call a paid tool with arguments: { ... }"

---

## 6. Troubleshooting
- **No tools appear:**
  - Check MCP server logs for errors
  - Ensure gateway key is correct and in headers
  - Try both `/message` and `/sse` endpoints for Server URL
- **Tool call fails:**
  - Check Dify plugin logs for error details
  - Confirm MCP server is running and reachable
  - Test with curl (see below)
- **Test MCP directly:**
  ```bash
  curl -X POST http://localhost:8000/message \
    -H "Content-Type: application/json" \
    -H "X-AgentPay-Gateway-Key: apg_..." \
    -d '{"tool":"check_balance","args":{}}'
  ```

---

## 7. Security & Best Practices
- Never commit gateway keys to source control
- Rotate keys if exposed
- Restrict tool usage in production
- All payments are routed via AgentPay gateway; no private key custody

---

## 8. Support
- For advanced troubleshooting, see the operator runbook or contact plugin maintainers.
