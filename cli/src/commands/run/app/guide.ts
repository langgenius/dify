export const agentGuide = `
WORKFLOW
  1. Discover app id and mode:
       difyctl get app -o json
       difyctl describe app <id> -o json | jq '.info.mode'

  2. Run the app:
       difyctl run app <id> "your message"
       difyctl run app <id> --inputs '{"key":"value"}' -o json

APP MODES
  chat / advanced-chat   Conversational. Accepts --conversation <id> to
                         resume an existing thread.
  completion             Single-turn. Ignores --conversation.
  workflow               Multi-step graph. Pass all input variables as a
                         JSON object via --inputs.
  agent-chat             Conversational with autonomous tool use.

FLAGS
  --inputs '{"k":"v"}'   All input variables as one JSON object.
                           --inputs '{"language":"English","topic":"AI safety"}'
  --inputs-file path     Load inputs from a JSON file. Mutually exclusive
                         with --inputs.
  --file key=@path       Named file input. Supports local files (--file key=@/path/to/file)
                         and remote URLs (--file key=https://url). Repeatable for multiple
                         file inputs.
  --stream               Print output live as tokens/events arrive.
  --conversation <id>    Resume a conversation (chat/advanced-chat only).
  --workspace <id>       Target a specific workspace.

HITL PAUSE (exit code 2)
  When a workflow pauses for human input, stdout receives a JSON object
  with status "paused", form_token, workflow_run_id, and resolved_default_values.
  Resume with:
    difyctl resume app <app_id> <form_token> --workflow-run-id <id>
  You can supply form values by:
    difyctl resume app <app_id> <form_token> --workflow-run-id <id> --inputs '{"name":"Alice"}'

ERROR RECOVERY
  not logged in          difyctl auth login
  app not found (404)    difyctl get app
  workspace required     difyctl get workspace
`
