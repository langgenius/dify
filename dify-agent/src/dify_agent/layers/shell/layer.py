"""Runtime sandbox shell layer.

This layer gives Dify Agent a resumable workspace plus a first-class ephemeral
command API used by the ``/sandbox`` server routes. The layer keeps the Agenton
core boundary intact: only serializable workspace state is stored in
``runtime_state``, while subprocess handles stay local to one method call and
never leak into snapshots. The execution context dependency is used only to
inject the same Dify-owned correlation data that sandbox-installed helper tools
such as ``dify-agent-stub`` need at command runtime.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell.configs import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig


class DifyShellLayerDeps(LayerDeps):
    """Direct dependencies for the sandbox shell layer."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


class DifyShellLayerRuntimeState(BaseModel):
    """Serializable shell workspace state needed for sandbox resume."""

    session_id: str = ""
    workspace_cwd: str = ""
    job_ids: list[str] = Field(default_factory=list)
    job_offsets: dict[str, int] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


@dataclass(frozen=True, slots=True)
class ShellCommandResult:
    """Completed ephemeral sandbox command output."""

    exit_code: int
    stdout: str
    stderr: str


class ShellCommandTimeoutError(TimeoutError):
    """Raised when an ephemeral shell command exceeds its timeout."""


@dataclass(slots=True)
class DifyShellLayer(PlainLayer[DifyShellLayerDeps, DifyShellLayerConfig, DifyShellLayerRuntimeState]):
    """Resumable sandbox workspace with ephemeral command execution.

    ``run_ephemeral_command`` is intentionally separate from any future
    user-visible shell job API. It executes one short-lived command inside the
    current workspace, injects Dify correlation env vars, and leaves the public
    runtime-state job tracking untouched.
    """

    type_id: ClassVar[str | None] = DIFY_SHELL_LAYER_TYPE_ID
    _MANAGED_ROOT_NAME: ClassVar[str] = "dify-agent-shell"
    _SESSION_ID_PATTERN: ClassVar[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9-]+$")

    config: DifyShellLayerConfig

    @property
    def workspace_path(self) -> Path:
        """Return the validated workspace path for the current shell session.

        The sandbox service may resume the layer from untrusted request data, so
        runtime state must prove that the stored path matches the server-managed
        workspace root plus ``session_id`` exactly. This prevents callers from
        redirecting sandbox reads to arbitrary host paths such as ``/etc``.
        """
        session_id = self.runtime_state.session_id
        workspace_cwd = self.runtime_state.workspace_cwd
        if not session_id or not workspace_cwd:
            raise RuntimeError("Shell workspace is not initialized.")
        expected_path = self.workspace_path_for_session_id(session_id)
        actual_path = Path(workspace_cwd).resolve()
        if actual_path != expected_path:
            raise RuntimeError("Shell workspace path does not match the managed sandbox root.")
        return actual_path

    @classmethod
    def managed_root(cls) -> Path:
        """Return the server-managed root directory for all shell workspaces."""
        return (Path(tempfile.gettempdir()) / cls._MANAGED_ROOT_NAME).resolve()

    @classmethod
    def workspace_path_for_session_id(cls, session_id: str) -> Path:
        """Return the only valid workspace path for ``session_id``."""
        if not session_id or cls._SESSION_ID_PATTERN.fullmatch(session_id) is None:
            raise RuntimeError("Shell session_id is invalid.")
        return (cls.managed_root() / session_id).resolve()

    async def on_context_create(self) -> None:
        """Create a fresh sandbox workspace and resume token."""
        session_id = str(uuid4())
        workspace = self.workspace_path_for_session_id(session_id)
        workspace.mkdir(parents=True, exist_ok=True)
        self.runtime_state.session_id = session_id
        self.runtime_state.workspace_cwd = str(workspace)
        self.runtime_state.job_ids = []
        self.runtime_state.job_offsets = {}

    async def on_context_resume(self) -> None:
        """Reject resume when the original workspace is no longer available."""
        workspace = self.workspace_path
        if not workspace.exists() or not workspace.is_dir():
            raise RuntimeError("Shell workspace no longer exists for resume.")

    async def on_context_delete(self) -> None:
        """Remove the workspace directory when the shell layer is deleted."""
        try:
            workspace = self.workspace_path
        except RuntimeError:
            return
        shutil.rmtree(workspace, ignore_errors=True)

    async def run_ephemeral_command(
        self,
        script: str,
        *,
        timeout: float,
        extra_env: dict[str, str] | None = None,
    ) -> ShellCommandResult:
        """Execute one short-lived command inside the sandbox workspace.

        The command runs with the same workspace cwd and Dify correlation env as
        any sandbox-installed helper tooling. It is never recorded in
        ``runtime_state.job_ids`` and always waits for process cleanup before
        returning or timing out.
        """
        env = os.environ.copy()
        env.update(self._sandbox_env())
        env.update(extra_env or {})
        process = await asyncio.create_subprocess_shell(
            script,
            cwd=str(self.workspace_path),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
            except asyncio.TimeoutError as exc:
                process.kill()
                stdout, stderr = await process.communicate()
                raise ShellCommandTimeoutError(
                    f"sandbox command timed out after {timeout} seconds: {stderr.decode('utf-8', 'replace')}"
                ) from exc
            return ShellCommandResult(
                exit_code=process.returncode or 0,
                stdout=stdout.decode("utf-8", "replace"),
                stderr=stderr.decode("utf-8", "replace"),
            )
        finally:
            # Ephemeral commands intentionally do not touch the user-visible job
            # tracking fields. Keep them normalized in case future changes reuse
            # this method around code that mutates the lists elsewhere.
            self.runtime_state.job_ids = list(self.runtime_state.job_ids)
            self.runtime_state.job_offsets = dict(self.runtime_state.job_offsets)

    @classmethod
    @override
    def from_config(cls, config: DifyShellLayerConfig) -> DifyShellLayer:
        """Create the shell layer from the empty public config."""
        return cls(config=config)

    def _sandbox_env(self) -> dict[str, str]:
        execution_context = self.deps.execution_context.config
        env = {
            "DIFY_SANDBOX_PATH": str(self.workspace_path),
            "DIFY_AGENT_STUB_TENANT_ID": execution_context.tenant_id,
            "DIFY_AGENT_STUB_INVOKE_FROM": execution_context.invoke_from,
        }
        optional_values = {
            "DIFY_AGENT_STUB_USER_ID": execution_context.user_id,
            "DIFY_AGENT_STUB_APP_ID": execution_context.app_id,
            "DIFY_AGENT_STUB_WORKFLOW_ID": execution_context.workflow_id,
            "DIFY_AGENT_STUB_WORKFLOW_RUN_ID": execution_context.workflow_run_id,
            "DIFY_AGENT_STUB_NODE_ID": execution_context.node_id,
            "DIFY_AGENT_STUB_NODE_EXECUTION_ID": execution_context.node_execution_id,
            "DIFY_AGENT_STUB_CONVERSATION_ID": execution_context.conversation_id,
            "DIFY_AGENT_STUB_AGENT_ID": execution_context.agent_id,
            "DIFY_AGENT_STUB_AGENT_CONFIG_VERSION_ID": execution_context.agent_config_version_id,
            "DIFY_AGENT_STUB_TRACE_ID": execution_context.trace_id,
        }
        for key, value in optional_values.items():
            if value is not None:
                env[key] = value
        return env


__all__ = [
    "DifyShellLayer",
    "DifyShellLayerConfig",
    "DifyShellLayerDeps",
    "DifyShellLayerRuntimeState",
    "ShellCommandResult",
    "ShellCommandTimeoutError",
]
