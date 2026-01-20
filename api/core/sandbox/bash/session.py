from __future__ import annotations

import json
import logging
from io import BytesIO
from types import TracebackType

from core.session.cli_api import CliApiSessionManager
from core.skill.entities.tool_artifact import ToolArtifact
from core.skill.skill_manager import SkillManager
from core.virtual_environment.__base.helpers import pipeline
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from ..bash.dify_cli import DifyCliConfig
from ..constants import (
    DIFY_CLI_CONFIG_FILENAME,
    DIFY_CLI_GLOBAL_TOOLS_PATH,
    DIFY_CLI_PATH,
    DIFY_CLI_TOOLS_ROOT,
)
from ..manager import SandboxManager
from .bash_tool import SandboxBashTool

logger = logging.getLogger(__name__)


class SandboxBashSession:
    def __init__(
        self,
        *,
        workflow_execution_id: str,
        tenant_id: str,
        user_id: str,
        node_id: str,
        app_id: str,
        assets_id: str,
        allow_tools: list[tuple[str, str]] | None,
    ) -> None:
        self._workflow_execution_id = workflow_execution_id
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._node_id = node_id
        self._app_id = app_id

        # FIXME(Mairuis): should read from workflow run context...
        self._assets_id = assets_id
        self._allow_tools = allow_tools

        self._sandbox = None
        self._bash_tool = None
        self._session_id = None

    def __enter__(self) -> SandboxBashSession:
        sandbox = SandboxManager.get(self._workflow_execution_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found for workflow_execution_id={self._workflow_execution_id}")

        self._sandbox = sandbox

        if self._allow_tools is not None:
            if self._node_id is None:
                raise ValueError("node_id is required when allow_tools is specified")
            tools_path = self._setup_node_tools_directory(sandbox, self._node_id, self._allow_tools)
        else:
            tools_path = DIFY_CLI_GLOBAL_TOOLS_PATH

        self._bash_tool = SandboxBashTool(sandbox=sandbox, tenant_id=self._tenant_id, tools_path=tools_path)
        return self

    def _setup_node_tools_directory(
        self,
        sandbox: VirtualEnvironment,
        node_id: str,
        allow_tools: list[tuple[str, str]],
    ) -> str | None:
        artifact: ToolArtifact | None = SkillManager.load_tool_artifact(
            self._tenant_id,
            self._app_id,
            self._assets_id,
        )

        if artifact is None or artifact.is_empty():
            logger.info("No tools found in artifact for assets_id=%s", self._assets_id)
            return None

        artifact = artifact.filter(allow_tools)
        if artifact.is_empty():
            logger.info("No tools found in artifact for assets_id=%s", self._assets_id)
            return None

        self._cli_api_session = CliApiSessionManager().create(tenant_id=self._tenant_id, user_id=self._user_id)
        node_tools_path = f"{DIFY_CLI_TOOLS_ROOT}/{node_id}"

        (
            pipeline(sandbox)
            .add(["mkdir", "-p", DIFY_CLI_GLOBAL_TOOLS_PATH], error_message="Failed to create global tools dir")
            .add(["mkdir", "-p", node_tools_path], error_message="Failed to create node tools dir")
            .execute(raise_on_error=True)
        )

        config_json = json.dumps(
            DifyCliConfig.create(
                session=self._cli_api_session, tenant_id=self._tenant_id, artifact=artifact
            ).model_dump(mode="json"),
            ensure_ascii=False,
        )
        sandbox.upload_file(f"{node_tools_path}/{DIFY_CLI_CONFIG_FILENAME}", BytesIO(config_json.encode("utf-8")))

        pipeline(sandbox, cwd=node_tools_path).add(
            [DIFY_CLI_PATH, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info(
            "Node %s tools initialized, path=%s, tool_count=%d", node_id, node_tools_path, len(artifact.references)
        )
        return node_tools_path

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
