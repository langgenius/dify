# Dify in WorkBuddy

WorkBuddy reaches your Dify server through the tools `dify_find`, `dify_read`, `dify_write` and `dify_destructive`. Use them, not difyctl: in WorkBuddy this overrides "Pick one way in" below. Read [`references/mcp.md`](references/mcp.md) first. `dify_find` takes `query` to search or `op` to describe one operation; `dify_read`, `dify_write` and `dify_destructive` take `op` and `input`.

- The human typed a Dify host and an access token in the connector's form. You cannot log in or change them.
- The token's app access decides which apps you can find and run. Find them with `get.console_app`: it needs no workspace. `get.workspace` may list no workspace; then the token cannot manage plugins, model providers or tool credentials. Ask for workspace access when the task needs it.
- When the server refuses the token, WorkBuddy reports the Dify connection as unauthorized instead of returning a tool result. The token has expired or was revoked. Ask the human to open the Dify connector in WorkBuddy and connect again with a new token.
- A workspace token can only find and run apps. When the task needs more, such as plugins, model providers, tool credentials or filling in a human-input form, ask the human to connect again with a personal access token.

Talk to the human in their language.
