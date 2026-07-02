"""Shell runtime layer backed by a live shell provider resource.

Shell command execution requires a bound execution-context layer with a safe
``agent_id``. The layer uses the current bound execution context to run
commands with ``HOME=/home/<agent_id>`` and a home-rooted workspace path. The
persisted runtime state intentionally keeps the historical
``~/workspace/<session>`` identity so existing session snapshots stay
compatible while live command execution no longer depends on the sandbox user's
ambient home directory. Entering or re-entering the layer re-ensures the live
home/workspace directories for the currently bound ``agent_id`` before user
commands are sent.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Sequence
from contextlib import asynccontextmanager
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import ClassVar, Literal, NotRequired, Protocol, TypedDict, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, field_validator, model_validator
from pydantic_ai import Tool
from typing_extensions import Self, override

from agenton.layers import (
    EmptyLayerConfig,
    EmptyRuntimeState,
    LayerDeps,
    NoLayerDeps,
    PlainLayer,
    PydanticAILayer,
    PydanticAIPrompt,
    PydanticAITool,
)
from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
    ShellPromptObservation,
    ShellProviderProtocol,
    ShellResourceProtocol,
)
from dify_agent.agent_stub.server.shell_agent_stub_env import ShellAgentStubTokenFactory, build_shell_agent_stub_env
from dify_agent.layers.shell.configs import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.shell.output_text import normalized_output_text, utf8_prefix, utf8_suffix

try:
    from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
except ModuleNotFoundError:

    class DifyExecutionContextLayer(PlainLayer[NoLayerDeps, EmptyLayerConfig, EmptyRuntimeState]):
        """Minimal fallback for shell-only imports without server extras installed."""


logger = logging.getLogger(__name__)


@runtime_checkable
class _HasErrorCode(Protocol):
    code: object

DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_WORKSPACE_ROOT = "~/workspace"
_WORKSPACE_DIR_NAME = "workspace"
_WORKSPACE_COLLISION_EXIT_CODE = 17
_SESSION_TIME_HEX_MASK = 0xFFFFF
_SESSION_RANDOM_HEX_LENGTH = 2
_SESSION_ID_ATTEMPT_LIMIT = 256
_SESSION_ID_PATTERN = re.compile(r"^[0-9a-f]{7}$")
_AGENT_HOME_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
_SHELL_OUTPUT_PROMPT_EDGE_BYTES = 8 * 1024
_SHELLCTL_OUTPUT_LIMIT_BYTES = 2 * _SHELL_OUTPUT_PROMPT_EDGE_BYTES
_REMOTE_COMPLETE_OUTPUT_MAX_BYTES = 1024 * 1024
_REMOTE_COMMAND_TIMEOUT_SECONDS = 60.0
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

Workspace persistence rules:

- The current workspace cwd is stable during this agent run, but it is temporary and may be deleted later.
- Do not use the current workspace cwd as persistent storage.
- $HOME outside the current workspace cwd is persistent storage. In build draft mode, when Agent config context reports
  `config_version.kind` as `build_draft` and `config_version.writable` as true, changes there can be persisted for
  later runs. In non-build-draft modes, those changes are rolled back.
- Saving config files, skills, env, or notes still requires the corresponding Agent config CLI mutation command; follow
  the Agent config CLI help in the config layer. Shell file edits alone do not save config.

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


class ShellToolErrorObservation(TypedDict):
    error: str
    job_id: NotRequired[str]


type ShellRunToolResult = str | ShellToolErrorObservation
type ShellInterruptToolResult = str | ShellToolErrorObservation


class DifyShellLayerDeps(LayerDeps):
    execution_context: DifyExecutionContextLayer | None  # pyright: ignore[reportUninitializedInstanceVariable]


class DifyShellRuntimeState(BaseModel):
    session_id: str | None = None
    workspace_cwd: str | None = None
    job_ids: list[str] = Field(default_factory=list)
    job_offsets: dict[str, NonNegativeInt] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _validated_session_id(value)

    @field_validator("job_ids")
    @classmethod
    def validate_job_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("job_ids must not contain duplicates.")
        return value

    @model_validator(mode="after")
    def validate_workspace_and_offsets(self) -> Self:
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


CompleteRemoteCommandResult = CompleteShellCommandResult


@dataclass(slots=True)
class DifyShellLayer(PydanticAILayer[DifyShellLayerDeps, object, DifyShellLayerConfig, DifyShellRuntimeState]):
    type_id: ClassVar[str | None] = DIFY_SHELL_LAYER_TYPE_ID

    config: DifyShellLayerConfig
    shell_provider: ShellProviderProtocol
    agent_stub_api_base_url: str | None = None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None
    _shell_resource: ShellResourceProtocol | None = None

    @classmethod
    @override
    def from_config(cls, config: DifyShellLayerConfig) -> Self:
        del config
        raise TypeError("DifyShellLayer requires a shell provider and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyShellLayerConfig,
        *,
        shell_provider: ShellProviderProtocol | None,
        agent_stub_api_base_url: str | None = None,
        agent_stub_token_factory: ShellAgentStubTokenFactory | None = None,
    ) -> Self:
        if shell_provider is None:
            raise ValueError("DifyShellLayer requires a non-null shell provider when the 'dify.shell' layer is used.")
        layer = cls(
            config=config,
            shell_provider=shell_provider,
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
        if self._shell_resource is not None:
            raise RuntimeError("DifyShellLayer resource_context() is already active for this layer instance.")
        resource = await self.shell_provider.create()
        self._shell_resource = resource
        try:
            yield
        finally:
            self._shell_resource = None
            await resource.close()

    @override
    async def on_context_create(self) -> None:
        _ = self._require_resource()
        session_id: str | None = None
        try:
            session_id, workspace_cwd = await self._allocate_workspace()
            await self._bootstrap_workspace(session_id)
        except BaseException:
            if session_id is not None:
                await self._cleanup_workspace_best_effort(session_id)
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
        _ = self._require_resource()
        session_id, _workspace_cwd = self._require_session_identity()
        await self._ensure_live_workspace_exists(session_id)

    @override
    async def on_context_suspend(self) -> None:
        _ = self._require_resource()

    @override
    async def on_context_delete(self) -> None:
        _ = self._require_resource()
        identity = self._try_session_identity()
        if identity is not None:
            session_id, _workspace_cwd = identity
            result = await self._run_internal_script_complete(
                _workspace_cleanup_script(session_id=session_id), cwd=None
            )
            if result.exit_code != 0 or not result.output_complete:
                logger.warning(
                    "Shell workspace cleanup for session %s ended with status=%s exit_code=%s output_complete=%s.",
                    session_id,
                    result.status,
                    result.exit_code,
                    result.output_complete,
                )
        await self._delete_tracked_jobs_best_effort(self.runtime_state.job_ids)
        self._clear_tracked_jobs()

    async def _tool_run(self, script: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        try:
            result = await self._require_resource().commands.run(
                _wrap_user_script(script, self.config),
                cwd=self._require_workspace_cwd(),
                env=self._build_shell_command_env(include_agent_stub_env=True),
                timeout=timeout,
            )
            observation = await render_prompt_observation_from_result(
                self._require_resource().commands,
                result,
                edge_bytes=_SHELL_OUTPUT_PROMPT_EDGE_BYTES,
            )
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, observation.offset)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                observation.text,
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc)
        except Exception as exc:
            return _tool_unexpected_error("shell_run", exc, session_id=self.runtime_state.session_id)

    async def _tool_wait(self, job_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        try:
            offset = self._tracked_offset(job_id)
            result = await self._require_resource().commands.wait(job_id, offset=offset, timeout=timeout)
            observation = await render_prompt_observation_from_result(
                self._require_resource().commands,
                result,
                edge_bytes=_SHELL_OUTPUT_PROMPT_EDGE_BYTES,
            )
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, observation.offset)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                observation.text,
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error("shell_wait", exc, session_id=self.runtime_state.session_id, job_id=job_id)

    async def _tool_input(self, job_id: str, text: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        try:
            offset = self._tracked_offset(job_id)
            result = await self._require_resource().commands.input(job_id, text, offset=offset, timeout=timeout)
            observation = await render_prompt_observation_from_result(
                self._require_resource().commands,
                result,
                edge_bytes=_SHELL_OUTPUT_PROMPT_EDGE_BYTES,
            )
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, observation.offset)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                observation.text,
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error("shell_input", exc, session_id=self.runtime_state.session_id, job_id=job_id)

    async def _tool_interrupt(
        self,
        job_id: str,
        grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS,
    ) -> ShellInterruptToolResult:
        try:
            self._ensure_tracked_job(job_id)
            result = await self._require_resource().commands.interrupt(job_id, grace_seconds=grace_seconds)
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, result.offset)
            output_path: str | None = None
            try:
                # Once the interrupt itself succeeds, resolving the output path is
                # best-effort metadata enrichment and must not turn the interrupt
                # into a failed tool result.
                output_path = (await self._require_resource().commands.tail(job_id)).output_path
            except (RuntimeError, ValueError) as exc:
                logger.warning(
                    "Failed to fetch output path for interrupted shell job %s in session %s: %s",
                    job_id,
                    self.runtime_state.session_id,
                    exc,
                )
            except Exception:
                logger.exception(
                    "Failed to fetch output path for interrupted shell job %s in session %s",
                    job_id,
                    self.runtime_state.session_id,
                )
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=output_path,
                ),
                "Job was interrupted.",
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error(
                "shell_interrupt", exc, session_id=self.runtime_state.session_id, job_id=job_id
            )

    async def run_remote_script_complete(
        self,
        script: str,
        *,
        timeout: float = _REMOTE_COMMAND_TIMEOUT_SECONDS,
        max_output_bytes: int = _REMOTE_COMPLETE_OUTPUT_MAX_BYTES,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        return await execute_complete_with_commands(
            self._require_resource().commands,
            script,
            cwd=self._require_workspace_cwd(),
            env=self._build_shell_command_env(
                include_agent_stub_env=inject_agent_stub_env,
                require_agent_stub_env=inject_agent_stub_env,
            ),
            timeout=timeout,
            max_output_bytes=max_output_bytes,
        )

    async def run_remote_script(
        self,
        script: str,
        *,
        timeout: float = _REMOTE_COMMAND_TIMEOUT_SECONDS,
        inject_agent_stub_env: bool = False,
    ) -> CompleteRemoteCommandResult:
        return await self.run_remote_script_complete(
            script,
            timeout=timeout,
            inject_agent_stub_env=inject_agent_stub_env,
        )

    async def _allocate_workspace(self) -> tuple[str, str]:
        for _attempt in range(_SESSION_ID_ATTEMPT_LIMIT):
            session_id = _generate_session_id()
            result = await self._run_internal_script_complete(_workspace_mkdir_script(session_id=session_id), cwd=None)
            if result.exit_code == _WORKSPACE_COLLISION_EXIT_CODE:
                continue
            if result.exit_code != 0 or not result.output_complete:
                raise RuntimeError(
                    f"Failed to create shell workspace {_workspace_cwd(session_id)}: "
                    + f"{result.status} exit_code={result.exit_code}"
                )
            return session_id, _workspace_cwd(session_id)
        raise RuntimeError("Failed to allocate a unique shell workspace session id after 256 attempts.")

    async def _bootstrap_workspace(self, session_id: str) -> None:
        bootstrap_script = _workspace_bootstrap_script(self.config)
        if not bootstrap_script:
            return
        workspace_cwd = _workspace_cwd_for_home(self._shell_home_dir(), session_id)
        result = await self._run_internal_script_complete(bootstrap_script, cwd=workspace_cwd)
        if result.exit_code != 0 or not result.output_complete:
            raise RuntimeError(
                f"Failed to bootstrap shell workspace {workspace_cwd}: {result.status} exit_code={result.exit_code}"
            )

    async def _cleanup_workspace_best_effort(self, session_id: str) -> None:
        try:
            _ = await self._run_internal_script_complete(_workspace_cleanup_script(session_id=session_id), cwd=None)
        except (RuntimeError, ValueError) as exc:
            logger.warning("Failed to remove shell workspace for session %s after create failure: %s", session_id, exc)

    async def _ensure_live_workspace_exists(self, session_id: str) -> None:
        result = await self._run_internal_script_complete(_workspace_ensure_script(session_id=session_id), cwd=None)
        if result.exit_code != 0 or not result.output_complete:
            raise RuntimeError(
                f"Failed to ensure shell workspace {_workspace_cwd_for_home(self._shell_home_dir(), session_id)} "
                + f"exists: {result.status} exit_code={result.exit_code}"
            )

    async def _run_internal_script_complete(
        self,
        script: str,
        *,
        cwd: str | None,
    ) -> CompleteRemoteCommandResult:
        return await execute_complete_with_commands(
            self._require_resource().commands,
            script,
            cwd=cwd,
            env=self._build_shell_command_env(include_agent_stub_env=False),
            timeout=DEFAULT_TIMEOUT_SECONDS,
            max_output_bytes=_REMOTE_COMPLETE_OUTPUT_MAX_BYTES,
        )

    def _require_resource(self) -> ShellResourceProtocol:
        if self._shell_resource is None:
            raise RuntimeError(
                "DifyShellLayer requires an active shell resource inside resource_context(); "
                + "enter the layer through Agenton or wrap direct hook/tool usage in resource_context()."
            )
        return self._shell_resource

    def _require_workspace_cwd(self) -> str:
        session_id, _workspace_cwd = self._require_session_identity()
        return _workspace_cwd_for_home(self._shell_home_dir(), session_id)

    def _require_session_identity(self) -> tuple[str, str]:
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
        if job_id not in self.runtime_state.job_ids:
            raise ValueError(f"Unknown shell job id for this session: {job_id}.")

    def _tracked_offset(self, job_id: str) -> int:
        self._ensure_tracked_job(job_id)
        return int(self.runtime_state.job_offsets.get(job_id, 0))

    def _remember_job_id(self, job_id: str) -> None:
        if job_id in self.runtime_state.job_ids:
            return
        self.runtime_state.job_ids = [*self.runtime_state.job_ids, job_id]

    def _remember_job_offset(self, job_id: str, offset: int) -> None:
        job_offsets = dict(self.runtime_state.job_offsets)
        job_offsets[job_id] = offset
        self.runtime_state.job_offsets = job_offsets

    async def _delete_tracked_jobs_best_effort(self, job_ids: Sequence[str]) -> None:
        commands = self._require_resource().commands
        for job_id in _deduplicate_preserving_order(job_ids):
            try:
                await commands.delete(job_id, force=True)
            except RuntimeError as exc:
                logger.warning(
                    "Failed to delete shell job %s for session %s: %s",
                    job_id,
                    self.runtime_state.session_id,
                    exc,
                )

    def _clear_tracked_jobs(self) -> None:
        self.runtime_state.job_offsets = {}
        self.runtime_state.job_ids = []

    def _shell_home_dir(self) -> str:
        return _shell_home_dir_for_agent_id(self._require_current_execution_agent_id())

    def _current_execution_agent_id(self) -> str | None:
        execution_context_layer = self.deps.execution_context
        execution_context = execution_context_layer.config if execution_context_layer is not None else None
        return execution_context.agent_id if execution_context is not None else None

    def _require_current_execution_agent_id(self) -> str:
        agent_id = self._current_execution_agent_id()
        if agent_id is None:
            raise ValueError("ShellLayer command execution requires execution_context.agent_id.")
        return _validated_agent_home_segment(agent_id)

    def _build_shell_command_env(
        self,
        *,
        include_agent_stub_env: bool,
        require_agent_stub_env: bool = False,
    ) -> dict[str, str]:
        env = {"HOME": self._shell_home_dir()}
        if not include_agent_stub_env:
            return env
        execution_context_layer = self.deps.execution_context
        execution_context = execution_context_layer.config if execution_context_layer is not None else None
        agent_stub_env = build_shell_agent_stub_env(
            agent_stub_api_base_url=self.agent_stub_api_base_url,
            agent_stub_drive_ref=self.config.agent_stub_drive_ref,
            execution_context=execution_context,
            token_factory=self.agent_stub_token_factory,
            session_id=self.runtime_state.session_id,
        )
        if agent_stub_env is None:
            if not require_agent_stub_env:
                return env
            raise RuntimeError("Agent Stub environment injection is not available for this shell session.")
        env.update(agent_stub_env)
        return env


async def execute_complete_with_commands(
    commands: ShellCommandProtocol,
    script: str,
    *,
    cwd: str | None,
    env: dict[str, str] | None,
    timeout: float,
    max_output_bytes: int,
) -> CompleteShellCommandResult:
    deadline = time.monotonic() + timeout
    job_id: str | None = None
    result: ShellCommandResult | None = None
    output_parts: list[str] = []
    captured_bytes = 0
    incomplete_reason: Literal["output_limit", "timeout"] | None = None
    try:
        result = await commands.run(script, cwd=cwd, env=env, timeout=_remaining_time(deadline))
        job_id = result.job_id
        while True:
            remaining_bytes = max(max_output_bytes - captured_bytes, 0)
            limited_output = utf8_prefix(result.output, remaining_bytes)
            output_parts.append(limited_output)
            captured_bytes += len(limited_output.encode("utf-8"))
            if limited_output != result.output:
                incomplete_reason = "output_limit"
                break
            if captured_bytes >= max_output_bytes and (result.truncated or not result.done):
                incomplete_reason = "output_limit"
                break
            if result.truncated:
                result = await commands.read_output(result.job_id, offset=result.offset)
                continue
            if result.done:
                break
            remaining_time = _remaining_time(deadline)
            if remaining_time <= 0.0:
                incomplete_reason = "timeout"
                break
            result = await commands.wait(result.job_id, offset=result.offset, timeout=remaining_time)

        assert result is not None
        final_status = result.status
        final_done = result.done
        final_exit_code = result.exit_code
        final_offset = result.offset
        final_output_path = result.output_path
        if incomplete_reason is not None and not result.done:
            terminal_status = await commands.interrupt(result.job_id, grace_seconds=DEFAULT_TERMINATE_GRACE_SECONDS)
            final_status = terminal_status.status
            final_done = terminal_status.done
            final_exit_code = terminal_status.exit_code
            final_offset = terminal_status.offset
        return CompleteShellCommandResult(
            job_id=result.job_id,
            status=final_status,
            done=final_done,
            exit_code=final_exit_code,
            output="".join(output_parts),
            output_complete=incomplete_reason is None,
            incomplete_reason=incomplete_reason,
            offset=final_offset,
            output_path=final_output_path,
        )
    finally:
        if job_id is not None:
            try:
                await commands.delete(job_id, force=True)
            except RuntimeError as exc:
                logger.warning("Failed to delete transient shell job %s: %s", job_id, exc)


async def render_prompt_observation_from_result(
    commands: ShellCommandProtocol,
    result: ShellCommandResult,
    *,
    edge_bytes: int,
) -> ShellPromptObservation:
    output_exceeds_edge_budget = len(result.output.encode("utf-8")) > edge_bytes
    tail: str | None = None
    output_path = result.output_path
    offset = result.offset
    if result.truncated:
        try:
            tail_result = await commands.tail(result.job_id)
        except RuntimeError as exc:
            logger.warning("Failed to fetch tail for shell job %s: %s", result.job_id, exc)
        else:
            tail = utf8_suffix(tail_result.output, edge_bytes)
            output_path = tail_result.output_path or output_path
            offset = tail_result.offset
    elif output_exceeds_edge_budget:
        tail = utf8_suffix(result.output, edge_bytes)
    text = normalized_output_text(
        utf8_prefix(result.output, edge_bytes),
        tail=tail,
        output_path=output_path if (result.truncated or output_exceeds_edge_budget) else None,
        max_output_size_bytes=_SHELLCTL_OUTPUT_LIMIT_BYTES,
        truncated_in_middle=result.truncated or output_exceeds_edge_budget,
    )
    return ShellPromptObservation(text=text, output_path=output_path, offset=offset)


def _shell_layer_prefix_prompt() -> str:
    return _SHELL_LAYER_PREFIX_PROMPT


def _metadata_dict(
    *,
    job_id: str,
    status: str,
    done: bool,
    exit_code: int | None,
    output_path: str | None,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        "job_id": job_id,
        "status": status,
        "done": done,
        "exit_code": exit_code,
    }
    if output_path is not None:
        metadata["output_path"] = output_path
    return metadata


def _tool_error(message: str, *, job_id: str | None = None) -> ShellToolErrorObservation:
    result: ShellToolErrorObservation = {"error": message}
    if job_id is not None:
        result["job_id"] = job_id
    return result


def _tool_error_from_exception(exc: Exception, *, job_id: str | None = None) -> ShellToolErrorObservation:
    # Expected provider/runtime failures stay inside the tool contract and are
    # returned to the model as observations. The broader Exception fallback
    # below handles unexpected failures; BaseException, including cancellation,
    # is intentionally left uncaught at the tool boundary.
    if isinstance(exc, _HasErrorCode) and isinstance(exc.code, str) and exc.code:
        return _tool_error(f"{exc.code}: {exc}", job_id=job_id)
    return _tool_error(str(exc), job_id=job_id)


def _tool_unexpected_error(
    tool_name: str,
    exc: Exception,
    *,
    session_id: str | None,
    job_id: str | None = None,
) -> ShellToolErrorObservation:
    # Unexpected Exception still becomes a tool observation so one shell tool
    # failure does not abort the agent loop, but it is logged with traceback for
    # debugging. BaseException is intentionally not caught by callers.
    logger.exception(
        "Unexpected shell tool failure: tool=%s session_id=%s job_id=%s",
        tool_name,
        session_id,
        job_id,
    )
    return _tool_error_from_exception(exc, job_id=job_id)


def _generate_session_id() -> str:
    time_component = int(time.time()) & _SESSION_TIME_HEX_MASK
    random_component = secrets.token_hex(1)
    if len(random_component) != _SESSION_RANDOM_HEX_LENGTH:
        raise RuntimeError("Expected a one-byte random hex suffix for Dify shell session ids.")
    return f"{time_component:05x}{random_component}"


def _workspace_cwd(session_id: str) -> str:
    return f"{_WORKSPACE_ROOT}/{_validated_session_id(session_id)}"


def _shell_home_dir_for_agent_id(agent_id: str | None) -> str:
    if agent_id is None:
        raise ValueError("ShellLayer command execution requires execution_context.agent_id.")
    return f"/home/{_validated_agent_home_segment(agent_id)}"


def _validated_agent_home_segment(agent_id: str) -> str:
    if agent_id in {".", ".."} or not _AGENT_HOME_SEGMENT_PATTERN.fullmatch(agent_id):
        raise ValueError("execution_context.agent_id must be a safe single path segment for shell HOME.")
    return agent_id


def _workspace_cwd_for_home(home_dir: str, session_id: str) -> str:
    return f"{home_dir}/{_WORKSPACE_DIR_NAME}/{_validated_session_id(session_id)}"


def _workspace_bootstrap_script(config: DifyShellLayerConfig) -> str:
    install_commands = [command for tool in config.cli_tools for command in tool.install_commands]
    if not install_commands:
        return ""
    lines: list[str] = ["set -eu", *_shell_config_export_lines(config), *install_commands]
    return "\n".join(lines)


def _shell_config_export_lines(config: DifyShellLayerConfig) -> list[str]:
    lines: list[str] = []
    for env_var in config.env:
        lines.append(f"export {env_var.name}={_shquote(env_var.value)}")
    for secret_ref in config.secret_refs:
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
    lines = _shell_config_export_lines(config)
    if not lines:
        return script
    return "\n".join([*lines, script])


def _workspace_mkdir_script(*, session_id: str) -> str:
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


def _workspace_ensure_script(*, session_id: str) -> str:
    return f'mkdir -p "$HOME/workspace/{_validated_session_id(session_id)}"'


def _shquote(value: str) -> str:
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


def _tagged_shell_observation(metadata: dict[str, object], output: str) -> str:
    compact_metadata = json.dumps(metadata, separators=(",", ":"))
    return f"<metadata>\n{compact_metadata}\n</metadata>\n\n<output>\n{output}\n</output>"


def _remaining_time(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())


__all__ = [
    "CompleteRemoteCommandResult",
    "DifyShellLayer",
    "DifyShellLayerDeps",
    "DifyShellRuntimeState",
    "DEFAULT_TERMINATE_GRACE_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "execute_complete_with_commands",
    "render_prompt_observation_from_result",
]
