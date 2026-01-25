import logging
from uuid import UUID

from core.sandbox.security.archive_signer import SandboxArchivePath, SandboxArchiveSigner
from core.virtual_environment.__base.exec import PipelineExecutionError
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from extensions.ext_storage import storage

from .sandbox_storage import SandboxStorage

logger = logging.getLogger(__name__)

ARCHIVE_NAME = "workspace.tar.gz"
WORKSPACE_DIR = "."
ARCHIVE_PATH = f"/tmp/{ARCHIVE_NAME}"

ARCHIVE_DOWNLOAD_TIMEOUT = 60 * 5
ARCHIVE_UPLOAD_TIMEOUT = 60 * 5


def build_tar_exclude_args(patterns: list[str]) -> list[str]:
    return [f"--exclude={p}" for p in patterns]


class ArchiveSandboxStorage(SandboxStorage):
    _tenant_id: str
    _sandbox_id: str
    _exclude_patterns: list[str]

    def __init__(self, tenant_id: str, sandbox_id: str, exclude_patterns: list[str] | None = None):
        self._tenant_id = tenant_id
        self._sandbox_id = sandbox_id
        self._exclude_patterns = exclude_patterns or []

    @property
    def _storage_key(self) -> str:
        return SandboxArchivePath(UUID(self._tenant_id), UUID(self._sandbox_id)).get_storage_key()

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        if not self.exists():
            logger.debug("No archive found for sandbox %s, skipping mount", self._sandbox_id)
            return False

        archive_path = SandboxArchivePath(UUID(self._tenant_id), UUID(self._sandbox_id))
        download_url = SandboxArchiveSigner.build_signed_url(
            archive_path=archive_path,
            expires_in=ARCHIVE_DOWNLOAD_TIMEOUT,
            action=SandboxArchiveSigner.OPERATION_DOWNLOAD,
        )
        try:
            (
                pipeline(sandbox)
                .add(["wget", "-q", download_url, "-O", ARCHIVE_NAME], error_message="Failed to download archive")
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
        archive_path = SandboxArchivePath(UUID(self._tenant_id), UUID(self._sandbox_id))
        upload_url = SandboxArchiveSigner.build_signed_url(
            archive_path=archive_path,
            expires_in=ARCHIVE_UPLOAD_TIMEOUT,
            action=SandboxArchiveSigner.OPERATION_UPLOAD,
        )
        (
            pipeline(sandbox)
            .add(
                [
                    "tar",
                    "-czf",
                    ARCHIVE_PATH,
                    "--warning=no-file-changed",
                    *build_tar_exclude_args(self._exclude_patterns),
                    "-C",
                    WORKSPACE_DIR,
                    ".",
                ],
                error_message="Failed to create archive",
            )
            .add(
                ["curl", "-s", "-f", "-X", "PUT", "-T", ARCHIVE_PATH, upload_url],
                error_message="Failed to upload archive",
            )
            .execute(timeout=ARCHIVE_UPLOAD_TIMEOUT, raise_on_error=True)
        )
        logger.info("Unmounted archive for sandbox %s", self._sandbox_id)
        return True

    def exists(self) -> bool:
        return storage.exists(self._storage_key)

    def delete(self) -> None:
        try:
            storage.delete(self._storage_key)
            logger.info("Deleted archive for sandbox %s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to delete archive for sandbox %s", self._sandbox_id)
