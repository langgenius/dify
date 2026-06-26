"""Shellctl-backed Dify shell layer.

``DifyShellLayer`` is a stateful pydantic-ai tool layer that exposes exactly
``shell_run``, ``shell_wait``, ``shell_input``, and ``shell_interrupt``. The
layer persists only JSON-safe shell session state in ``runtime_state`` and keeps
its live shellctl HTTP client on the layer instance only while
``resource_context()`` is active. Agenton enters that resource scope before
``on_context_create`` or ``on_context_resume`` and exits it after
``on_context_suspend`` or ``on_context_delete``, so business hooks and shell
tools can rely on a live client without ever serializing it into snapshots.

The runtime state tracks shellctl job ids for both user-visible shell jobs and
internal lifecycle jobs such as workspace mkdir/cleanup commands. Those internal
jobs are intentionally not deleted ad hoc; shellctl job-state deletion is
centralized in ``on_context_delete`` so one lifecycle hook owns exit-time
cleanup for successful create/resume flows. If ``on_context_create`` or a later
side-effecting ``on_context_resume`` attempt fails after issuing shellctl jobs,
Agenton still exits ``resource_context()`` but never transitions the layer to
``ACTIVE``. In that failed-enter path, normal suspend/delete hooks do not run,
so the enter hook itself must perform best-effort business compensation before
re-raising the failure. Agent Soul shell env is injected into user-visible
commands and CLI bootstrap commands without persisting a workspace env file.
Agent Stub env injection uses shellctl's native per-run ``env`` argument for
user-visible ``shell.run`` and for trusted server-owned fixed scripts executed
through ``run_remote_script()``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable, Sequence
from contextlib import asynccontextmanager
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import ClassVar, NotRequired, Protocol, TypedDict

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, field_validator, model_validator
from pydantic_ai import Tool
from shell_session_manager.shellctl.client import ShellctlClient, ShellctlClientError
from shell_session_manager.shellctl.shared import (
    DEFAULT_TERMINATE_GRACE_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    DeleteJobResponse,
    JobResult,
    JobStatusView,
)
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PydanticAILayer, PydanticAIPrompt, PydanticAITool
from dify_agent.agent_stub.server.shell_agent_stub_env import ShellAgentStubTokenFactory, build_shell_agent_stub_env
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.shell.configs import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig


logger = logging.getLogger(__name__)

_WORKSPACE_ROOT = "~/workspace"
_WORKSPACE_COLLISION_EXIT_CODE = 17
_SESSION_TIME_HEX_MASK = 0xFFFFF
_SESSION_RANDOM_HEX_LENGTH = 2
_SESSION_ID_ATTEMPT_LIMIT = 256
_SESSION_ID_PATTERN = re.compile(r"^[0-9a-f]{7}$")
_REMOTE_COMMAND_MAX_OUTPUT_WINDOWS = 64
_SHELL_LAYER_PREFIX_PROMPT = """You have access to a shell layer. It provides four tools:

1. shell_run
   Start a new shell job in the current isolated workspace.
   Use it to execute commands or scripts.

2. shell_wait
   Wait for more output or completion from an existing shell job.
   Use it when shell_run returns done=false.

3. shell_input
   Send stdin text to a running shell job, then wait for new output.
   Use it for interactive commands that are waiting for input.

4. shell_interrupt
   Interrupt a running shell job.
   Use it to stop a long-running, stuck, or no-longer-needed command.

Common arguments:

- script:
  The command or script to execute. Used by shell_run.

- job_id:
  The id of a shell job returned by shell_run.
  Use it with shell_wait, shell_input, and shell_interrupt.
  Never invent a job_id.

- timeout:
  Maximum time, in seconds, to wait for output or completion for this tool call.
  A timeout does not necessarily mean the job has stopped; if done=false, use shell_wait again.

- text:
  Text to send to the running process stdin. Used by shell_input.
  Include "\\n" if the process expects Enter.

- grace_seconds:
  Time to wait after interrupting before forceful cleanup. Used by shell_interrupt.

Usage rules:

- Start with shell_run.
- If shell_run returns done=false, call shell_wait with the returned job_id.
- Use shell_input only when the job is running and waiting for stdin.
- Use shell_interrupt when a job is stuck or should be stopped.

The script argument of shell_run can be a normal shell script, or a shebang script.
If the first line is a shebang, the shell layer executes the script directly.

Tips:

- When using Python, prefer a uv script with a PEP 723 dependency header.

  Example:

#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "httpx==0.28.1",
#   "rich>=13.8.0",
# ]
# ///

import httpx
from rich import print

response = httpx.get("https://example.com", timeout=10)
print(f"[green]status:[/green] {response.status_code}")"""


class ShellJobObservation(TypedDict):
    """JSON-safe output-oriented shell tool observation."""

    job_id: str
    status: str
    done: bool
    exit_code: int | None
    output: str
    offset: int
    truncated: bool
    output_path: str


class ShellJobStatusObservation(TypedDict):
    """JSON-safe status-only shell tool observation."""

    job_id: str
    status: str
    done: bool
    exit_code: int | None
    offset: int


class ShellToolErrorObservation(TypedDict):
    """Tool-visible failure payload for expected shell-layer errors."""

    error: str
    job_id: NotRequired[str]


type ShellRunToolResult = ShellJobObservation | ShellToolErrorObservation
type ShellInterruptToolResult = ShellJobStatusObservation | ShellToolErrorObservation


class DifyShellLayerDeps(LayerDeps):
    """Optional direct-layer dependencies used by the shell runtime layer.

    The execution context supplies the token principal. The drive ref used for
    Agent Stub CLI commands is passed through config so the drive layer can
    depend on shell for eager materialization without a dependency cycle.
    """

    execution_context: DifyExecutionContextLayer | None  # pyright: ignore[reportUninitializedInstanceVariable]


class ShellctlClientProtocol(Protocol):
    """Boundary that the shell layer needs from a shellctl client."""

    async def run(
        self,
        script: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> JobResult: ...

    async def wait(
        self,
        job_id: str,
        *,
        offset: int,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> JobResult: ...

    async def input(
        self,
        job_id: str,
        text: str,
        *,
        offset: int,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> JobResult: ...

    async def terminate(
        self,
        job_id: str,
        grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS,
    ) -> JobStatusView: ...

    async def delete(
        self,
        job_id: str,
        *,
        force: bool = False,
        grace_seconds: float | None = None,
    ) -> DeleteJobResponse: ...

    async def close(self) -> None: ...


type ShellctlClientFactory = Callable[[str], ShellctlClientProtocol]


class DifyShellRuntimeState(BaseModel):
    """Serializable shell session state stored in Agenton snapshots.

    ``job_ids`` and ``job_offsets`` contain both user-facing jobs and internal
    lifecycle jobs so resumed sessions can still clean up shellctl state that was
    created before suspension. Callers should replace the stored list/dict values
    rather than mutating them in place so Pydantic assignment validation keeps
    guarding the serialized state. Hydrated public snapshots must keep
    ``session_id`` in the proposal's safe lowercase-hex format and must keep
    ``workspace_cwd`` exactly aligned with ``~/workspace/<session_id>`` so resume
    and delete paths cannot escape the isolated workspace root or inject shell
    syntax into lifecycle commands. Shellctl job ids remain opaque strings here;
    the layer only enforces uniqueness plus the invariant that any stored offset
    entry must belong to a tracked job id in the same runtime state.
    """

    session_id: str | None = None
    workspace_cwd: str | None = None
    job_ids: list[str] = Field(default_factory=list)
    job_offsets: dict[str, NonNegativeInt] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str | None) -> str | None:
        """Accept only the short lowercase-hex session ids defined by the proposal."""
        if value is None:
            return value
        return _validated_session_id(value)

    @field_validator("job_ids")
    @classmethod
    def validate_job_ids(cls, value: list[str]) -> list[str]:
        """Keep tracked shellctl job ids unique within one serialized session."""
        if len(value) != len(set(value)):
            raise ValueError("job_ids must not contain duplicates.")
        return value

    @model_validator(mode="after")
    def validate_workspace_and_offsets(self) -> Self:
        """Keep resumed workspace identity and tracked offset keys self-consistent."""
        if self.workspace_cwd is not None:
            if self.session_id is None:
                raise ValueError("workspace_cwd requires a matching session_id.")
            expected_workspace = _workspace_cwd(self.session_id)
            if self.workspace_cwd != expected_workspace:
                raise ValueError(f"workspace_cwd must equal {expected_workspace!r} for session_id {self.session_id!r}.")
        unknown_offset_job_ids = set(self.job_offsets) - set(self.job_ids)
        if unknown_offset_job_ids:
            names = ", ".join(sorted(unknown_offset_job_ids))
            raise ValueError(f"job_offsets contains unknown job ids: {names}.")
        return self


@dataclass(frozen=True, slots=True)
class RemoteCommandResult:
    """Completed remote sandbox command returned to server-owned callers."""

    job_id: str
    status: str
    done: bool
    exit_code: int | None
    output: str
    offset: int
    truncated: bool
    output_path: str


@dataclass(slots=True)
class DifyShellLayer(PydanticAILayer[DifyShellLayerDeps, object, DifyShellLayerConfig, DifyShellRuntimeState]):
    """Shell tool layer backed by a live shellctl client while active.

    The mutable serializable state lives in ``runtime_state``; the live client is
    intentionally kept off-snapshot in ``_shellctl_client``. Tool methods update
    tracked job ids and output offsets after every successful shellctl response so
    later ``shell_wait``/``shell_input`` calls can resume from the last known
    offset without exposing offsets as model-controlled inputs.
    """

    type_id: ClassVar[str | None] = DIFY_SHELL_LAYER_TYPE_ID

    config: DifyShellLayerConfig
    shellctl_entrypoint: str
    shellctl_client_factory: ShellctlClientFactory
    agent_stub_api_base_url: str | None = None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None
    _shellctl_client: ShellctlClientProtocol | None = None

    @classmethod
    @override
    def from_config(cls, config: DifyShellLayerConfig) -> Self:
        """Reject construction that omits server-injected shellctl settings."""
        del config
        raise TypeError("DifyShellLayer requires server-side shellctl settings and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyShellLayerConfig,
        *,
        shellctl_entrypoint: str | None,
        shellctl_client_factory: ShellctlClientFactory,
        agent_stub_api_base_url: str | None = None,
        agent_stub_token_factory: ShellAgentStubTokenFactory | None = None,
    ) -> Self:
        """Create the layer from public config plus server-only shell settings."""
        normalized_entrypoint = (shellctl_entrypoint or "").strip()
        if not normalized_entrypoint:
            raise ValueError(
                "DifyShellLayer requires a non-empty DIFY_AGENT_SHELLCTL_ENTRYPOINT when the 'dify.shell' layer is used."
            )
        layer = cls(
            config=config,
            shellctl_entrypoint=normalized_entrypoint,
            shellctl_client_factory=shellctl_client_factory,
            agent_stub_api_base_url=agent_stub_api_base_url,
            agent_stub_token_factory=agent_stub_token_factory,
        )
        layer.bind_deps({})
        return layer

    @property
    @override
    def prefix_prompts(self) -> Sequence[PydanticAIPrompt[object]]:
        return [_shell_layer_prefix_prompt]

    @property
    @override
    def tools(self) -> Sequence[PydanticAITool[object]]:
        return [
            Tool(self._tool_run, name="shell_run"),
            Tool(self._tool_wait, name="shell_wait"),
            Tool(self._tool_input, name="shell_input"),
            Tool(self._tool_interrupt, name="shell_interrupt"),
        ]

    @override
    @asynccontextmanager
    async def resource_context(self) -> AsyncGenerator[None]:
        """Hold one live shellctl client for one active Agenton layer scope.

        The shellctl client is a non-serializable live resource, so Agenton owns
        only the timing of this scope, not the client itself. Business hooks and
        tools should call ``_require_client()`` to ensure they are running inside
        an active resource scope.
        """
        if self._shellctl_client is not None:
            raise RuntimeError("DifyShellLayer resource_context() is already active for this layer instance.")

        client = self.shellctl_client_factory(self.shellctl_entrypoint)
        self._shellctl_client = client
        try:
            yield
        finally:
            self._shellctl_client = None
            await client.close()

    @override
    async def on_context_create(self) -> None:
        """Allocate a new workspace session using the active live shellctl client.

        If workspace setup partially succeeds and this hook later raises, the
        layer never becomes ``ACTIVE``. In that path Agenton still exits
        ``resource_context()``, but ``on_context_delete()`` will not run, so this
        hook must clean up any tracked shellctl job artifacts before re-raising.
        """
        try:
            _ = self._require_client()
            session_id, workspace_cwd = await self._allocate_workspace()
            await self._bootstrap_workspace(workspace_cwd)
        except BaseException:
            await self._cleanup_create_failure()
            raise
        self.runtime_state = DifyShellRuntimeState.model_validate(
            {
                **self.runtime_state.model_dump(mode="python"),
                "session_id": session_id,
                "workspace_cwd": workspace_cwd,
            }
        )

    @override
    async def on_context_resume(self) -> None:
        """Resume an existing serialized shell session inside an active resource scope.

        If a future resume path adds self-heal side effects before raising, this
        hook must compensate for them itself because failed resume attempts never
        transition the slot back to ``ACTIVE`` and therefore do not receive a
        normal suspend/delete hook.
        """
        _ = self._require_client()
        _ = self._require_session_identity()

    @override
    async def on_context_suspend(self) -> None:
        """Preserve workspace and job state while the live client remains active.

        ``resource_context()`` owns client teardown after this hook returns.
        """
        _ = self._require_client()

    @override
    async def on_context_delete(self) -> None:
        """Best-effort cleanup for workspace deletion and tracked shellctl jobs.

        Workspace removal must happen before tracked shellctl job deletion because
        the cleanup itself is implemented as an internal shellctl run. That means
        deleting job state first would prevent the layer from issuing the
        proposal-required ``rm -rf`` cleanup job and then cleaning up that final
        job record along with the rest of the session's tracked shellctl state.
        ``resource_context()`` closes the live client only after this hook
        finishes.
        """
        _ = self._require_client()

        cleanup_job_id: str | None = None
        identity = self._try_session_identity()
        if identity is not None:
            session_id, _workspace_cwd = identity
            try:
                cleanup_result = await self._run_internal_job_to_completion(
                    _workspace_cleanup_script(session_id=session_id),
                    cwd=None,
                )
                cleanup_job_id = cleanup_result["job_id"]
                if cleanup_result["exit_code"] != 0:
                    logger.warning(
                        "Shell workspace cleanup job %s for session %s exited with code %s.",
                        cleanup_job_id,
                        session_id,
                        cleanup_result["exit_code"],
                    )
            except (RuntimeError, ValueError, ShellctlClientError) as exc:
                logger.warning("Failed to remove shell workspace for session %s: %s", session_id, exc)

        tracked_job_ids = _deduplicate_preserving_order(
            [*self.runtime_state.job_ids, *([cleanup_job_id] if cleanup_job_id is not None else [])]
        )
        await self._delete_tracked_jobs_best_effort(tracked_job_ids)
        self._clear_tracked_jobs()

    async def _tool_run(self, script: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Start a new shell job inside the session workspace."""
        try:
            client = self._require_client()
            result = await client.run(
                _wrap_user_script(script, self.config),
                cwd=self._require_workspace_cwd(),
                env=self._build_user_shell_run_env(),
                timeout=timeout,
            )
            self._track_job_result(result)
            return _job_result_observation(result)
        except (RuntimeError, ValueError, ShellctlClientError) as exc:
            return _tool_error(str(exc))

    async def _tool_wait(self, job_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Wait for more output or completion from a tracked shell job."""
        try:
            client = self._require_client()
            offset = self._tracked_offset(job_id)
            result = await client.wait(job_id, offset=offset, timeout=timeout)
            self._track_job_result(result)
            return _job_result_observation(result)
        except (RuntimeError, ValueError, ShellctlClientError) as exc:
            return _tool_error(str(exc), job_id=job_id)

    async def _tool_input(self, job_id: str, text: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Send text input to a tracked shell job and wait for output."""
        try:
            client = self._require_client()
            offset = self._tracked_offset(job_id)
            result = await client.input(job_id, text, offset=offset, timeout=timeout)
            self._track_job_result(result)
            return _job_result_observation(result)
        except (RuntimeError, ValueError, ShellctlClientError) as exc:
            return _tool_error(str(exc), job_id=job_id)

    async def _tool_interrupt(
        self,
        job_id: str,
        grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS,
    ) -> ShellInterruptToolResult:
        """Interrupt a tracked shell job without removing its persisted shellctl state."""
        try:
            client = self._require_client()
            self._ensure_tracked_job(job_id)
            result = await client.terminate(job_id, grace_seconds=grace_seconds)
            self._track_job_status(result)
            return _job_status_observation(result)
        except (RuntimeError, ValueError, ShellctlClientError) as exc:
            return _tool_error(str(exc), job_id=job_id)

    async def run_remote_script(
        self,
        script: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        inject_agent_stub_env: bool = False,
    ) -> RemoteCommandResult:
        """Run one trusted server-side script inside the sandbox workspace.

        The sandbox file service uses this boundary for fixed list/read/upload
        helpers. The layer owns output paging, transient shellctl job cleanup,
        and optional Agent Stub env injection.

        Unlike model-visible ``shell.run``, this server-owned boundary does not
        inject Agent Soul shell env. Keeping the user-controlled shell env out
        of this path prevents sandbox code from clobbering trusted Agent Stub
        env values before ``dify-agent file upload`` executes.
        """
        env = None
        if inject_agent_stub_env:
            env = self._build_user_shell_run_env()
            if env is None:
                raise RuntimeError("Agent Stub environment injection is not available for this shell session.")
        return await self._run_remote_job_to_completion(
            script,
            timeout=timeout,
            env=env,
        )

    async def _allocate_workspace(self) -> tuple[str, str]:
        """Allocate a unique ``~/workspace/<session_id>`` directory by mkdir collision checks."""
        for _attempt in range(_SESSION_ID_ATTEMPT_LIMIT):
            session_id = _generate_session_id()
            mkdir_result = await self._run_internal_job_to_completion(
                _workspace_mkdir_script(session_id=session_id),
                cwd=None,
            )
            if mkdir_result["exit_code"] == _WORKSPACE_COLLISION_EXIT_CODE:
                continue
            if mkdir_result["exit_code"] != 0:
                raise RuntimeError(
                    f"Failed to create shell workspace {_workspace_cwd(session_id)}: {mkdir_result['status']} exit_code={mkdir_result['exit_code']}"
                )
            return session_id, _workspace_cwd(session_id)
        raise RuntimeError("Failed to allocate a unique shell workspace session id after 256 attempts.")

    async def _bootstrap_workspace(self, workspace_cwd: str) -> None:
        """Apply Agent Soul shell config to the freshly-created workspace."""
        bootstrap_script = _workspace_bootstrap_script(self.config)
        if not bootstrap_script:
            return
        result = await self._run_internal_job_to_completion(bootstrap_script, cwd=workspace_cwd)
        if result["exit_code"] != 0:
            raise RuntimeError(
                f"Failed to bootstrap shell workspace {workspace_cwd}: {result['status']} exit_code={result['exit_code']}"
            )

    async def _cleanup_create_failure(self) -> None:
        """Best-effort shellctl job cleanup for create failures before ACTIVE state.

        Agenton only calls ``on_context_delete`` for layers that successfully
        entered ``ACTIVE``. If ``on_context_create`` fails after issuing one or
        more internal shellctl jobs, those tracked job artifacts would otherwise
        leak because no later lifecycle hook owns them. ``resource_context()``
        still closes the live client for this failed enter attempt after the hook
        unwinds.
        """
        if not self.runtime_state.job_ids:
            return
        try:
            await self._delete_tracked_jobs_best_effort(self.runtime_state.job_ids)
        finally:
            self._clear_tracked_jobs()

    async def _run_internal_job_to_completion(
        self,
        script: str,
        *,
        cwd: str | None,
    ) -> ShellJobObservation:
        """Run an internal lifecycle command, track it, and wait for completion."""
        client = self._require_client()
        result = await client.run(script, cwd=cwd, env=None, timeout=DEFAULT_TIMEOUT_SECONDS)
        self._track_job_result(result)
        while not result.done:
            result = await client.wait(
                result.job_id,
                offset=self._tracked_offset(result.job_id),
                timeout=DEFAULT_TIMEOUT_SECONDS,
            )
            self._track_job_result(result)
        return _job_result_observation(result)

    async def _run_remote_job_to_completion(
        self,
        script: str,
        *,
        timeout: float,
        env: dict[str, str] | None,
    ) -> RemoteCommandResult:
        """Run a workspace-scoped script to completion and delete its job state.

        Shellctl's ``truncated`` flag is per output window: it means the caller
        should continue from the returned offset. After this helper drains those
        windows, only the final window can describe whether output is still
        unread, usually because the safety window cap was reached.
        """
        client = self._require_client()
        job_id: str | None = None
        try:
            result = await client.run(script, cwd=self._require_workspace_cwd(), env=env, timeout=timeout)
            job_id = result.job_id
            self._track_job_result(result)
            output_parts = [result.output]
            windows = 1
            while (result.truncated or not result.done) and windows < _REMOTE_COMMAND_MAX_OUTPUT_WINDOWS:
                result = await client.wait(result.job_id, offset=self._tracked_offset(result.job_id), timeout=timeout)
                self._track_job_result(result)
                output_parts.append(result.output)
                windows += 1
            return RemoteCommandResult(
                job_id=result.job_id,
                status=result.status.value,
                done=result.done,
                exit_code=result.exit_code,
                output="".join(output_parts),
                offset=result.offset,
                truncated=result.truncated,
                output_path=result.output_path,
            )
        finally:
            if job_id is not None:
                await self._delete_job_best_effort(job_id)
                self._forget_tracked_job(job_id)

    def _require_client(self) -> ShellctlClientProtocol:
        """Return the live client or reject tool/lifecycle use without one."""
        if self._shellctl_client is None:
            raise RuntimeError(
                "DifyShellLayer requires an active shellctl client inside resource_context(); "
                + "enter the layer through Agenton or wrap direct hook/tool usage in resource_context()."
            )
        return self._shellctl_client

    def _require_workspace_cwd(self) -> str:
        """Return the configured workspace directory for user-facing shell jobs."""
        _session_id, workspace_cwd = self._require_session_identity()
        return workspace_cwd

    def _require_session_identity(self) -> tuple[str, str]:
        """Return the stored session id and workspace path or raise for corrupt state."""
        identity = self._try_session_identity()
        if identity is None:
            raise ValueError("DifyShellLayer runtime state is missing session_id or workspace_cwd.")
        session_id, workspace_cwd = identity
        expected_workspace = _workspace_cwd(session_id)
        if workspace_cwd != expected_workspace:
            raise ValueError(
                f"DifyShellLayer runtime state has inconsistent workspace_cwd {workspace_cwd!r}; expected {expected_workspace!r}."
            )
        return session_id, workspace_cwd

    def _try_session_identity(self) -> tuple[str, str] | None:
        session_id = self.runtime_state.session_id
        workspace_cwd = self.runtime_state.workspace_cwd
        if session_id is None or workspace_cwd is None:
            return None
        return session_id, workspace_cwd

    def _ensure_tracked_job(self, job_id: str) -> None:
        """Reject tool access to job ids not tracked in the current runtime state.

        This first version treats shellctl job ids as opaque strings and uses
        membership in ``runtime_state.job_ids`` as the tool-access boundary for
        wait/input/interrupt operations.
        """
        if job_id not in self.runtime_state.job_ids:
            raise ValueError(f"Unknown shell job id for this session: {job_id}.")

    def _tracked_offset(self, job_id: str) -> int:
        """Return the stored offset for a tracked job, defaulting legacy state to zero."""
        self._ensure_tracked_job(job_id)
        return int(self.runtime_state.job_offsets.get(job_id, 0))

    def _track_job_result(self, result: JobResult) -> None:
        """Track one output-oriented shellctl result in serializable runtime state."""
        self._remember_job_id(result.job_id)
        self._remember_job_offset(result.job_id, result.offset)

    def _track_job_status(self, result: JobStatusView) -> None:
        """Track status-only shellctl results that still carry the latest offset."""
        self._remember_job_id(result.job_id)
        self._remember_job_offset(result.job_id, result.offset)

    def _remember_job_id(self, job_id: str) -> None:
        if job_id in self.runtime_state.job_ids:
            return
        self.runtime_state.job_ids = [*self.runtime_state.job_ids, job_id]

    def _remember_job_offset(self, job_id: str, offset: int) -> None:
        job_offsets = dict(self.runtime_state.job_offsets)
        job_offsets[job_id] = offset
        self.runtime_state.job_offsets = job_offsets

    async def _delete_tracked_jobs_best_effort(self, job_ids: Sequence[str]) -> None:
        """Force-delete tracked shellctl jobs, ignoring already-missing ones."""
        for job_id in _deduplicate_preserving_order(job_ids):
            await self._delete_job_best_effort(job_id)

    def _clear_tracked_jobs(self) -> None:
        self.runtime_state.job_offsets = {}
        self.runtime_state.job_ids = []

    async def _delete_job_best_effort(self, job_id: str) -> None:
        client = self._require_client()
        try:
            _ = await client.delete(job_id, force=True)
        except ShellctlClientError as exc:
            if exc.code == "job_not_found":
                return
            logger.warning(
                "Failed to delete shellctl job %s for session %s: %s",
                job_id,
                self.runtime_state.session_id,
                exc,
            )
        except RuntimeError as exc:
            logger.warning(
                "Failed to delete shellctl job %s for session %s: %s",
                job_id,
                self.runtime_state.session_id,
                exc,
            )

    def _forget_tracked_job(self, job_id: str) -> None:
        if job_id not in self.runtime_state.job_ids and job_id not in self.runtime_state.job_offsets:
            return
        job_offsets = dict(self.runtime_state.job_offsets)
        _ = job_offsets.pop(job_id, None)
        self.runtime_state.job_offsets = job_offsets
        self.runtime_state.job_ids = [
            tracked_job_id for tracked_job_id in self.runtime_state.job_ids if tracked_job_id != job_id
        ]

    def _build_user_shell_run_env(self) -> dict[str, str] | None:
        """Build per-command Agent Stub env only for user-visible ``shell.run``."""
        execution_context_layer = self.deps.execution_context
        execution_context = execution_context_layer.config if execution_context_layer is not None else None
        return build_shell_agent_stub_env(
            agent_stub_api_base_url=self.agent_stub_api_base_url,
            agent_stub_drive_ref=self.config.agent_stub_drive_ref,
            execution_context=execution_context,
            token_factory=self.agent_stub_token_factory,
            session_id=self.runtime_state.session_id,
        )


def _shell_layer_prefix_prompt() -> str:
    """Return the static model-facing shell tool usage guidance."""
    return _SHELL_LAYER_PREFIX_PROMPT


def create_shellctl_client_factory(*, token: str) -> ShellctlClientFactory:
    """Return the default shellctl client factory used by server-side providers."""

    def factory(entrypoint: str) -> ShellctlClientProtocol:
        return ShellctlClient(entrypoint, token=token)

    return factory


def _job_result_observation(result: JobResult) -> ShellJobObservation:
    return {
        "job_id": result.job_id,
        "status": result.status.value,
        "done": result.done,
        "exit_code": result.exit_code,
        "output": result.output,
        "offset": result.offset,
        "truncated": result.truncated,
        "output_path": result.output_path,
    }


def _job_status_observation(result: JobStatusView) -> ShellJobStatusObservation:
    return {
        "job_id": result.job_id,
        "status": result.status.value,
        "done": result.done,
        "exit_code": result.exit_code,
        "offset": result.offset,
    }


def _tool_error(message: str, *, job_id: str | None = None) -> ShellToolErrorObservation:
    result: ShellToolErrorObservation = {"error": message}
    if job_id is not None:
        result["job_id"] = job_id
    return result


def _generate_session_id() -> str:
    time_component = int(time.time()) & _SESSION_TIME_HEX_MASK
    random_component = secrets.token_hex(1)
    if len(random_component) != _SESSION_RANDOM_HEX_LENGTH:
        raise RuntimeError("Expected a one-byte random hex suffix for Dify shell session ids.")
    return f"{time_component:05x}{random_component}"


def _workspace_cwd(session_id: str) -> str:
    return f"{_WORKSPACE_ROOT}/{_validated_session_id(session_id)}"


def _workspace_bootstrap_script(config: DifyShellLayerConfig) -> str:
    """Return the workspace bootstrap script for CLI tool declarations."""
    install_commands = [command for tool in config.cli_tools for command in tool.install_commands]
    if not install_commands:
        return ""

    lines: list[str] = ["set -eu", *_shell_config_export_lines(config), *install_commands]
    return "\n".join(lines)


def _shell_config_export_lines(config: DifyShellLayerConfig) -> list[str]:
    """Return ephemeral Agent Soul shell exports for one shellctl command."""
    lines: list[str] = []
    for env_var in config.env:
        lines.append(f"export {env_var.name}={_shquote(env_var.value)}")
    for secret_ref in config.secret_refs:
        # Secret refs are resolved outside this public DTO. Preserve the env var
        # name without inventing a value so host-provided env can flow through.
        lines.append(f'export {secret_ref.name}="${{{secret_ref.name}:-}}"')
    for tool in config.cli_tools:
        for env_var in tool.env:
            lines.append(f"export {env_var.name}={_shquote(env_var.value)}")
        for secret_ref in tool.secret_refs:
            lines.append(f'export {secret_ref.name}="${{{secret_ref.name}:-}}"')
    if config.sandbox is not None:
        if config.sandbox.provider:
            lines.append(f"export DIFY_SANDBOX_PROVIDER={_shquote(config.sandbox.provider)}")
        if config.sandbox.config:
            sandbox_config = json.dumps(config.sandbox.config, ensure_ascii=True, sort_keys=True)
            lines.append(f"export DIFY_SANDBOX_CONFIG_JSON={_shquote(sandbox_config)}")
    return lines


def _wrap_user_script(script: str, config: DifyShellLayerConfig) -> str:
    """Inject Agent Soul env before executing a model-requested shell command."""
    lines = _shell_config_export_lines(config)
    if not lines:
        return script
    return "\n".join([*lines, script])


def _workspace_mkdir_script(*, session_id: str) -> str:
    """Return the internal mkdir command used for proposal-defined collision checks.

    The parent ``$HOME/workspace`` directory is created with ``mkdir -p`` so it
    can already exist, but the final session directory intentionally uses plain
    ``mkdir``. That second call is the collision detector: when the target
    already exists, the script maps that case to ``_WORKSPACE_COLLISION_EXIT_CODE``
    so ``on_context_create()`` can retry with a different random suffix instead
    of silently reusing another session's workspace.
    """
    safe_session_id = _validated_session_id(session_id)
    workspace_dir = f"$HOME/workspace/{safe_session_id}"
    return (
        'mkdir -p "$HOME/workspace"; '
        f'if mkdir "{workspace_dir}"; then exit 0; fi; '
        f'if [ -e "{workspace_dir}" ]; then exit {_WORKSPACE_COLLISION_EXIT_CODE}; fi; '
        "exit 1"
    )


def _workspace_cleanup_script(*, session_id: str) -> str:
    return f'rm -rf -- "$HOME/workspace/{_validated_session_id(session_id)}"'


def _shquote(value: str) -> str:
    """Single-quote a value for POSIX shells, escaping embedded single quotes."""
    return "'" + value.replace("'", "'\\''") + "'"


def _validated_session_id(session_id: str) -> str:
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        raise ValueError("session_id must match the 5+2 lowercase hex format '<5 hex><2 hex>'.")
    return session_id


def _deduplicate_preserving_order(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


__all__ = [
    "DifyShellLayerDeps",
    "DifyShellLayer",
    "DifyShellRuntimeState",
    "RemoteCommandResult",
    "ShellctlClientFactory",
    "ShellctlClientProtocol",
    "create_shellctl_client_factory",
]
