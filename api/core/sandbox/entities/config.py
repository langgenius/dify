from typing import Final


class DifyCli:
    """Dify CLI constants (absolute path - hidden in /tmp, not in sandbox workdir)"""

    ROOT: Final[str] = "/tmp/.dify"
    PATH: Final[str] = "/tmp/.dify/bin/dify"
    PATH_PATTERN: Final[str] = "dify-cli-{os}-{arch}"
    CONFIG_FILENAME: Final[str] = ".dify_cli.json"
    TOOLS_ROOT: Final[str] = "/tmp/.dify/tools"
    GLOBAL_TOOLS_PATH: Final[str] = "/tmp/.dify/tools/global"


class AppAssets:
    """App Assets constants (relative path - stays in sandbox workdir)"""

    PATH: Final[str] = "skills"
    ZIP_PATH: Final[str] = "/tmp/assets.zip"
