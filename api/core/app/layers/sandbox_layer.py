import logging

from core.sandbox import AppAssetsInitializer, DifyCliInitializer, SandboxManager
from core.sandbox.constants import APP_ASSETS_PATH
from core.sandbox.initializer.app_assets_initializer import DraftAppAssetsInitializer
from core.sandbox.storage.archive_storage import ArchiveSandboxStorage
from core.sandbox.vm import SandboxBuilder
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent
from core.workflow.nodes.base.node import Node
from models.workflow import Workflow
from services.app_asset_service import AppAssetService
from services.sandbox.sandbox_provider_service import SandboxProviderService

logger = logging.getLogger(__name__)


class SandboxInitializationError(Exception):
    pass


class SandboxLayer(GraphEngineLayer):
    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        user_id: str,
        workflow_version: str,
        workflow_execution_id: str,
    ) -> None:
        super().__init__()
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._user_id = user_id
        self._workflow_version = workflow_version
        self._workflow_execution_id = workflow_execution_id
        is_draft = self._workflow_version == Workflow.VERSION_DRAFT
        self._sandbox_id = SandboxBuilder.draft_id(self._user_id) if is_draft else self._workflow_execution_id
        self._sandbox_storage = ArchiveSandboxStorage(
            self._tenant_id, self._sandbox_id, exclude_patterns=[APP_ASSETS_PATH] if is_draft else None
        )

    def on_graph_start(self) -> None:
        try:
            is_draft = self._workflow_version == Workflow.VERSION_DRAFT
            assets = AppAssetService.get_assets(self._tenant_id, self._app_id, self._user_id, is_draft=is_draft)
            if not assets:
                raise ValueError(
                    f"No assets found for tid={self._tenant_id}, app_id={self._app_id}, wf={self._workflow_version}"
                )

            self._assets_id = assets.id

            if is_draft:
                logger.info(
                    "Building draft assets for tenant_id=%s, app_id=%s, workflow_version=%s, assets_id=%s",
                    self._tenant_id,
                    self._app_id,
                    self._workflow_version,
                    assets.id,
                )
                AppAssetService.build_assets(self._tenant_id, self._app_id, assets)

            assets_initializer = (
                DraftAppAssetsInitializer(self._tenant_id, self._app_id, assets.id)
                if is_draft
                else AppAssetsInitializer(self._tenant_id, self._app_id, assets.id)
            )

            builder = (
                SandboxProviderService.create_sandbox_builder(self._tenant_id)
                .initializer(assets_initializer)
                .initializer(DifyCliInitializer(self._tenant_id, self._user_id, self._app_id, assets.id))
            )
            try:
                sandbox = builder.build()
                logger.info(
                    "Sandbox initialized, workflow_execution_id=%s, sandbox_id=%s, sandbox_arch=%s",
                    self._sandbox_id,
                    sandbox.metadata.id,
                    sandbox.metadata.arch,
                )
            except Exception as e:
                raise SandboxInitializationError(f"Failed to build sandbox: {e}") from e

            SandboxManager.register(self._sandbox_id, sandbox)

            # mount sandbox files from storage
            mounted = self._sandbox_storage.mount(sandbox)
            logger.info("Sandbox files mount status: %s", mounted)

        except Exception as e:
            logger.exception("Failed to initialize sandbox")
            raise SandboxInitializationError(f"Failed to initialize sandbox: {e}") from e

    def on_node_run_start(self, node: Node) -> None:
        # FIXME(Mairuis): should read from workflow run context...
        node.assets_id = self._assets_id

    def on_event(self, event: GraphEngineEvent) -> None:
        # TODO: handle graph run paused event
        if not isinstance(event, GraphRunPausedEvent):
            return

    def on_graph_end(self, error: Exception | None) -> None:
        sandbox = SandboxManager.unregister(self._sandbox_id)
        if sandbox is None:
            logger.debug("No sandbox to release for sandbox_id=%s", self._sandbox_id)
            return

        try:
            self._sandbox_storage.unmount(sandbox)
            logger.info("Sandbox files persisted, sandbox_id=%s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to persist sandbox files, sandbox_id=%s", self._sandbox_id)

        try:
            sandbox.release_environment()
            logger.info("Sandbox released, sandbox_id=%s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox, sandbox_id=%s", self._sandbox_id)
