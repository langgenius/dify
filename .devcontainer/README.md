# Development with devcontainer
This project includes a devcontainer configuration that allows you to open the project in a container with a fully configured development environment.
Both frontend and backend environments are initialized when the container is started.
## GitHub Codespaces
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/langgenius/dify)

you can simply click the button above to open this project in GitHub Codespaces.

For more info, check out the [GitHub documentation](https://docs.github.com/en/free-pro-team@latest/github/developing-online-with-codespaces/creating-a-codespace#creating-a-codespace).


## VS Code Dev Containers
[![Open in Dev Containers](https://img.shields.io/static/v1?label=Dev%20Containers&message=Open&color=blue&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/langgenius/dify)

if you have VS Code installed, you can click the button above to open this project in VS Code Dev Containers.

You can learn more in the [Dev Containers documentation](https://code.visualstudio.com/docs/devcontainers/containers).


## Pros of Devcontainer
Unified Development Environment: By using devcontainers, you can ensure that all developers are developing in the same environment, reducing the occurrence of "it works on my machine" type of issues.

Quick Start: New developers can set up their development environment in a few simple steps, without spending a lot of time on environment configuration.

Isolation: Devcontainers isolate your project from your host operating system, reducing the chance of OS updates or other application installations impacting the development environment.

## Cons of Devcontainer
Learning Curve: For developers unfamiliar with Docker and VS Code, using devcontainers may be somewhat complex.

Performance Impact: While usually minimal, programs running inside a devcontainer may be slightly slower than those running directly on the host.

## Troubleshooting
if you see such error message when you open this project in codespaces:
![Alt text](troubleshooting.png)

a simple workaround is change `/signin` endpoint into another one, then login with GitHub account and close the tab, then change it back to `/signin` endpoint. Then all things will be fine.
The reason is `signin` endpoint is not allowed in codespaces, details can be found [here](https://github.com/orgs/community/discussions/5204)