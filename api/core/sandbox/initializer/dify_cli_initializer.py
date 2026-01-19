from __future__ import annotations

import json
import logging
from io import BytesIO
from pathlib import Path

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app_assets.entities import ToolType
from core.session.cli_api import CliApiSessionManager
from core.skill.entities import ToolManifest
from core.skill.skill_manager import SkillManager
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from core.virtual_environment.__base.helpers import execute, with_connection
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from ..bash.dify_cli import DifyCliConfig, DifyCliLocator
from ..constants import (
    DIFY_CLI_CONFIG_FILENAME,
    DIFY_CLI_GLOBAL_TOOLS_PATH,
    DIFY_CLI_PATH,
    DIFY_CLI_ROOT,
)
from .base import SandboxInitializer

logger = logging.getLogger(__name__)


class DifyCliInitializer(SandboxInitializer):
    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        assets_id: str,
        cli_root: str | Path | None = None,
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id
        self._locator = DifyCliLocator(root=cli_root)

        self._tools = []
        self._cli_api_session = None

    def initialize(self, env: VirtualEnvironment) -> None:
        binary = self._locator.resolve(env.metadata.os, env.metadata.arch)

        with with_connection(env) as conn:
            execute(
                env,
                ["mkdir", "-p", f"{DIFY_CLI_ROOT}/bin"],
                connection=conn,
                timeout=10,
                error_message="Failed to create dify CLI directory",
            )

            env.upload_file(DIFY_CLI_PATH, BytesIO(binary.path.read_bytes()))

            execute(
                env,
                ["chmod", "+x", DIFY_CLI_PATH],
                connection=conn,
                timeout=10,
                error_message="Failed to mark dify CLI as executable",
            )

            logger.info("Dify CLI uploaded to sandbox, path=%s", DIFY_CLI_PATH)

            manifest = SkillManager.load_tool_manifest(
                self._tenant_id,
                self._app_id,
                self._assets_id,
            )

            if manifest is None or not manifest.tools:
                logger.info("No tools found in manifest for assets_id=%s", self._assets_id)
                return

            self._tools = self._resolve_tools_from_manifest(manifest)
            self._cli_api_session = CliApiSessionManager().create(tenant_id=self._tenant_id, user_id="system")

            execute(
                env,
                ["mkdir", "-p", DIFY_CLI_GLOBAL_TOOLS_PATH],
                connection=conn,
                timeout=10,
                error_message="Failed to create global tools directory",
            )

            config_json = json.dumps(
                DifyCliConfig.create(self._cli_api_session, self._tools).model_dump(mode="json"), ensure_ascii=False
            )
            env.upload_file(
                f"{DIFY_CLI_GLOBAL_TOOLS_PATH}/{DIFY_CLI_CONFIG_FILENAME}", BytesIO(config_json.encode("utf-8"))
            )

            execute(
                env,
                [DIFY_CLI_PATH, "init"],
                connection=conn,
                timeout=30,
                cwd=DIFY_CLI_GLOBAL_TOOLS_PATH,
                error_message="Failed to initialize Dify CLI",
            )

            logger.info(
                "Global tools initialized, path=%s, tool_count=%d",
                DIFY_CLI_GLOBAL_TOOLS_PATH,
                len(self._tools),
            )

    def _resolve_tools_from_manifest(self, manifest: ToolManifest) -> list[Tool]:
        tools: list[Tool] = []

        for entry in manifest.tools.values():
            if entry.provider is None or entry.tool_name is None:
                logger.warning("Skipping tool entry with missing provider or tool_name: %s", entry.uuid)
                continue

            try:
                provider_type = self._convert_tool_type(entry.type)
                tool = ToolManager.get_tool_runtime(
                    tenant_id=self._tenant_id,
                    provider_type=provider_type,
                    provider_id=entry.provider,
                    tool_name=entry.tool_name,
                    invoke_from=InvokeFrom.AGENT,
                    credential_id=entry.credential_id,
                )
                tools.append(tool)
            except Exception as e:
                logger.warning("Failed to resolve tool %s/%s: %s", entry.provider, entry.tool_name, e)
                continue

        return tools

    @staticmethod
    def _convert_tool_type(tool_type: ToolType) -> ToolProviderType:
        match tool_type:
            case ToolType.BUILTIN:
                return ToolProviderType.BUILT_IN
            case ToolType.MCP:
                return ToolProviderType.MCP
            case _:
                raise ValueError(f"Unsupported tool type: {tool_type}")
