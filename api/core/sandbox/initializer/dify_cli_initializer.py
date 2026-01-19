import logging
from io import BytesIO
from pathlib import Path

from core.virtual_environment.__base.helpers import execute
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from ..bash.dify_cli import DifyCliLocator
from ..constants import DIFY_CLI_PATH, DIFY_CLI_ROOT
from .base import SandboxInitializer

logger = logging.getLogger(__name__)


class DifyCliInitializer(SandboxInitializer):
    def __init__(self, cli_root: str | Path | None = None) -> None:
        self._locator = DifyCliLocator(root=cli_root)

    def initialize(self, env: VirtualEnvironment) -> None:
        binary = self._locator.resolve(env.metadata.os, env.metadata.arch)

        execute(
            env,
            ["mkdir", "-p", f"{DIFY_CLI_ROOT}/bin"],
            timeout=10,
            error_message="Failed to create dify CLI directory",
        )

        env.upload_file(DIFY_CLI_PATH, BytesIO(binary.path.read_bytes()))

        execute(
            env,
            ["chmod", "+x", DIFY_CLI_PATH],
            timeout=10,
            error_message="Failed to mark dify CLI as executable",
        )
        logger.info("Dify CLI uploaded to sandbox, path=%s", DIFY_CLI_PATH)
