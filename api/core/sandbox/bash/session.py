from __future__ import annotations

import json
import logging
from io import BytesIO
from types import TracebackType

from core.sandbox.sandbox import Sandbox
from core.session.cli_api import CliApiSession, CliApiSessionManager
from core.skill.entities.tool_artifact import ToolArtifact
from core.virtual_environment.__base.helpers import pipeline

from ..bash.dify_cli import DifyCliConfig
from ..entities import DifyCli
from .bash_tool import SandboxBashTool

logger = logging.getLogger(__name__)

SANDBOX_READY_TIMEOUT = 60 * 10


class SandboxBashSession:
    def __init__(self, *, sandbox: Sandbox, node_id: str, tools: ToolArtifact | None) -> None:
        self._sandbox = sandbox
        self._node_id = node_id
        self._tools = tools
        self._bash_tool: SandboxBashTool | None = None
        self._cli_api_session: CliApiSession | None = None
        self._tenant_id = sandbox.tenant_id
        self._user_id = sandbox.user_id
        self._app_id = sandbox.app_id
        self._assets_id = sandbox.assets_id

    def __enter__(self) -> SandboxBashSession:
        # Ensure sandbox initialization completes before any bash commands run.
        self._sandbox.wait_ready(timeout=SANDBOX_READY_TIMEOUT)
        self._cli_api_session = CliApiSessionManager().create(
            tenant_id=self._tenant_id,
            user_id=self._user_id,
        )
        if self._tools is not None and not self._tools.is_empty():
            tools_path = self._setup_node_tools_directory(self._node_id, self._tools, self._cli_api_session)
        else:
            tools_path = DifyCli.GLOBAL_TOOLS_PATH

        self._bash_tool = SandboxBashTool(
            sandbox=self._sandbox.vm,
            tenant_id=self._tenant_id,
            tools_path=tools_path,
        )
        return self

    def _setup_node_tools_directory(
        self,
        node_id: str,
        tools: ToolArtifact,
        cli_api_session: CliApiSession,
    ) -> str | None:
        node_tools_path = f"{DifyCli.TOOLS_ROOT}/{node_id}"

        vm = self._sandbox.vm
        (
            pipeline(vm)
            .add(["mkdir", "-p", DifyCli.GLOBAL_TOOLS_PATH], error_message="Failed to create global tools dir")
            .add(["mkdir", "-p", node_tools_path], error_message="Failed to create node tools dir")
            .execute(raise_on_error=True)
        )

        config_json = json.dumps(
            DifyCliConfig.create(session=cli_api_session, tenant_id=self._tenant_id, artifact=tools).model_dump(
                mode="json"
            ),
            ensure_ascii=False,
        )
        vm.upload_file(f"{node_tools_path}/{DifyCli.CONFIG_FILENAME}", BytesIO(config_json.encode("utf-8")))

        pipeline(vm, cwd=node_tools_path).add(
            [DifyCli.PATH, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info(
            "Node %s tools initialized, path=%s, tool_count=%d", node_id, node_tools_path, len(tools.references)
        )
        return node_tools_path

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        try:
            if self._cli_api_session is not None:
                CliApiSessionManager().delete(self._cli_api_session.id)
                logger.debug("Cleaned up SandboxSession session_id=%s", self._cli_api_session.id)
                self._cli_api_session = None
        except Exception:
            logger.exception("Failed to cleanup SandboxSession")
        return False

    @property
    def bash_tool(self) -> SandboxBashTool:
        if self._bash_tool is None:
            raise RuntimeError("SandboxSession is not initialized")
        return self._bash_tool
