import logging
from io import BytesIO
from pathlib import Path

from core.sandbox.bash.dify_cli import DifyCliLocator
from core.sandbox.constants import DIFY_CLI_PATH
from core.sandbox.initializer.base import SandboxInitializer
from core.virtual_environment.__base.helpers import execute
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class DifyCliInitializer(SandboxInitializer):
    def __init__(self, cli_root: str | Path | None = None) -> None:
        self._locator = DifyCliLocator(root=cli_root)

    def initialize(self, env: VirtualEnvironment) -> None:
        binary = self._locator.resolve(env.metadata.os, env.metadata.arch)
        env.upload_file(DIFY_CLI_PATH, BytesIO(binary.path.read_bytes()))

        execute(
            env,
            ["chmod", "+x", DIFY_CLI_PATH],
            timeout=10,
            error_message="Failed to mark dify CLI as executable",
        )
        logger.info("Dify CLI uploaded to sandbox, path=%s", DIFY_CLI_PATH)
