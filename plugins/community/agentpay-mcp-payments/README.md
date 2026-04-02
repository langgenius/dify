# AgentPay Payment Layer (Dify Tool Plugin)

Community tool plugin for AgentPay MCP operations in Dify workflows.

## Scope

This plugin is intended for tool execution in workflows (direct tool nodes).

Provided tools:

- `discover_tools`
- `list_tools`
- `check_balance`
- `fund_wallet_stripe`
- `call_tool`
- `get_usage`

## Prerequisites

- Dify running and plugin daemon healthy
- Valid AgentPay gateway key (`apg_...`)
- Reachable MCP endpoint

Register key:

```bash
curl -X POST https://agentpay.metaltorque.dev/gateway/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

## MCP Runtime Topology

Use one topology only during a test run.

### Option A: Host runtime (recommended for local source-mode API)

Run on host:

```bash
npx -y supergateway@3.4.3 --stdio "npx -y mcp-server-agentpay" --port 8000 --outputTransport streamableHttp
```

Set MCP URL in Dify:

```text
http://127.0.0.1:8000/mcp
```

### Option B: Docker runtime

Run in Docker with published port:

```bash
docker run --name agentpay-supergateway --rm -d -p 8000:8000 node:20-alpine sh -c "npx -y supergateway@3.4.3 --stdio 'npx -y mcp-server-agentpay' --port 8000 --outputTransport streamableHttp"
```

Set MCP URL in Dify:

```text
http://127.0.0.1:8000/mcp
```

## Dify Provider Configuration

Required credential:

- `AgentPay Gateway Key`

Optional credential overrides:

- `AgentPay Gateway URL`
- `AgentPay MCP HTTP URL`
- `Launch mode` (`auto`, `http`, `stdio`)
- `stdio command` (default `npx`)

## Workflow Wiring (Direct Tool Execution)

Minimal flow:

1. `Start`
1. `check_balance` tool node
1. `Answer` node

Answer template:

```text
{{#<check_balance_node_id>.text#}}
```

Insert variable from picker (`CHECK_BALANCE -> text`) so node ID stays correct.

## Verification Checklist

Success requires both:

1. Tool node last run status = `SUCCESS`
1. Supergateway log shows `"method":"tools/call"` with `"name":"check_balance"`

If you only see `initialize` and `tools/list`, execution did not reach tool invoke path.

## Common Issues

### Tool timeout

Cause: plugin daemon cannot reach MCP URL.

Fix:

- ensure MCP URL matches active topology
- avoid mixed host/container URLs in the same test session

### Empty answer

Cause: wrong output mapping.

Fix:

- map `CHECK_BALANCE -> text` in `Answer`

### Accept header error in manual tests

Manual probes against streamable HTTP must send:

- `Accept: application/json, text/event-stream`

This does not affect Dify normal MCP calls.

## Contribution Notes

Aligned with Dify contribution guidance:

- keep changes scoped and minimal
- include reproducible logs for bug fixes
- link an issue in PR description
- include screenshots for workflow/tool verification
