# Agents

An Agent app is not a console app: `get console_app` never lists it. Use the agent ops, with `agent_id` from `get agent`.

- `difyctl get agent` lists every Agent you can see. Each row has `agent_id`, `app_id`, `published` and `service_api_enabled`.
- `difyctl describe agent --agent-id <agent_id>` shows the inputs a run takes (`input_schema`) and the next step in `hints`.
- `difyctl run agent --agent-id <agent_id> --query "<message>"` runs the published version. Pass `--conversation-id` to reply in a conversation.
- `difyctl test agent --agent-id <agent_id> --query "<message>"` runs the draft. It needs the editor role.

When `run agent` refuses:

- `agent_not_published`: use `test agent`, or ask the human to publish the Agent in the Dify console.
- `service_api_disabled`: its hint turns the Service API on. Only an admin can, and only after the Agent is published. Ask the human first.
- 403 with the message `user_not_allowed_for_private_app`: the account may not open the Agent's web app. See `difyctl describe webapp_access agent --app-id <app_id>`.

Settings take `app_id`, not `agent_id`: `set service_api agent`, `set webapp agent`, `set webapp_access agent`.

Create, edit and publish Agents in the Dify console; difyctl can't.
