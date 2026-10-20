"""Native scope identities and scoped data-plane access.

Only the authenticated A7 supervisor creates scopes. These DTOs describe stable
identities, never permission, transport tokens, or a replacement-job recipe.
"""

from dataclasses import dataclass
from typing import override

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.adapters.shell.protocols import ShellCommandResult, ShellExecutionMode
from dify_agent.adapters.shell.shellctl import ShellctlCommands
from dify_agent.runtime_backend.shellctl import ShellctlRuntimeLease


class AgentJobUnavailable(RuntimeError):
    pass


class ShellJobRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    binding_ref: str = Field(min_length=1)
    backend_revision: str = Field(min_length=1)
    workspace_generation: int = Field(ge=1)
    job_id: str = Field(min_length=1)
    output_offset: int = Field(ge=0)


def validate_job_identity(*, saved: ShellJobRef, actual: ShellJobRef) -> None:
    fields = ("binding_ref", "backend_revision", "workspace_generation", "job_id")
    if any(getattr(saved, key) != getattr(actual, key) for key in fields):
        raise AgentJobUnavailable("native_job_identity_mismatch")


class NativeTestRuntimeCapabilities(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    backend_revision: str = "a7-v1"
    bounded_network: bool = True
    isolated_files: bool = True
    bounded_processes: bool = True
    cancellation: bool = True
    durable_jobs: bool = True


def native_binding_identity(binding_ref: str) -> tuple[str, int] | None:
    if not binding_ref.startswith("native:"):
        return None
    parts = binding_ref.split(":")
    if len(parts) != 3 or not parts[2].isdigit() or int(parts[2]) < 1:
        raise AgentJobUnavailable("native_binding_identity_invalid")
    return parts[1], int(parts[2])


@dataclass(slots=True)
class NativeScopeCommands(ShellctlCommands):
    """Let the supervisor own HOME/PATH/temp, and prohibit ambient API keys."""

    @override
    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float,
        mode: ShellExecutionMode = "pty",
    ) -> ShellCommandResult:
        from dify_agent.adapters.shell.shellctl import _from_job_result, _run_client_call
        from shellctl.shared import JobMode

        if cwd != "/workspace" or env:
            raise AgentJobUnavailable("native_environment_import_requires_capability")
        return _from_job_result(
            await _run_client_call(self.client.run(script, cwd=cwd, env=None, timeout=timeout, mode=JobMode(mode)))
        )


@dataclass(slots=True)
class NativeScopeLease(ShellctlRuntimeLease):
    backend_revision: str = "a7-v1"
    workspace_generation: int = 1

    def job_ref(self, job_id: str, output_offset: int) -> ShellJobRef:
        return ShellJobRef(
            binding_ref=self.handle,
            backend_revision=self.backend_revision,
            workspace_generation=self.workspace_generation,
            job_id=job_id,
            output_offset=output_offset,
        )
