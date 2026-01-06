"""
Sandbox Layer for managing VirtualEnvironment lifecycle during workflow execution.
"""

import logging
from collections.abc import Mapping
from typing import Any

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.factory import SandboxFactory, SandboxType
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent

logger = logging.getLogger(__name__)


class SandboxInitializationError(Exception):
    """Raised when sandbox initialization fails."""

    pass


class SandboxLayer(GraphEngineLayer):
    """
    Manages VirtualEnvironment (sandbox) lifecycle during workflow execution.

    Responsibilities:
    - on_graph_start: Initialize the sandbox environment
    - on_graph_end: Release the sandbox environment (cleanup)

    Example:
        layer = SandboxLayer(
            sandbox_type=SandboxType.DOCKER,
            options={"docker_image": "python:3.11-slim"},
        )
        graph_engine.layer(layer)

        # During workflow execution, access sandbox via:
        # layer.sandbox.execute_command(...)
    """

    def __init__(
        self,
        # TODO: read from db table
        sandbox_type: SandboxType = SandboxType.DOCKER,
        options: Mapping[str, Any] | None = None,
        environments: Mapping[str, str] | None = None,
    ) -> None:
        """
        Initialize the SandboxLayer.

        Args:
            sandbox_type: Type of sandbox to create (default: DOCKER)
            options: Sandbox-specific configuration options
            environments: Environment variables to set in the sandbox
        """
        super().__init__()
        self._sandbox_type = sandbox_type
        self._options: Mapping[str, Any] = options or {}
        self._environments: Mapping[str, str] = environments or {}
        self._sandbox: VirtualEnvironment | None = None

    @property
    def sandbox(self) -> VirtualEnvironment:
        """
        Get the current sandbox instance.

        Returns:
            The initialized VirtualEnvironment instance

        Raises:
            RuntimeError: If sandbox has not been initialized
        """
        if self._sandbox is None:
            raise RuntimeError("Sandbox not initialized. Ensure on_graph_start() has been called.")
        return self._sandbox

    def on_graph_start(self) -> None:
        """
        Initialize the sandbox when workflow execution starts.

        Raises:
            SandboxInitializationError: If sandbox cannot be created
        """
        logger.info("Initializing sandbox, sandbox_type=%s", self._sandbox_type)

        try:
            self._sandbox = SandboxFactory.create(
                sandbox_type=self._sandbox_type,
                options=self._options,
                environments=self._environments,
            )
            logger.info(
                "Sandbox initialized, sandbox_id=%s, sandbox_arch=%s",
                self._sandbox.metadata.id,
                self._sandbox.metadata.arch,
            )
        except Exception as e:
            logger.exception("Failed to initialize sandbox")
            raise SandboxInitializationError(f"Failed to initialize {self._sandbox_type} sandbox: {e}") from e

    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Handle graph engine events.

        Currently a no-op, but can be extended for sandbox monitoring/health checks.
        """
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        """
        Release the sandbox when workflow execution ends.

        This method is idempotent and will not raise exceptions on cleanup failure.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        if self._sandbox is None:
            logger.debug("No sandbox to release")
            return

        sandbox_id = self._sandbox.metadata.id
        logger.info("Releasing sandbox, sandbox_id=%s", sandbox_id)

        try:
            self._sandbox.release_environment()
            logger.info("Sandbox released, sandbox_id=%s", sandbox_id)
        except Exception:
            # Log but don't raise - cleanup failures should not break workflow completion
            logger.exception("Failed to release sandbox, sandbox_id=%s", sandbox_id)
        finally:
            self._sandbox = None
