"""Agent backend and ToolFile adapters for sandbox file access."""

import urllib.parse
from collections.abc import Callable
from contextlib import AbstractContextManager

from dify_agent.client import Client
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import BindingFileDownloadRequest, BindingFileListResponse, BindingFileReadResponse

from clients.agent_backend.factory import create_agent_backend_client
from configs import dify_config
from core.tools.signature import bind_file_uri
from machinery.context import RequestContext
from services.app.agent_app_contracts import (
    AgentSandboxBinding,
    AgentSandboxCaller,
    AgentSandboxDownload,
    AgentSandboxDownloadUnavailableError,
    AgentSandboxUnavailableError,
    SandboxCaller,
)
from services.file_request_service import FileRequestService


class AgentSandboxFileGateway:
    def __init__(
        self,
        *,
        client_factory: Callable[[], AbstractContextManager[Client]],
        file_requests: FileRequestService,
        files_url: str,
    ) -> None:
        self._client_factory = client_factory
        self._file_requests = file_requests
        self._files_url = files_url

    def list_files(self, binding: AgentSandboxBinding, path: str) -> BindingFileListResponse:
        with self._client_factory() as client:
            return client.list_binding_files_sync(binding.backend_binding_ref, path)

    def read_file(self, binding: AgentSandboxBinding, path: str) -> BindingFileReadResponse:
        with self._client_factory() as client:
            return client.read_binding_file_sync(binding.backend_binding_ref, path)

    def download_file(
        self, context: RequestContext, caller: SandboxCaller, binding: AgentSandboxBinding, path: str
    ) -> AgentSandboxDownload:
        execution_context = DifyExecutionContextLayerConfig(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
            user_from="account",
            app_id=binding.app_id,
            agent_id=binding.agent_id,
            agent_config_version_id=binding.agent_config_version_id,
            agent_config_version_kind=binding.agent_config_version_kind,
            agent_mode="agent_app" if isinstance(caller, AgentSandboxCaller) else "workflow_run",
            invoke_from="debugger",
        )
        if isinstance(caller, AgentSandboxCaller):
            execution_context.conversation_id = caller.caller_id if caller.caller_type == "conversation" else None
        else:
            execution_context.workflow_run_id = caller.workflow_run_id
            execution_context.node_id = caller.node_id
            execution_context.node_execution_id = caller.node_execution_id
        with self._client_factory() as client:
            downloaded = client.download_binding_file_sync(
                BindingFileDownloadRequest(
                    backend_binding_ref=binding.backend_binding_ref,
                    path=path,
                    execution_context=execution_context,
                )
            )
        try:
            result = self._file_requests.request_download(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
                user_from="account",
                invoke_from="debugger",
                file_mapping={"transfer_method": "tool_file", "reference": downloaded.reference},
            )
            url = bind_file_uri(result.download_uri, self._files_url)
        except ValueError as exc:
            raise AgentSandboxDownloadUnavailableError("Binding file could not be converted to a download URL") from exc
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        query.append(("as_attachment", "true"))
        return AgentSandboxDownload(url=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query))))


def create_sandbox_client() -> Client:
    if not dify_config.AGENT_BACKEND_BASE_URL:
        raise AgentSandboxUnavailableError("the Binding file inspector is not available (Agent backend not configured)")
    return create_agent_backend_client(
        base_url=dify_config.AGENT_BACKEND_BASE_URL,
        api_token=dify_config.AGENT_BACKEND_API_TOKEN,
        binding_file_download_timeout=dify_config.AGENT_BACKEND_BINDING_FILE_DOWNLOAD_TIMEOUT_SECONDS,
    )
