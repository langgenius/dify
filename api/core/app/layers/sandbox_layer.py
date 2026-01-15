import logging

from core.sandbox import ArchiveSandboxStorage, SandboxManager
from core.sandbox.storage.sandbox_storage import SandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)


class SandboxInitializationError(Exception):
    pass


class SandboxLayer(GraphEngineLayer):
    def __init__(self, tenant_id: str, app_id: str, sandbox_id: str, sandbox_storage: SandboxStorage) -> None:
        super().__init__()
        self._tenant_id = tenant_id
        self._app_id = app_id
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
            from core.sandbox import AppAssetsInitializer, DifyCliInitializer
            from services.sandbox.sandbox_provider_service import SandboxProviderService

            logger.info("Initializing sandbox for tenant_id=%s, app_id=%s", self._tenant_id, self._app_id)

            builder = (
                SandboxProviderService.create_sandbox_builder(self._tenant_id)
                .initializer(DifyCliInitializer())
                .initializer(AppAssetsInitializer(self._tenant_id, self._app_id))
            )
            sandbox = builder.build()

            SandboxManager.register(self._sandbox_id, sandbox)
            logger.info(
                "Sandbox initialized, workflow_execution_id=%s, sandbox_id=%s, sandbox_arch=%s",
                self._sandbox_id,
                sandbox.metadata.id,
                sandbox.metadata.arch,
            )

            sandbox_storage = ArchiveSandboxStorage(
                storage=storage,
                tenant_id=self._tenant_id,
                sandbox_id=self._sandbox_id,
            )
            if sandbox_storage.mount(sandbox):
                logger.info("Sandbox files restored, sandbox_id=%s", self._sandbox_id)
        except Exception as e:
            logger.exception("Failed to initialize sandbox")
            raise SandboxInitializationError(f"Failed to initialize sandbox: {e}") from e

    def on_event(self, event: GraphEngineEvent) -> None:
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        if self._sandbox_id is None:
            logger.debug("No workflow_execution_id set, nothing to release")
            return

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
