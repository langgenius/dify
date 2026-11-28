# QwenWork: connect your own Dify

QwenWork's marketplace takes one fixed address per connector, and Dify has no single address. A customer adds their own Dify as a connector instead.

## What you need

- A Dify release that includes the `/openapi/v1/mcp` endpoint.
- `OPENAPI_ENABLED=true` on the Dify server.
- Your Dify host name.
- A personal access token (prefix `dpat_`, recommended) or a workspace access token. The token's app access decides which apps the agent can find and run. Workspace access is needed for plugins, model providers and tool credentials.
- An HTTPS address with a valid certificate. QwenWork documents that marketplace connectors refuse plain HTTP, self-signed certificates and internal addresses. It does not document this for enterprise or desktop custom connectors.

## Enterprise connector (admin console, Enterprise Ultimate edition)

The admin builds one self-built connector for the whole organisation.

1. In "Authentication and credentials" choose "API Key (user-provided)".
2. Set the header name to `Authorization` and the value prefix to `Bearer `. Each member enters their own token in the client, so the console never stores it.
3. In "Connection protocol" fill the full address of the MCP service, `https://<your Dify host>/openapi/v1/mcp`, with transport HTTP, then click "Check configuration".

## Custom connector in the desktop app

1. Open "Extensions" > "Connectors", then "Add" > "Configure manually".
2. Choose "Streamable HTTP" as the server type and enter `https://<your Dify host>/openapi/v1/mcp`.
3. Under "Headers", add `Authorization` with the value `Bearer <token>`.

If your organisation turns off "Allow members to add connectors", members cannot do this.

## What a personal token can do

- Find and run the apps chosen for the token, and answer human-input forms.
- Manage plugins, model providers and tool credentials.

A workspace token can list and run apps. It cannot answer a human-input pause, and it cannot reach plugins, model providers or tool credentials.

## Notes

- An agent whose shell can reach the Dify server can send a local file as a run input: it calls `prepare.upload` and runs the command it returns. Skill operations refuse personal and workspace tokens, so with these tokens their files stay out of reach. A URL in an app's inputs still works.
- A bad token gets a 401 from Dify.
