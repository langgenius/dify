from __future__ import annotations

import json
import logging
from io import BytesIO
from types import TracebackType

from core.sandbox.bash_tool import SandboxBashTool
from core.sandbox.constants import DIFY_CLI_CONFIG_PATH, DIFY_CLI_PATH
from core.sandbox.dify_cli import DifyCliConfig
from core.sandbox.manager import SandboxManager
from core.session.inner_api import InnerApiSessionManager
from core.tools.__base.tool import Tool
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
        sandbox = SandboxManager.get(self._workflow_execution_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found for workflow_execution_id={self._workflow_execution_id}")

        session = InnerApiSessionManager().create(tenant_id=self._tenant_id, user_id=self._user_id)
        self._session_id = session.id

        try:
            config = DifyCliConfig.create(self._session_id, self._tools)
            config_json = json.dumps(config.model_dump(mode="json"), ensure_ascii=False)

            sandbox.upload_file(DIFY_CLI_CONFIG_PATH, BytesIO(config_json.encode("utf-8")))

            connection_handle = sandbox.establish_connection()
            try:
                future = sandbox.run_command(connection_handle, [DIFY_CLI_PATH, "init"])
                result = future.result(timeout=30)
                if result.is_error:
                    raise RuntimeError(f"Failed to initialize Dify CLI in sandbox: {result.error_message}")
            finally:
                sandbox.release_connection(connection_handle)

        except Exception:
            InnerApiSessionManager().delete(session.id)
            self._session_id = None
            raise

        self._sandbox = sandbox
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
