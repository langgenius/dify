"""Resolve an admitted sandbox caller before invoking the file gateway."""

from typing import Protocol

from dify_agent.protocol import BindingFileListResponse, BindingFileReadResponse

from machinery.context import RequestContext
from services.app.agent_app_contracts import (
    AgentSandboxBinding,
    AgentSandboxDownload,
    AgentSandboxInfo,
    SandboxCaller,
)


class AgentSandboxBindings(Protocol):
    def resolve_binding(self, context: RequestContext, caller: SandboxCaller) -> AgentSandboxBinding: ...


class AgentSandboxFiles(Protocol):
    def list_files(self, binding: AgentSandboxBinding, path: str) -> BindingFileListResponse: ...

    def read_file(self, binding: AgentSandboxBinding, path: str) -> BindingFileReadResponse: ...

    def download_file(
        self, context: RequestContext, caller: SandboxCaller, binding: AgentSandboxBinding, path: str
    ) -> AgentSandboxDownload: ...


class AgentAppSandboxService:
    def __init__(self, *, bindings: AgentSandboxBindings, files: AgentSandboxFiles) -> None:
        self._bindings = bindings
        self._files = files

    def get_info(self, context: RequestContext, caller: SandboxCaller) -> AgentSandboxInfo:
        self._bindings.resolve_binding(context, caller)
        return AgentSandboxInfo(workspace_cwd=".")

    def list_files(self, context: RequestContext, caller: SandboxCaller, path: str) -> BindingFileListResponse:
        binding = self._bindings.resolve_binding(context, caller)
        return self._files.list_files(binding, path)

    def read_file(self, context: RequestContext, caller: SandboxCaller, path: str) -> BindingFileReadResponse:
        binding = self._bindings.resolve_binding(context, caller)
        return self._files.read_file(binding, path)

    def download_file(self, context: RequestContext, caller: SandboxCaller, path: str) -> AgentSandboxDownload:
        binding = self._bindings.resolve_binding(context, caller)
        return self._files.download_file(context, caller, binding, path)
