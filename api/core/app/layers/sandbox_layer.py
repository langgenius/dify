import logging

from core.sandbox.manager import SandboxManager
from core.sandbox.storage import ArchiveSandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from extensions.ext_storage import storage

logger = logging.getLogger(__name__)


class SandboxInitializationError(Exception):
    pass


class SandboxLayer(GraphEngineLayer):
    def __init__(self, tenant_id: str) -> None:
        super().__init__()
        self._tenant_id = tenant_id
        self._workflow_execution_id: str | None = None
        self._app_id: str | None = None

    def _get_workflow_execution_id(self) -> str:
        workflow_execution_id = self.graph_runtime_state.system_variable.workflow_execution_id
        if not workflow_execution_id:
            raise RuntimeError("workflow_execution_id is not set in system variables")
        return workflow_execution_id

    def _get_app_id(self) -> str:
        app_id = self.graph_runtime_state.system_variable.app_id
        if not app_id:
            raise RuntimeError("app_id is not set in system variables")
        return app_id

    @property
    def sandbox(self) -> VirtualEnvironment:
        if self._workflow_execution_id is None:
            raise RuntimeError("Sandbox not initialized. Ensure on_graph_start() has been called.")
        sandbox = SandboxManager.get(self._workflow_execution_id)
        if sandbox is None:
            raise RuntimeError(f"Sandbox not found for workflow_execution_id={self._workflow_execution_id}")
        return sandbox

    def on_graph_start(self) -> None:
        self._workflow_execution_id = self._get_workflow_execution_id()
        self._app_id = self._get_app_id()
        try:
            from core.sandbox.initializer import AppAssetsInitializer, DifyCliInitializer
            from services.sandbox.sandbox_provider_service import SandboxProviderService

            logger.info("Initializing sandbox for tenant_id=%s, app_id=%s", self._tenant_id, self._app_id)

            builder = (
                SandboxProviderService.create_sandbox_builder(self._tenant_id)
                .initializer(DifyCliInitializer())
                .initializer(AppAssetsInitializer(self._tenant_id, self._app_id))
            )
            sandbox = builder.build()

            SandboxManager.register(self._workflow_execution_id, sandbox)
            logger.info(
                "Sandbox initialized, workflow_execution_id=%s, sandbox_id=%s, sandbox_arch=%s",
                self._workflow_execution_id,
                sandbox.metadata.id,
                sandbox.metadata.arch,
            )

            sandbox_storage = ArchiveSandboxStorage(
                storage=storage,
                tenant_id=self._tenant_id,
                sandbox_id=self._workflow_execution_id,
            )
            if sandbox_storage.mount(sandbox):
                logger.info("Sandbox files restored, workflow_execution_id=%s", self._workflow_execution_id)
        except Exception as e:
            logger.exception("Failed to initialize sandbox")
            raise SandboxInitializationError(f"Failed to initialize sandbox: {e}") from e

    def on_event(self, event: GraphEngineEvent) -> None:
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        if self._workflow_execution_id is None:
            logger.debug("No workflow_execution_id set, nothing to release")
            return

        sandbox = SandboxManager.unregister(self._workflow_execution_id)
        if sandbox is None:
            logger.debug("No sandbox to release for workflow_execution_id=%s", self._workflow_execution_id)
            return

        sandbox_id = sandbox.metadata.id
        logger.info(
            "Releasing sandbox, workflow_execution_id=%s, sandbox_id=%s",
            self._workflow_execution_id,
            sandbox_id,
        )

        try:
            sandbox_storage = ArchiveSandboxStorage(
                storage=storage,
                tenant_id=self._tenant_id,
                sandbox_id=self._workflow_execution_id,
            )
            sandbox_storage.unmount(sandbox)
            logger.info("Sandbox files persisted, workflow_execution_id=%s", self._workflow_execution_id)
        except Exception:
            logger.exception("Failed to persist sandbox files, workflow_execution_id=%s", self._workflow_execution_id)

        try:
            sandbox.release_environment()
            logger.info("Sandbox released, sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox, sandbox_id=%s", sandbox_id)
        finally:
            self._workflow_execution_id = None
