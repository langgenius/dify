export const agentGuide = `
WHEN TO USE
  A studio app is what you build and edit in Studio on the web console,
  inside a workspace — the app's source definition, not the published app
  that 'run app' invokes. Export pulls that definition as YAML to back it
  up, diff it, or recreate the app elsewhere with 'import studio-app'. To
  run or inspect an app instead, use the 'app' noun.

ERROR RECOVERY
  app not found (404)      difyctl get app
  not logged in (exit 4)   difyctl auth login
`
