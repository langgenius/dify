"""Async initializer that populates a draft sandbox with app asset files.

Unlike ``AppAssetsInitializer`` (which downloads a pre-built ZIP for
published assets), this initializer runs the build pipeline on the fly
so that ``.md`` skill documents are compiled and their resolved content
is embedded directly into the download script — avoiding the S3
round-trip that was previously required for resolved keys.

Execution order guarantee:
    This runs as an ``AsyncSandboxInitializer`` in the background thread.
    By the time it finishes, ``SkillManager.save_bundle()`` has been
    called (inside ``SkillBuilder.build()``), so subsequent initializers
    like ``DifyCliInitializer`` can safely load the bundle from Redis/S3.
"""

import logging

from core.app_assets.builder.base import BuildContext
from core.app_assets.builder.file_builder import FileBuilder
from core.app_assets.builder.pipeline import AssetBuildPipeline
from core.app_assets.builder.skill_builder import SkillBuilder
from core.app_assets.constants import AppAssetsAttrs
from core.sandbox.entities import AppAssets
from core.sandbox.sandbox import Sandbox
from core.sandbox.services import AssetDownloadService
from core.virtual_environment.__base.helpers import pipeline
from services.app_asset_service import AppAssetService

from .base import SyncSandboxInitializer

logger = logging.getLogger(__name__)

_TIMEOUT = 600  # 10 minutes


class DraftAppAssetsInitializer(SyncSandboxInitializer):
    """Compile draft assets and push them into the sandbox VM.

    ``.md`` (skill) files are compiled in-process and their resolved
    content is embedded as base64 heredocs in the download script.
    All other files are fetched from S3 via presigned URLs.
    """

    def __init__(self, tenant_id: str, app_id: str, assets_id: str) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        vm = sandbox.vm
        tree = sandbox.attrs.get(AppAssetsAttrs.FILE_TREE)
        if tree.empty():
            return

        # --- 1. Run the build pipeline (SkillBuilder compiles .md inline) ---
        accessor = AppAssetService.get_accessor(self._tenant_id, self._app_id)
        build_pipeline = AssetBuildPipeline([SkillBuilder(accessor=accessor), FileBuilder()])
        ctx = BuildContext(tenant_id=self._tenant_id, app_id=self._app_id, build_id=self._assets_id)
        built_assets = build_pipeline.build_all(tree, ctx)

        if not built_assets:
            return

        # --- 2. Convert to unified download items and execute ---
        download_items = AppAssetService.to_download_items(built_assets)
        script = AssetDownloadService.build_download_script(download_items, AppAssets.PATH)
        pipeline(vm).add(
            ["sh", "-c", script],
            error_message="Failed to download draft assets",
        ).execute(timeout=_TIMEOUT, raise_on_error=True)

        logger.info(
            "Draft app assets initialized for app_id=%s, assets_id=%s",
            self._app_id,
            self._assets_id,
        )
