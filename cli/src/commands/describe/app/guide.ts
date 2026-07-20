export const agentGuide = `
WHEN TO USE
  Inspect one app before running it — reveals its mode and the input
  variables / parameters it expects:
    difyctl describe app <id> -o json
    difyctl describe app <id> -o json | jq '.info.mode'

NEXT
  Feed the discovered inputs to run:
    difyctl run app <id> --inputs '{"key":"value"}' -o json

ERROR RECOVERY
  app not found (404)      difyctl get app
  not logged in (exit 4)   difyctl auth login
`
