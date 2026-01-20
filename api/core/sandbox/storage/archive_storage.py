import logging

from core.virtual_environment.__base.exec import PipelineExecutionError
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import storage
from extensions.storage.file_presign_storage import FilePresignStorage

from .sandbox_storage import SandboxStorage

logger = logging.getLogger(__name__)

ARCHIVE_NAME = "workspace.tar.gz"
WORKSPACE_DIR = "."
ARCHIVE_PATH = f"/tmp/{ARCHIVE_NAME}"

ARCHIVE_DOWNLOAD_TIMEOUT = 60 * 5
ARCHIVE_UPLOAD_TIMEOUT = 60 * 5


class ArchiveSandboxStorage(SandboxStorage):
    def __init__(self, tenant_id: str, sandbox_id: str):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id

    @property
    def _storage_key(self) -> str:
        return f"sandbox/{self._tenant_id}/{self._sandbox_id}.tar.gz"

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        if not self.exists():
            logger.debug("No archive found for sandbox %s, skipping mount", self._sandbox_id)
            return False

        download_url = FilePresignStorage(storage.storage_runner).get_download_url(self._storage_key)
        try:
            (
                pipeline(sandbox)
                .add(["wget", download_url, "-O", ARCHIVE_NAME], error_message="Failed to download archive")
                .add(["tar", "-xzf", ARCHIVE_NAME], error_message="Failed to extract archive")
                .add(["rm", ARCHIVE_NAME], error_message="Failed to cleanup archive")
                .execute(timeout=ARCHIVE_DOWNLOAD_TIMEOUT, raise_on_error=True)
            )
        except PipelineExecutionError:
            logger.exception("Failed to extract archive")
            return False

        logger.info("Mounted archive for sandbox %s", self._sandbox_id)
        return True

    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        upload_url = FilePresignStorage(storage.storage_runner).get_upload_url(self._storage_key)
        (
            pipeline(sandbox)
            .add(
                ["tar", "-czf", ARCHIVE_PATH, "--warning=no-file-changed", "-C", WORKSPACE_DIR, "."],
                error_message="Failed to create archive",
            )
            .add(["wget", upload_url, "-O", ARCHIVE_PATH], error_message="Failed to upload archive")
            .execute(timeout=ARCHIVE_UPLOAD_TIMEOUT, raise_on_error=True)
        )
        logger.info("Unmounted archive for sandbox %s", self._sandbox_id)
        return True

    def exists(self) -> bool:
        return storage.exists(self._storage_key)

    def delete(self) -> None:
        if self.exists():
            storage.delete(self._storage_key)
            logger.info("Deleted archive for sandbox %s", self._sandbox_id)
