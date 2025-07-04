# Debugging with VS Code

This `launch.json.template` file provides various debug configurations for the Dify project within VS Code / Cursor. To use these configurations, you should copy the contents of this file into a new file named `launch.json` in the same `.vscode` directory.

## How to Use

1.  **Create `launch.json`**: If you don't have one, create a file named `launch.json` inside the `.vscode` directory.
2.  **Copy Content**: Copy the entire content from `launch.json.template` into your newly created `launch.json` file.
3.  **Select Debug Configuration**: Go to the Run and Debug view in VS Code / Cursor (Ctrl+Shift+D or Cmd+Shift+D).
4.  **Start Debugging**: Select the desired configuration from the dropdown menu and click the green play button.

## Tips

- If you need to debug with Edge browser instead of Chrome, modify the `serverReadyAction` configuration in the "Next.js: debug full stack" section, change `"debugWithChrome"` to `"debugWithEdge"` to use Microsoft Edge for debugging.
