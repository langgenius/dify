# Development with devcontainer

This project includes a devcontainer configuration that allows you to open the project in a container with a fully configured development environment.
The create hook installs workspace JavaScript dependencies and `uv`; the start hook synchronizes backend dependencies. Follow the [backend setup](../api/README.md) and [frontend guide](../web/README.md) to configure environment files and start services.

## GitHub Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/langgenius/dify)

you can simply click the button above to open this project in GitHub Codespaces.

For more info, check out the [GitHub documentation](https://docs.github.com/en/free-pro-team@latest/github/developing-online-with-codespaces/creating-a-codespace#creating-a-codespace).

## VS Code Dev Containers

[![Open in Dev Containers](https://img.shields.io/static/v1?label=Dev%20Containers&message=Open&color=blue&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/langgenius/dify)

if you have VS Code installed, you can click the button above to open this project in VS Code Dev Containers.

You can learn more in the [Dev Containers documentation](https://code.visualstudio.com/docs/devcontainers/containers).

## Troubleshooting

if you see such error message when you open this project in codespaces:
![Alt text](troubleshooting.png)

a simple workaround is change `/signin` endpoint into another one, then login with GitHub account and close the tab, then change it back to `/signin` endpoint. Then all things will be fine.
The reason is `signin` endpoint is not allowed in codespaces, details can be found [here](https://github.com/orgs/community/discussions/5204)
