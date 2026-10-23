# Debugging with VS Code

[`launch.json.template`](launch.json.template) provides API and Celery worker debug configurations for VS Code / Cursor. Both use `api/.venv/bin/python`; complete the [backend setup](../api/README.md) first.

## How to Use

1. Copy `.vscode/launch.json.template` to `.vscode/launch.json`, or merge the configurations into an existing file.
1. **Select Debug Configuration**: Go to the Run and Debug view in VS Code / Cursor (Ctrl+Shift+D or Cmd+Shift+D).
1. **Start Debugging**: Select the desired configuration from the dropdown menu and click the green play button.

Start the frontend separately using the [frontend guide](../web/README.md).

## Frontend OpenAPI types

After installing workspace dependencies, install the TypeScript 7 extension
(`TypeScriptTeam.native-preview`). Copy `settings.example.json` to `settings.json`,
or merge its three `js/ts.*` settings into your existing configuration. Open the
repository root in a trusted workspace, then open a consuming TypeScript file so
the language server loads the project's Content Mapper configuration.

If lifecycle scripts were disabled during installation, first run
`pnpm --filter @dify/contracts compose:console` and
`pnpm --filter @dify/openapi-content-mapper build`. Local `settings.json` remains
ignored; the shared template is exercised by the Console language-server test.
