import logging
from abc import ABC, abstractmethod
from io import BytesIO
from pathlib import Path

from core.sandbox.constants import DIFY_CLI_PATH
from core.sandbox.dify_cli import DifyCliLocator
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, env: VirtualEnvironment) -> None: ...


class DifyCliInitializer(SandboxInitializer):
    def __init__(self, cli_root: str | Path | None = None) -> None:
        self._locator = DifyCliLocator(root=cli_root)

    def initialize(self, env: VirtualEnvironment) -> None:
        binary = self._locator.resolve(env.metadata.os, env.metadata.arch)
        env.upload_file(DIFY_CLI_PATH, BytesIO(binary.path.read_bytes()))

        connection_handle = env.establish_connection()
        try:
            future = env.run_command(connection_handle, ["chmod", "+x", DIFY_CLI_PATH])
            result = future.result(timeout=10)
            if result.exit_code not in (0, None):
                stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
                raise RuntimeError(f"Failed to mark dify CLI as executable: {stderr}")

            logger.info("Dify CLI uploaded to sandbox, path=%s", DIFY_CLI_PATH)
        finally:
            env.release_connection(connection_handle)
