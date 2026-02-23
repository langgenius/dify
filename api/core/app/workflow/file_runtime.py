from __future__ import annotations

from collections.abc import Generator

from configs import dify_config
from core.helper.ssrf_proxy import ssrf_proxy
from core.tools.signature import sign_tool_file
from core.workflow.file.protocols import HttpResponseProtocol, WorkflowFileRuntimeProtocol
from core.workflow.file.runtime import set_workflow_file_runtime
from extensions.ext_storage import storage


class DifyWorkflowFileRuntime(WorkflowFileRuntimeProtocol):
    """Production runtime wiring for ``core.workflow.file``."""

    @property
    def files_url(self) -> str:
        return dify_config.FILES_URL

    @property
    def internal_files_url(self) -> str | None:
        return dify_config.INTERNAL_FILES_URL

    @property
    def secret_key(self) -> str:
        return dify_config.SECRET_KEY

    @property
    def files_access_timeout(self) -> int:
        return dify_config.FILES_ACCESS_TIMEOUT

    @property
    def multimodal_send_format(self) -> str:
        return dify_config.MULTIMODAL_SEND_FORMAT

    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol:
        return ssrf_proxy.get(url, follow_redirects=follow_redirects)

    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator:
        return storage.load(path, stream=stream)

    def sign_tool_file(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str:
        return sign_tool_file(tool_file_id=tool_file_id, extension=extension, for_external=for_external)


def bind_dify_workflow_file_runtime() -> None:
    set_workflow_file_runtime(DifyWorkflowFileRuntime())
