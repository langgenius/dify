from __future__ import annotations

import json
import logging
from io import BytesIO
from pathlib import Path

from core.session.cli_api import CliApiSessionManager
from core.skill.skill_manager import SkillManager
from core.virtual_environment.__base.helpers import pipeline
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
        user_id: str,
        app_id: str,
        assets_id: str,
        cli_root: str | Path | None = None,
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._user_id = user_id
        self._assets_id = assets_id
        self._locator = DifyCliLocator(root=cli_root)

        self._tools = []
        self._cli_api_session = None

    def initialize(self, env: VirtualEnvironment) -> None:
        binary = self._locator.resolve(env.metadata.os, env.metadata.arch)

        pipeline(env).add(
            ["mkdir", "-p", f"{DIFY_CLI_ROOT}/bin"], error_message="Failed to create dify CLI directory"
        ).execute(raise_on_error=True)

        env.upload_file(DIFY_CLI_PATH, BytesIO(binary.path.read_bytes()))

        pipeline(env).add(
            ["chmod", "+x", DIFY_CLI_PATH], error_message="Failed to mark dify CLI as executable"
        ).execute(raise_on_error=True)

        logger.info("Dify CLI uploaded to sandbox, path=%s", DIFY_CLI_PATH)

        artifact = SkillManager.load_tool_artifact(self._tenant_id, self._app_id, self._assets_id)
        if artifact is None or not artifact.references:
            logger.info("No tools found in artifact for assets_id=%s", self._assets_id)
            return

        # FIXME(Mairuis): store it in workflow context
        self._cli_api_session = CliApiSessionManager().create(tenant_id=self._tenant_id, user_id=self._user_id)

        pipeline(env).add(
            ["mkdir", "-p", DIFY_CLI_GLOBAL_TOOLS_PATH], error_message="Failed to create global tools dir"
        ).execute(raise_on_error=True)

        config = DifyCliConfig.create(self._cli_api_session, self._tenant_id, artifact)
        config_json = json.dumps(config.model_dump(mode="json"), ensure_ascii=False)
        config_path = f"{DIFY_CLI_GLOBAL_TOOLS_PATH}/{DIFY_CLI_CONFIG_FILENAME}"
        env.upload_file(config_path, BytesIO(config_json.encode("utf-8")))

        pipeline(env, cwd=DIFY_CLI_GLOBAL_TOOLS_PATH).add(
            [DIFY_CLI_PATH, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info("Global tools initialized, path=%s, tool_count=%d", DIFY_CLI_GLOBAL_TOOLS_PATH, len(self._tools))
