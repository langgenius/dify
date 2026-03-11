from __future__ import annotations

import json
import logging
from io import BytesIO
from pathlib import Path

from core.sandbox.sandbox import Sandbox
from core.session.cli_api import CliApiSessionManager, CliContext
from core.skill.constants import SkillAttrs
from core.skill.entities import ToolAccessPolicy
from core.virtual_environment.__base.helpers import pipeline

from ..bash.dify_cli import DifyCliConfig, DifyCliLocator
from ..entities import DifyCli
from .base import AsyncSandboxInitializer, SandboxInitializeContext

logger = logging.getLogger(__name__)


class DifyCliInitializer(AsyncSandboxInitializer):
    _cli_api_session: object | None

    def __init__(self, cli_root: str | Path | None = None) -> None:
        self._locator = DifyCliLocator(root=cli_root)
        self._tools: list[object] = []
        self._cli_api_session = None

    def initialize(self, sandbox: Sandbox, ctx: SandboxInitializeContext) -> None:
        vm = sandbox.vm
        cli = DifyCli(sandbox.id)

        # FIXME(Mairuis): should be more robust, effectively.
        binary = self._locator.resolve(vm.metadata.os, vm.metadata.arch)

        pipeline(vm).add(
            ["mkdir", "-p", f"{cli.root}/bin"], error_message="Failed to create dify CLI directory"
        ).execute(raise_on_error=True)

        vm.upload_file(cli.bin_path, BytesIO(binary.path.read_bytes()))

        pipeline(vm).add(
            [
                "sh",
                "-c",
                f"cat '{cli.bin_path}' > '{cli.bin_path}.tmp' && "
                f"mv '{cli.bin_path}.tmp' '{cli.bin_path}' && "
                f"chmod +x '{cli.bin_path}'",
            ],
            error_message="Failed to mark dify CLI as executable",
        ).execute(raise_on_error=True)

        logger.info("Dify CLI uploaded to sandbox, path=%s", cli.bin_path)

        bundle = sandbox.attrs.get(SkillAttrs.BUNDLE)
        if bundle is None or bundle.get_tool_dependencies().is_empty():
            logger.info("No tools found in bundle for assets_id=%s", ctx.assets_id)
            return

        self._cli_api_session = CliApiSessionManager().create(
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            context=CliContext(tool_access=ToolAccessPolicy.from_dependencies(bundle.get_tool_dependencies())),
        )

        pipeline(vm).add(
            ["mkdir", "-p", cli.global_tools_path], error_message="Failed to create global tools dir"
        ).execute(raise_on_error=True)

        config = DifyCliConfig.create(self._cli_api_session, ctx.tenant_id, bundle.get_tool_dependencies())
        config_json = json.dumps(config.model_dump(mode="json"), ensure_ascii=False)
        config_path = f"{cli.global_tools_path}/{DifyCli.CONFIG_FILENAME}"
        vm.upload_file(config_path, BytesIO(config_json.encode("utf-8")))

        pipeline(vm, cwd=cli.global_tools_path).add(
            [cli.bin_path, "init"], error_message="Failed to initialize Dify CLI"
        ).execute(raise_on_error=True)

        logger.info("Global tools initialized, path=%s, tool_count=%d", cli.global_tools_path, len(self._tools))
