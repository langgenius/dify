import logging
from collections.abc import Mapping
from typing import Any

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.sandbox_manager import SandboxManager
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent

logger = logging.getLogger(__name__)


class SandboxInitializationError(Exception):
    pass


class SandboxLayer(GraphEngineLayer):
    def __init__(
        self,
        tenant_id: str,
        options: Mapping[str, Any] | None = None,
        environments: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__()
        self._tenant_id = tenant_id
        self._options: Mapping[str, Any] = options or {}
        self._environments: Mapping[str, str] = environments or {}
        self._workflow_execution_id: str | None = None

    def _get_workflow_execution_id(self) -> str:
        workflow_execution_id = self.graph_runtime_state.system_variable.workflow_execution_id
        if not workflow_execution_id:
            raise RuntimeError("workflow_execution_id is not set in system variables")
        return workflow_execution_id

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

        try:
            sandbox: VirtualEnvironment
            from services.sandbox.sandbox_provider_service import SandboxProviderService

            logger.info("Initializing sandbox for tenant_id=%s", self._tenant_id)
            sandbox = SandboxProviderService.create_sandbox(
                tenant_id=self._tenant_id,
                environments=self._environments,
            )

            SandboxManager.register(self._workflow_execution_id, sandbox)
            logger.info(
                "Sandbox initialized, workflow_execution_id=%s, sandbox_id=%s, sandbox_arch=%s",
                self._workflow_execution_id,
                sandbox.metadata.id,
                sandbox.metadata.arch,
            )
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
            sandbox.release_environment()
            logger.info("Sandbox released, sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox, sandbox_id=%s", sandbox_id)
        finally:
            self._workflow_execution_id = None
