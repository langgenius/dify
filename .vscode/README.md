# Debugging with VS Code

This `launch.json.template` file provides various debug configurations for the
Dify project within VS Code / Cursor. To use these configurations, copy the
contents into a new file named `launch.json` in the same `.vscode` directory.

## How to Use

1. **Create `launch.json`**: If you don't have one, create a file named `launch.json` inside the `.vscode` directory.
1. **Copy Content**: Copy the entire content from `launch.json.template` into your newly created `launch.json` file.
1. **Select Debug Configuration**: Go to the Run and Debug view in VS Code / Cursor (Ctrl+Shift+D or Cmd+Shift+D).
1. **Start Debugging**: Select the desired configuration from the dropdown menu and click the green play button.

## Tips

- The backend runtime is gevent-only. The provided API, Celery worker, and
  Celery beat configurations already set `"gevent": true` and
  `GEVENT_SUPPORT=True` so debugpy and the runtime agree on the execution
  model.
- The API debug configuration starts Gunicorn directly. Do not switch it back
  to `flask run` or `python -m app`, because those startup paths do not match
  the supported gevent runtime model.
- If you need to debug with Edge browser instead of Chrome, modify the `serverReadyAction` configuration in the "Next.js: debug full stack" section, change `"debugWithChrome"` to `"debugWithEdge"` to use Microsoft Edge for debugging.
