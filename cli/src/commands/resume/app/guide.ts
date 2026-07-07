export const agentGuide = `
WHEN TO USE
  Continue a workflow that paused for human input. run app (or a prior
  resume app) exits 0 and prints a JSON object with status "paused",
  form_token, workflow_run_id and resolved_default_values. Resume with:
    difyctl resume app <app_id> <form_token> --workflow-run-id <id> \\
      --inputs '{"name":"Alice"}' -o json

LOOP
  A resume can pause again (exit 0 with a new form_token and status
  "paused"). Repeat until the output is no longer a pause. Pass --stream
  to print events live.

ERROR RECOVERY
  not logged in (exit 4)    difyctl auth login
  stale form/run id         re-run the app to get a fresh pause token
`
