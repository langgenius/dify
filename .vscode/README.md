# Debugging with VS Code

[`launch.json.template`](launch.json.template) provides API and Celery worker debug configurations for VS Code / Cursor. Both use `api/.venv/bin/python`; complete the [backend setup](../api/README.md) first.

## How to Use

1. Copy `.vscode/launch.json.template` to `.vscode/launch.json`, or merge the configurations into an existing file.
1. **Select Debug Configuration**: Go to the Run and Debug view in VS Code / Cursor (Ctrl+Shift+D or Cmd+Shift+D).
1. **Start Debugging**: Select the desired configuration from the dropdown menu and click the green play button.

Start the frontend separately using the [frontend guide](../web/README.md).
