from __future__ import annotations

import json
import logging
from io import BytesIO
from pathlib import Path

from core.sandbox.sandbox import Sandbox
from core.session.cli_api import CliApiSessionManager
from core.skill.skill_manager import SkillManager
from core.virtual_environment.__base.helpers import pipeline

from ..bash.dify_cli import DifyCliConfig, DifyCliLocator
from ..entities import DifyCli
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

    def initialize(self, sandbox: Sandbox) -> None:
        vm = sandbox.vm
        binary = self._locator.resolve(vm.metadata.os, vm.metadata.arch)

        pipeline(vm).add(
            ["mkdir", "-p", f"{DifyCli.ROOT}/bin"], error_message="Failed to create dify CLI directory"
        ).execute(raise_on_error=True)

        vm.upload_file(DifyCli.PATH, BytesIO(binary.path.read_bytes()))

        # Use 'cp' with mode preservation workaround: copy file to itself to claim ownership,
        # then use 'install' to set executable permission
        pipeline(vm).add(
            [
                "sh",
                "-c",
                f"cat '{DifyCli.PATH}' > '{DifyCli.PATH}.tmp' && "
                f"mv '{DifyCli.PATH}.tmp' '{DifyCli.PATH}' && "
                f"chmod +x '{DifyCli.PATH}'",
            ],
            error_message="Failed to mark dify CLI as executable",
        ).execute(raise_on_error=True)

        logger.info("Dify CLI uploaded to sandbox, path=%s", DifyCli.PATH)

        artifact = SkillManager.load_artifact(self._tenant_id, self._app_id, self._assets_id)
        if artifact is None or not artifact.get_tool_artifact().is_empty:
            logger.info("No tools found in artifact for assets_id=%s", self._assets_id)
            return

        # FIXME(Mairuis): store it in workflow context
        self._cli_api_session = CliApiSessionManager().create(tenant_id=self._tenant_id, user_id=self._user_id)

        pipeline(vm).add(
            ["mkdir", "-p", DifyCli.GLOBAL_TOOLS_PATH], error_message="Failed to create global tools dir"
        ).execute(raise_on_error=True)

        config = DifyCliConfig.create(self._cli_api_session, self._tenant_id, artifact.get_tool_artifact())
        config_json = json.dumps(config.model_dump(mode="json"), ensure_ascii=False)
        config_path = f"{DifyCli.GLOBAL_TOOLS_PATH}/{DifyCli.CONFIG_FILENAME}"
        vm.upload_file(config_path, BytesIO(config_json.encode("utf-8")))

        pipeline(vm, cwd=DifyCli.GLOBAL_TOOLS_PATH).add(
            [DifyCli.PATH, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info("Global tools initialized, path=%s, tool_count=%d", DifyCli.GLOBAL_TOOLS_PATH, len(self._tools))
