export const agentGuide = `
WHEN TO USE
  A studio app is what you build and edit in Studio on the web console,
  inside a workspace — the app's source definition. Import materialises a
  DSL YAML into a new (or existing) studio app; pair it with
  'export studio-app' to move an app between workspaces or instances. To
  run or inspect the result, switch to the 'app' noun.

BEHAVIOUR
  A DSL version mismatch is auto-confirmed; no second command needed.
  Missing plugin dependencies are listed on stderr — install them before
  running the app.

ERROR RECOVERY
  workspace required        difyctl get workspace
  not logged in (exit 4)    difyctl auth login
`
