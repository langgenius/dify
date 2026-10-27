# OpenAPI Backend Navigation (preview)

Adds **Go to Definition** (F12 / Cmd+click) and **Go to Implementation** to backend
links emitted by `@dify/openapi-content-mapper`. Hover links also work without this
extension. TypeScript 7.1 content mappers must already be enabled in the workspace.

The extension asks the active TypeScript hover provider for the resolved symbol's
backend link. It does not run exporters, parse TypeScript, or create index files.
Both `api` and `query` method properties are supported, including import aliases.
Existing schema definitions remain available; VS Code may show multiple targets
when a file-backed contract also has a schema definition. Use Go to Implementation
to select the backend alone. Missing local backend files are skipped.

From this directory, package and install locally (no marketplace publication):

```sh
pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license
code --install-extension openapi-backend-navigation-0.1.0.vsix --force
```

Reload the VS Code window after installation. On `consoleClient.datasets.get`,
hover to click **Open backend implementation**, or press F12 on `get`.
