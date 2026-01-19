from typing import Final

# Dify CLI (absolute path - hidden in /tmp, not in sandbox workdir)
DIFY_CLI_ROOT: Final[str] = "/tmp/.dify"
DIFY_CLI_PATH: Final[str] = "/tmp/.dify/bin/dify"

DIFY_CLI_PATH_PATTERN: Final[str] = "dify-cli-{os}-{arch}"

DIFY_CLI_CONFIG_PATH: Final[str] = "/tmp/.dify/.dify_cli.json"

# App Assets (relative path - stays in sandbox workdir)
APP_ASSETS_PATH: Final[str] = "assets"
APP_ASSETS_ZIP_PATH: Final[str] = "/tmp/.dify/tmp/assets.zip"
