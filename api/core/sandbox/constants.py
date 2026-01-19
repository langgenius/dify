from typing import Final

# Dify CLI (absolute path - hidden in /tmp, not in sandbox workdir)
DIFY_CLI_ROOT: Final[str] = "/tmp/.dify"
DIFY_CLI_PATH: Final[str] = "/tmp/.dify/bin/dify"

DIFY_CLI_PATH_PATTERN: Final[str] = "dify-cli-{os}-{arch}"

DIFY_CLI_CONFIG_FILENAME: Final[str] = ".dify_cli.json"

DIFY_CLI_TOOLS_ROOT: Final[str] = "/tmp/.dify/tools"
DIFY_CLI_GLOBAL_TOOLS_PATH: Final[str] = "/tmp/.dify/tools/global"

# App Assets (relative path - stays in sandbox workdir)
APP_ASSETS_PATH: Final[str] = "assets"
APP_ASSETS_ZIP_PATH: Final[str] = "/tmp/assets.zip"
