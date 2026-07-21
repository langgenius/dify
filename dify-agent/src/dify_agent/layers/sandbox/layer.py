"""Sandbox lifecycle layer.

Only the stable, non-sensitive backend handle enters runtime state. The live
lease is acquired for one compositor invocation and deterministically suspended
or deleted while its data-plane clients are still available.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import logging
from typing import ClassVar

from agenton.layers import LayerDeps, PlainLayer
from typing_extensions import Self, override

from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.home.layer import DifyHomeLayer
from dify_agent.layers.sandbox.configs import (
    DIFY_SANDBOX_LAYER_TYPE_ID,
    DifySandboxLayerConfig,
    DifySandboxRuntimeState,
)
from dify_agent.layers.workspace.layer import DifyWorkspaceLayer
from dify_agent.runtime_backend import SandboxCreateSpec, SandboxDriver, SandboxLease

logger = logging.getLogger(__name__)


class DifySandboxLayerDeps(LayerDeps):
    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]
    home: DifyHomeLayer  # pyright: ignore[reportUninitializedInstanceVariable]
    workspace: DifyWorkspaceLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifySandboxLayer(PlainLayer[DifySandboxLayerDeps, DifySandboxLayerConfig, DifySandboxRuntimeState]):
    """Own one request's live lease and the session's stable Sandbox handle.

    Enter creates when runtime state has no handle and otherwise resumes the
    exact saved resource. Exit always clears the invocation-local lease, then
    suspends it and optionally deletes the physical Sandbox. A primary body
    error or cancellation remains authoritative; cleanup failures are logged
    instead of masking it. Without a primary error, cleanup failures propagate.
    The persisted handle is cleared only after delete succeeds.
    """

    type_id: ClassVar[str | None] = DIFY_SANDBOX_LAYER_TYPE_ID

    config: DifySandboxLayerConfig
    driver: SandboxDriver
    _lease: SandboxLease | None = field(default=None, init=False)
    _delete_on_exit: bool = field(default=False, init=False)

    @classmethod
    @override
    def from_config(cls, config: DifySandboxLayerConfig) -> Self:
        del config
        raise TypeError("DifySandboxLayer requires a server-injected SandboxDriver.")

    @classmethod
    def from_config_with_driver(cls, config: DifySandboxLayerConfig, *, driver: SandboxDriver) -> Self:
        return cls(config=DifySandboxLayerConfig.model_validate(config), driver=driver)

    @property
    def lease(self) -> SandboxLease:
        """Return the active invocation lease or fail outside resource context."""
        if self._lease is None:
            raise RuntimeError("DifySandboxLayer lease is only available inside resource_context().")
        return self._lease

    @override
    @asynccontextmanager
    async def resource_context(self) -> AsyncGenerator[None]:
        """Acquire, expose, and release one lease while preserving error priority.

        Cancellation follows the same primary-error path as other
        ``BaseException`` values. Suspend is attempted before optional delete;
        both failures are recorded, but successful deletion alone clears the
        stable handle from runtime state.
        """
        if self._lease is not None:
            raise RuntimeError("DifySandboxLayer resource_context() is already active.")
        handle = self.runtime_state.handle
        lease = (
            await self.driver.resume(handle) if handle is not None else await self.driver.create(self._create_spec())
        )
        self._delete_on_exit = False
        primary_error: BaseException | None = None
        try:
            if handle is None:
                self.runtime_state.handle = lease.handle
            elif lease.handle != handle:
                raise RuntimeError("SandboxDriver.resume() must preserve the stable sandbox handle.")
            self._lease = lease
            yield
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            self._lease = None
            release_error: BaseException | None = None
            delete_error: BaseException | None = None
            try:
                await self.driver.suspend(lease)
            except BaseException as exc:
                release_error = exc
            if self._delete_on_exit:
                try:
                    await self.driver.delete(lease.handle)
                except BaseException as exc:
                    delete_error = exc
                else:
                    self.runtime_state.handle = None

            if primary_error is not None:
                _log_cleanup_errors(lease.handle, release_error=release_error, delete_error=delete_error)
            elif delete_error is not None:
                if release_error is not None:
                    logger.warning(
                        "Failed to release sandbox lease %r before sandbox deletion also failed: %s",
                        lease.handle,
                        release_error,
                    )
                raise delete_error
            elif release_error is not None:
                raise release_error

    @override
    async def on_context_create(self) -> None:
        _ = self.lease

    @override
    async def on_context_resume(self) -> None:
        _ = self.lease

    @override
    async def on_context_suspend(self) -> None:
        _ = self.lease

    @override
    async def on_context_delete(self) -> None:
        _ = self.lease
        self._delete_on_exit = True

    def _create_spec(self) -> SandboxCreateSpec:
        execution_context = self.deps.execution_context.config
        if execution_context.agent_id is None:
            raise ValueError("Sandbox creation requires execution_context.agent_id.")
        if execution_context.agent_config_version_id is None:
            raise ValueError("Sandbox creation requires execution_context.agent_config_version_id.")
        return SandboxCreateSpec(
            tenant_id=execution_context.tenant_id,
            agent_id=execution_context.agent_id,
            agent_config_version_id=execution_context.agent_config_version_id,
            runtime_session_id=self.deps.workspace.binding.workspace_id,
            home_snapshot_ref=self.deps.home.binding.snapshot_ref,
        )


def _log_cleanup_errors(
    handle: str,
    *,
    release_error: BaseException | None,
    delete_error: BaseException | None,
) -> None:
    if release_error is not None:
        logger.warning("Failed to release sandbox lease %r after operation failed: %s", handle, release_error)
    if delete_error is not None:
        logger.warning("Failed to delete sandbox %r after operation failed: %s", handle, delete_error)


__all__ = ["DifySandboxLayer", "DifySandboxLayerDeps"]
