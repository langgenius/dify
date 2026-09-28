export const agentGuide = `
WHEN TO USE
  Establish a session before any authenticated command. Interactive browser
  device flow:
    difyctl auth login
    difyctl auth login --host https://cloud.dify.ai
    difyctl auth login --no-browser     print the code/URL instead of opening

NON-INTERACTIVE
  Agents without a browser can supply a bearer token via the DIFY_TOKEN env
  var instead of logging in; difyctl reads it on every command. See
  'difyctl help account' and 'difyctl help external'.

AFTER LOGIN
  difyctl auth whoami      check the active session
  difyctl auth list        list every authenticated context
  difyctl get app          list apps
`
