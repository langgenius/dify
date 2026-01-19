from __future__ import annotations

import logging
from types import TracebackType
from typing import TYPE_CHECKING

from core.session.cli_api import CliApiSessionManager
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from .constants import (
    DIFY_CLI_GLOBAL_TOOLS_PATH,
)
from .manager import SandboxManager

if TYPE_CHECKING:
    from .bash.bash_tool import SandboxBashTool

logger = logging.getLogger(__name__)


class SandboxSession:
    _workflow_execution_id: str
    _tenant_id: str
    _user_id: str
    _node_id: str | None
    _allow_tools: list[str] | None

    _sandbox: VirtualEnvironment | None
    _bash_tool: SandboxBashTool | None
    _session_id: str | None
    _tools_path: str

    def __init__(
        self,
        *,
        workflow_execution_id: str,
        tenant_id: str,
        user_id: str,
        node_id: str | None = None,
        allow_tools: list[str] | None = None,
    ) -> None:
        self._workflow_execution_id = workflow_execution_id
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._node_id = node_id
        self._allow_tools = allow_tools

        self._sandbox = None
        self._bash_tool = None
        self._session_id = None
        self._tools_path = DIFY_CLI_GLOBAL_TOOLS_PATH

    def __enter__(self) -> SandboxSession:
        sandbox = SandboxManager.get(self._workflow_execution_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found for workflow_execution_id={self._workflow_execution_id}")

        self._sandbox = sandbox

        if self._allow_tools is not None:
            # TODO: Implement node tools directory setup
            if self._node_id is None:
                raise ValueError("node_id is required when allow_tools is specified")
            # self._tools_path = self._setup_node_tools_directory(sandbox, self._node_id, self._allow_tools)
        else:
            self._tools_path = DIFY_CLI_GLOBAL_TOOLS_PATH

        from .bash.bash_tool import SandboxBashTool

        self._bash_tool = SandboxBashTool(sandbox=sandbox, tenant_id=self._tenant_id, tools_path=self._tools_path)
        return self

    def _setup_node_tools_directory(
        self,
        sandbox: VirtualEnvironment,
        node_id: str,
        allow_tools: list[str],
    ) -> None:
        pass

    @staticmethod
    def _get_tool_name_from_config(tool_config: dict) -> str:
        identity = tool_config.get("identity", {})
        provider = identity.get("provider", "")
        name = identity.get("name", "")
        return f"{provider}__{name}"

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        try:
            self.cleanup()
        except Exception:
            logger.exception("Failed to cleanup SandboxSession")
        return False

    @property
    def bash_tool(self) -> SandboxBashTool:
        if self._bash_tool is None:
            raise RuntimeError("SandboxSession is not initialized")
        return self._bash_tool

    def cleanup(self) -> None:
        if self._session_id is None:
            return

        CliApiSessionManager().delete(self._session_id)
        logger.debug("Cleaned up SandboxSession session_id=%s", self._session_id)
        self._session_id = None
