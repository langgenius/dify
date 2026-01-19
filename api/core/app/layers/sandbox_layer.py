import logging

from core.sandbox import AppAssetsInitializer, DifyCliInitializer, SandboxManager
from core.sandbox.storage.sandbox_storage import SandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent
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
        workflow_version: str,
        sandbox_id: str,
        sandbox_storage: SandboxStorage,
    ) -> None:
        super().__init__()
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._workflow_version = workflow_version
        self._sandbox_id = sandbox_id
        self._sandbox_storage = sandbox_storage

    @property
    def sandbox(self) -> VirtualEnvironment:
        sandbox = SandboxManager.get(self._sandbox_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found or not initialized for sandbox_id={self._sandbox_id}")
        return sandbox

    def on_graph_start(self) -> None:
        try:
            is_draft = self._workflow_version == Workflow.VERSION_DRAFT
            assets = AppAssetService.get_assets(self._tenant_id, self._app_id, is_draft=is_draft)
            if not assets:
                raise ValueError(
                    f"No assets found for tid={self._tenant_id}, app_id={self._app_id}, wf={self._workflow_version}"
                )
            if is_draft:
                logger.info(
                    "Building draft assets for tenant_id=%s, app_id=%s, workflow_version=%s, assets_id=%s",
                    self._tenant_id,
                    self._app_id,
                    self._workflow_version,
                    assets.id,
                )
                AppAssetService.build_assets(self._tenant_id, self._app_id, assets)

            logger.info(
                "Initializing sandbox for tenant_id=%s, app_id=%s, workflow_version=%s, assets_id=%s",
                self._tenant_id,
                self._app_id,
                self._workflow_version,
                assets.id,
            )

            builder = (
                SandboxProviderService.create_sandbox_builder(self._tenant_id)
                .initializer(AppAssetsInitializer(self._tenant_id, self._app_id, assets.id))
                .initializer(DifyCliInitializer(self._tenant_id, self._app_id, assets.id))
            )
            sandbox = builder.build()

            SandboxManager.register(self._sandbox_id, sandbox)
            logger.info(
                "Sandbox initialized, workflow_execution_id=%s, sandbox_id=%s, sandbox_arch=%s",
                self._sandbox_id,
                sandbox.metadata.id,
                sandbox.metadata.arch,
            )

            # Check if sandbox is initialized
            if self._sandbox_storage.mount(sandbox):
                logger.info("Sandbox files restored, sandbox_id=%s", self._sandbox_id)
        except Exception as e:
            logger.exception("Failed to initialize sandbox")
            raise SandboxInitializationError(f"Failed to initialize sandbox: {e}") from e

    def on_event(self, event: GraphEngineEvent) -> None:
        # TODO: handle graph run paused event
        if not isinstance(event, GraphRunPausedEvent):
            return

    def on_graph_end(self, error: Exception | None) -> None:
        sandbox = SandboxManager.unregister(self._sandbox_id)
        if sandbox is None:
            logger.debug("No sandbox to release for sandbox_id=%s", self._sandbox_id)
            return

        sandbox_id = sandbox.metadata.id
        logger.info(
            "Releasing sandbox, workflow_execution_id=%s, sandbox_id=%s",
            self._sandbox_id,
            sandbox_id,
        )

        try:
            self._sandbox_storage.unmount(sandbox)
            logger.info("Sandbox files persisted, sandbox_id=%s", self._sandbox_id)
        except Exception:
            logger.exception("Failed to persist sandbox files, sandbox_id=%s", self._sandbox_id)

        try:
            sandbox.release_environment()
            logger.info("Sandbox released, sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox, sandbox_id=%s", sandbox_id)
