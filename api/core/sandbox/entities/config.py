from typing import Final


class DifyCli:
    """Per-sandbox Dify CLI paths, namespaced under ``/tmp/.dify/{env_id}``.

    Every sandbox environment gets its own directory tree so that
    concurrent sessions on the same host (e.g. SSH provider) never
    collide on config files or CLI binaries.

    Class-level constants (``CONFIG_FILENAME``, ``PATH_PATTERN``) are
    safe to share; all path attributes are instance-level and derived
    from the ``env_id`` passed at construction time.
    """

    # --- class-level constants (no path component) ---
    CONFIG_FILENAME: Final[str] = ".dify_cli.json"
    PATH_PATTERN: Final[str] = "dify-cli-{os}-{arch}"

    # --- instance attributes ---
    root: str
    bin_dir: str
    bin_path: str
    tools_root: str
    global_tools_path: str
    global_config_path: str

    def __init__(self, env_id: str) -> None:
        self.root = f"/tmp/.dify/{env_id}"
        self.bin_dir = f"{self.root}/bin"
        self.bin_path = f"{self.bin_dir}/dify"
        self.tools_root = f"{self.root}/tools"
        self.global_tools_path = f"{self.root}/tools/global"
        self.global_config_path = f"{self.global_tools_path}/{DifyCli.CONFIG_FILENAME}"

    def node_tools_path(self, node_id: str) -> str:
        return f"{self.tools_root}/{node_id}"

    def node_config_path(self, node_id: str) -> str:
        return f"{self.node_tools_path(node_id)}/{DifyCli.CONFIG_FILENAME}"


class AppAssets:
    """App Assets constants.

    ``PATH`` is a relative path resolved by each provider against its
    own workspace root — already isolated.  ``zip_path`` is an absolute
    temp path and must be namespaced per environment to avoid collisions.
    """

    PATH: Final[str] = "skills"

    root: str
    zip_path: str

    def __init__(self, env_id: str) -> None:
        self.root = f"/tmp/.dify/{env_id}"
        self.zip_path = f"{self.root}/assets.zip"
