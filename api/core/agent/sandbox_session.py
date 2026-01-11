from __future__ import annotations

import json
import logging
from io import BytesIO
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from types import TracebackType

    from core.tools.__base.tool import Tool
    from core.tools.builtin_tool.providers.sandbox.bash_tool import SandboxBashTool
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class SandboxSession:
    def __init__(
        self,
        *,
        workflow_execution_id: str,
        tenant_id: str,
        user_id: str,
        tools: list[Tool],
    ) -> None:
        self._workflow_execution_id = workflow_execution_id
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._tools = tools

        self._sandbox: VirtualEnvironment | None = None
        self._bash_tool: SandboxBashTool | None = None
        self._session_id: str | None = None

    def __enter__(self) -> SandboxSession:
        from core.session.inner_api import InnerApiSessionManager
        from core.tools.builtin_tool.providers.sandbox.bash_tool import SandboxBashTool
        from core.virtual_environment.sandbox_manager import SandboxManager

        sandbox = SandboxManager.get(self._workflow_execution_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found for workflow_execution_id={self._workflow_execution_id}")

        session = InnerApiSessionManager().create(tenant_id=self._tenant_id, user_id=self._user_id)

        try:
            _upload_and_init_dify_cli(sandbox, self._tools, session.id)
        except Exception:
            InnerApiSessionManager().delete(session.id)
            raise

        self._sandbox = sandbox
        self._session_id = session.id
        self._bash_tool = SandboxBashTool(sandbox=sandbox, tenant_id=self._tenant_id)
        return self

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
        from core.session.inner_api import InnerApiSessionManager

        if self._session_id is None:
            return

        InnerApiSessionManager().delete(self._session_id)
        logger.debug("Cleaned up SandboxSession session_id=%s", self._session_id)
        self._session_id = None


def _upload_and_init_dify_cli(sandbox: VirtualEnvironment, tools: list[Tool], session_id: str) -> None:
    from configs import dify_config

    config = {
        "env": {
            "files_url": dify_config.FILES_URL,
            "inner_api_url": dify_config.CONSOLE_API_URL,
            "inner_api_session_id": session_id,
        },
        "tools": _serialize_tools(tools),
    }

    config_json = json.dumps(config, ensure_ascii=False)
    config_path = f"/tmp/dify-init-{session_id}.json"

    sandbox.upload_file(config_path, BytesIO(config_json.encode("utf-8")))

    connection_handle = sandbox.establish_connection()
    try:
        future = sandbox.run_command(connection_handle, ["dify", "init", config_path])
        result = future.result(timeout=30)
        if result.exit_code != 0:
            stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
            raise RuntimeError(f"Failed to initialize Dify CLI in sandbox: {stderr}")
    finally:
        sandbox.release_connection(connection_handle)


def _serialize_tools(tools: list[Tool]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    for tool in tools:
        tool_config = tool.entity.model_dump()
        tool_config["provider_type"] = tool.tool_provider_type().value
        tool_config["credential_type"] = tool.runtime.credential_type.value if tool.runtime else "default"
        tool_config["credential_id"] = tool.runtime.tool_id if tool.runtime else tool.entity.identity.provider
        result.append(tool_config)

    return result
