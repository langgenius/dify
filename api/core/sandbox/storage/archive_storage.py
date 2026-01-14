import logging
from io import BytesIO

from core.sandbox.storage.sandbox_storage import SandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import Storage

logger = logging.getLogger(__name__)

ARCHIVE_NAME = "workspace.tar.gz"
WORKSPACE_DIR = "."


class ArchiveSandboxStorage(SandboxStorage):
    def __init__(self, storage: Storage, tenant_id: str, sandbox_id: str):
        self._storage = storage
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id

    @property
    def _storage_key(self) -> str:
        return f"sandbox/{self._tenant_id}/{self._sandbox_id}.tar.gz"

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        if not self.exists():
            logger.debug("No archive found for sandbox %s, skipping mount", self._sandbox_id)
            return False

        archive_data = self._storage.load_once(self._storage_key)
        sandbox.upload_file(ARCHIVE_NAME, BytesIO(archive_data))

        connection = sandbox.establish_connection()
        try:
            future = sandbox.run_command(connection, ["tar", "-xzf", ARCHIVE_NAME])
            result = future.result(timeout=60)
            if result.is_error:
                logger.error("Failed to extract archive: %s", result.error_message)
                return False
        finally:
            sandbox.release_connection(connection)

        connection = sandbox.establish_connection()
        try:
            sandbox.run_command(connection, ["rm", ARCHIVE_NAME]).result(timeout=10)
        finally:
            sandbox.release_connection(connection)

        logger.info("Mounted archive for sandbox %s", self._sandbox_id)
        return True

    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        connection = sandbox.establish_connection()
        try:
            future = sandbox.run_command(
                connection,
                ["tar", "-czf", ARCHIVE_NAME, "-C", WORKSPACE_DIR, "."],
            )
            result = future.result(timeout=120)
            if result.is_error:
                logger.error("Failed to create archive: %s", result.error_message)
                return False
        finally:
            sandbox.release_connection(connection)

        archive_content = sandbox.download_file(ARCHIVE_NAME)
        self._storage.save(self._storage_key, archive_content.getvalue())

        logger.info("Unmounted archive for sandbox %s", self._sandbox_id)
        return True

    def exists(self) -> bool:
        return self._storage.exists(self._storage_key)

    def delete(self) -> None:
        if self.exists():
            self._storage.delete(self._storage_key)
            logger.info("Deleted archive for sandbox %s", self._sandbox_id)
