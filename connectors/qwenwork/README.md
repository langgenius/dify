# QwenWork (千问办公): connect your own Dify

QwenWork's marketplace takes one fixed address per connector, and Dify has no single address. A customer adds their own Dify as a connector instead.

## What you need

- A Dify release that includes the `/openapi/v1/mcp` endpoint.
- `OPENAPI_ENABLED=true` on the Dify server.
- Your Dify host name.
- A personal access token (prefix `dpat_`, recommended) or a workspace access token.
- A public HTTPS address with a valid certificate. QwenWork's web version reaches Dify from the internet. HTTP, self-signed certificates, localhost and internal addresses fail.

## Enterprise connector (admin console, 企业旗舰版 Enterprise Flagship edition)

The admin builds one connector for the whole organisation ("企业自建连接器").

1. Create a connector of type HTTP MCP.
2. In "连接协议" enter the full address `https://<your Dify host>/openapi/v1/mcp`, then run the config check.
3. In "认证与凭据" choose "API Key（用户提供）".
4. Set the header name to `Authorization` and the value prefix to `Bearer `. Each member enters their own token in the client, so the console never stores it.

## Custom connector in the desktop app

1. Open "扩展" > "连接器" and choose "+ Add".
2. Choose "Streamable HTTP" as the server type and enter `https://<your Dify host>/openapi/v1/mcp`.
3. Under "Headers", add `Authorization` with the value `Bearer <token>`.

If your organisation turns off "允许自行添加连接器", members cannot do this.

## What a personal token can do

- Find and run apps, and answer human-input forms.
- Manage plugins, model providers and tool credentials.
- It cannot create, change or publish apps.
- File upload is not available over MCP. Pass a file to an app as a URL in its inputs.
- A waiting call takes up to 45 seconds (default 25).
- A bad token gets a 401 from Dify.

A workspace token can list and run apps. It cannot answer a human-input pause, and it cannot reach plugins, model providers or tool credentials.
