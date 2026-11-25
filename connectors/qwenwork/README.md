# QwenWork (千问办公): connect your own Dify

QwenWork's marketplace takes one fixed address per connector, and Dify has no single address. A customer adds their own Dify as a connector instead.

## What you need

- A Dify release that includes the `/openapi/v1/mcp` endpoint.
- `OPENAPI_ENABLED=true` on the Dify server.
- Your Dify host name.
- A personal access token (prefix `dpat_`, recommended) or a workspace access token. The token's app access decides which apps the agent can find and run. Workspace access is needed for plugins, model providers and tool credentials.
- An HTTPS address with a valid certificate. QwenWork documents that marketplace connectors refuse plain HTTP, self-signed certificates and internal addresses. It does not document this for enterprise or desktop custom connectors.

## Enterprise connector (admin console, 企业旗舰版 (Enterprise Ultimate))

The admin builds one connector for the whole organisation ("企业自建连接器").

1. In "认证与凭据" choose "API Key（用户提供）".
2. Set the header name to `Authorization` and the value prefix to `Bearer `. Each member enters their own token in the client, so the console never stores it.
3. In "连接协议" fill the full address of the MCP service, `https://<your Dify host>/openapi/v1/mcp`, with transport HTTP, then click "校验配置检查".

## Custom connector in the desktop app

1. Open "扩展" > "连接器", then "添加" > "手动填写配置".
2. Choose "Streamable HTTP" as the server type and enter `https://<your Dify host>/openapi/v1/mcp`.
3. Under "Headers", add `Authorization` with the value `Bearer <token>`.

If your organisation turns off "允许自行添加连接器", members cannot do this.

## What a personal token can do

- Find and run the apps chosen for the token, and answer human-input forms.
- Manage plugins, model providers and tool credentials.

A workspace token can list and run apps. It cannot answer a human-input pause, and it cannot reach plugins, model providers or tool credentials.

## Notes

- File upload is not available over MCP. Pass a file to an app as a URL in its inputs.
- A bad token gets a 401 from Dify.
