export const agentGuide = `
WORKFLOW
  1. Discover app id and mode:
       difyctl get app -o json
       difyctl describe app <id> -o json | jq '.info.mode'

  2. Run the app:
       difyctl run app <id> "your message"
       difyctl run app <id> --inputs '{"key":"value"}' -o json

APP MODES
  chat / agent-chat /    Conversational. Accept --conversation <id> to
  advanced-chat          resume an existing thread. agent-chat adds
                         autonomous tool use.
  completion             Single-turn. Ignores --conversation.
  workflow               Multi-step graph. Pass all input variables as a
                         JSON object via --inputs.

HITL PAUSE (exit code 0 — success-with-pending)
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
