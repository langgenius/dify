"""Shell tools over the data plane exposed by the active Sandbox layer."""

from __future__ import annotations

from collections.abc import Sequence
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import ClassVar, Literal, NotRequired, Protocol, TypedDict, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, field_validator, model_validator
from pydantic_ai import Tool
from typing_extensions import Self, override

from agenton.layers import (
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
)
from dify_agent.agent_stub.protocol import AGENT_STUB_AUTH_JWE_ENV_VAR
from dify_agent.agent_stub.shell_env import ShellAgentStubTokenFactory, build_shell_agent_stub_env
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.sandbox.layer import DifySandboxLayer
from dify_agent.layers.shell.configs import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.layers.shell.output_text import normalized_output_text, utf8_prefix, utf8_suffix
from dify_agent.runtime_backend import SandboxLease


logger = logging.getLogger(__name__)


@runtime_checkable
class _HasErrorCode(Protocol):
    code: object


DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_SHELL_OUTPUT_PROMPT_EDGE_BYTES = 8 * 1024
_SHELLCTL_OUTPUT_LIMIT_BYTES = 2 * _SHELL_OUTPUT_PROMPT_EDGE_BYTES
_REMOTE_COMPLETE_OUTPUT_MAX_BYTES = 1024 * 1024
_REMOTE_COMMAND_TIMEOUT_SECONDS = 60.0
_SHELL_LAYER_PREFIX_PROMPT = """You can run commands in an isolated shell workspace.

Available shell tools:

1. shell_run
   Starts a new shell job in the current workspace.
   Use it to run commands or scripts.

2. shell_wait
   Waits for more output or completion from an existing shell job.
   Use it when shell_run returns done=false.

3. shell_input
   Sends stdin text to a running shell job, then waits for new output.
   Use it only when an interactive command is waiting for input.

4. shell_interrupt
   Interrupts a running shell job.
   Use it to stop a long-running, stuck, or no-longer-needed command.

Common arguments:

- script:
  Command or script to execute. Used by shell_run.

- job_id:
  Shell job id returned by shell_run.
  Use it with shell_wait, shell_input, and shell_interrupt.
  Never invent a job_id.

- timeout:
  Maximum time in seconds to wait for output or completion for this tool call.
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

Installed CLI:

- `dify-agent` is already installed in this shell environment and can be used directly.
- Use the generated `dify-agent ... --help` output in the config prompt for exact command syntax.
- Do not install or recreate the `dify-agent` CLI.

Workspace persistence rules:

- The current workspace cwd is stable during this run, but it is temporary and may be deleted later.
- Do not treat files in the current workspace cwd as persisted state.
- In build mode, config changes persist only after you run the matching `dify-agent config ...` mutation command.
- Shell file edits alone do not save Agent config files, skills, env, or notes.
- In non-build modes, local shell changes are not a persistence mechanism for Agent configuration.

shell_run script rules:

- The script argument can be a normal shell script or a shebang script.
- If the first line is a shebang, the shell executes the script directly.

Tips:

- Python 3.12, uv, pip, Node.js, pnpm, and pnx are preinstalled in the local sandbox.
- For one-off Python dependencies, prefer a uv script with a PEP 723 dependency header or:
  `uv run --with <package> python <script-or--c>`.
- For reusable Python CLI tools, use `uv tool install <tool>`; installed commands land in `$HOME/.local/bin`.
  Run them by full path or add `$HOME/.local/bin` to PATH in the command that needs them.
- `python3 -m pip install --user <package>` also installs into `$HOME/.local`; add `$HOME/.local/bin` to PATH
  when you need console scripts.
- For reusable Node.js CLIs, use user-level global installs:
  `PNPM_HOME=$HOME/.local/share/pnpm PATH=$HOME/.local/share/pnpm/bin:$PATH pnpm add -g <package>`.
  Installed commands land in `$PNPM_HOME/bin`; run them by full path or with the same PATH prefix.
- For one-off Node.js CLIs, prefer `pnx <command> [args]`.
- Do not install new packages into system or image tool paths such as `/usr/local`, `/usr`, or `/opt/dify-agent-tools`.
- If you need MCP, install the MCP server in the shell environment and start that server when you use it.

Example shell_run script:

[begin script]
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
print(f"[green]status:[/green] {response.status_code}")
[end script]"""
_SHELL_LAYER_SUFFIX_PROMPT = """Environment variables may contain API keys, tokens, or credentials.
You may refer to environment variable names when needed."""


class ShellToolErrorObservation(TypedDict):
    error: str
    job_id: NotRequired[str]


type ShellRunToolResult = str | ShellToolErrorObservation
type ShellInterruptToolResult = str | ShellToolErrorObservation


class DifyShellLayerDeps(LayerDeps):
    execution_context: PlainLayer[NoLayerDeps, DifyExecutionContextLayerConfig, EmptyRuntimeState] | None  # pyright: ignore[reportUninitializedInstanceVariable]
    sandbox: DifySandboxLayer  # pyright: ignore[reportUninitializedInstanceVariable]


class DifyShellRuntimeState(BaseModel):
    job_ids: list[str] = Field(default_factory=list)
    job_offsets: dict[str, NonNegativeInt] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)

    @field_validator("job_ids")
    @classmethod
    def validate_job_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("job_ids must not contain duplicates.")
        return value

    @model_validator(mode="after")
    def validate_job_offsets(self) -> Self:
        unknown_offset_job_ids = set(self.job_offsets) - set(self.job_ids)
        if unknown_offset_job_ids:
            names = ", ".join(sorted(unknown_offset_job_ids))
            raise ValueError(f"job_offsets contains unknown job ids: {names}.")
        return self


CompleteRemoteCommandResult = CompleteShellCommandResult


@dataclass(slots=True)
class DifyShellLayer(PydanticAILayer[DifyShellLayerDeps, object, DifyShellLayerConfig, DifyShellRuntimeState]):
    """Expose Shell tools over the active Sandbox lease without owning it.

    Create optionally bootstraps configured CLI tools in the lease's Workspace.
    Suspend and delete best-effort remove tracked shellctl jobs, then clear job
    ids and offsets so they do not persist across requests. Commands, files,
    Home, and cwd come only from ``DifySandboxLayer.lease``; Sandbox
    create/resume/suspend/delete remain exclusively owned by that layer.
    """

    type_id: ClassVar[str | None] = DIFY_SHELL_LAYER_TYPE_ID

    config: DifyShellLayerConfig
    shell_redact_patterns: list[str] = field(default_factory=list)
    agent_stub_api_base_url: str | None = None
    agent_stub_token_factory: ShellAgentStubTokenFactory | None = None

    @classmethod
    @override
    def from_config(cls, config: DifyShellLayerConfig) -> Self:
        del config
        raise TypeError("DifyShellLayer requires server-injected settings and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyShellLayerConfig,
        *,
        shell_redact_patterns: list[str] | None = None,
        agent_stub_api_base_url: str | None = None,
        agent_stub_token_factory: ShellAgentStubTokenFactory | None = None,
    ) -> Self:
        return cls(
            config=config,
            shell_redact_patterns=shell_redact_patterns or [],
            agent_stub_api_base_url=agent_stub_api_base_url,
            agent_stub_token_factory=agent_stub_token_factory,
        )

    @property
    @override
    def prefix_prompts(self) -> Sequence[PydanticAIPrompt[object]]:
        return [_shell_layer_prefix_prompt]

    @property
    @override
    def suffix_prompts(self) -> Sequence[PydanticAIPrompt[object]]:
        return [_shell_layer_suffix_prompt]

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
    async def on_context_create(self) -> None:
        bootstrap_script = _workspace_bootstrap_script(self.config)
        if not bootstrap_script:
            return
        result = await self._run_internal_script_complete(bootstrap_script, cwd=self._require_workspace_cwd())
        if result.exit_code != 0 or not result.output_complete:
            raise RuntimeError(
                f"Failed to bootstrap shell workspace {self._require_workspace_cwd()}: "
                f"{result.status} exit_code={result.exit_code}"
            )

    @override
    async def on_context_resume(self) -> None:
        _ = self._require_resource()

    @override
    async def on_context_suspend(self) -> None:
        await self._delete_tracked_jobs_best_effort(self.runtime_state.job_ids)
        self._clear_tracked_jobs()

    @override
    async def on_context_delete(self) -> None:
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
                self._redact_output(observation.text),
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc)
        except Exception as exc:
            return _tool_unexpected_error("shell_run", exc)

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
                self._redact_output(observation.text),
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error("shell_wait", exc, job_id=job_id)

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
                self._redact_output(observation.text),
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error("shell_input", exc, job_id=job_id)

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
                    "Failed to fetch output path for interrupted shell job %s: %s",
                    job_id,
                    exc,
                )
            except Exception:
                logger.exception(
                    "Failed to fetch output path for interrupted shell job %s",
                    job_id,
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
            return _tool_unexpected_error("shell_interrupt", exc, job_id=job_id)

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

    def _require_resource(self) -> SandboxLease:
        return self.deps.sandbox.lease

    def _require_workspace_cwd(self) -> str:
        return self._require_resource().layout.workspace_dir

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
                    "Failed to delete shell job %s: %s",
                    job_id,
                    exc,
                )

    def _clear_tracked_jobs(self) -> None:
        self.runtime_state.job_offsets = {}
        self.runtime_state.job_ids = []

    def _build_shell_command_env(
        self,
        *,
        include_agent_stub_env: bool,
        require_agent_stub_env: bool = False,
    ) -> dict[str, str]:
        env = _shell_config_env(self.config)
        env["HOME"] = self._require_resource().layout.home_dir
        if not include_agent_stub_env:
            return env
        execution_context_layer = self.deps.execution_context
        execution_context = execution_context_layer.config if execution_context_layer is not None else None
        agent_stub_env = build_shell_agent_stub_env(
            agent_stub_api_base_url=self.agent_stub_api_base_url,
            agent_stub_drive_ref=self.config.agent_stub_drive_ref,
            execution_context=execution_context,
            token_factory=self.agent_stub_token_factory,
            session_id=None,
        )
        if agent_stub_env is None:
            if not require_agent_stub_env:
                return env
            raise RuntimeError("Agent Stub environment injection is not available for this shell session.")
        env.update(agent_stub_env)
        return env

    def _redact_output(self, text: str) -> str:
        """Redact sensitive content from shell output before the model sees it.

        Two layers of redaction are applied:

        1. **Built-in token redaction** — the actual Agent Stub JWE token value
           is always replaced with ``***``. This is unconditional and cannot be
           disabled.
        2. **Pattern redaction** — regex patterns from both server-level
           ``shell_redact_patterns`` and per-agent ``config.redact_patterns``
           are applied via ``re.sub`` to mask additional secrets.
        """
        if not text:
            return text
        # Built-in: always redact the JWE token value.
        env = self._build_shell_command_env(include_agent_stub_env=True)
        jwe_value = env.get(AGENT_STUB_AUTH_JWE_ENV_VAR)
        if jwe_value and len(jwe_value) > 8:
            text = text.replace(jwe_value, "***")
        # Server-level + per-agent regex patterns.
        for pattern in (*self.shell_redact_patterns, *self.config.redact_patterns):
            text = re.sub(pattern, "***", text)
        return text


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


def _shell_layer_suffix_prompt() -> str:
    return _SHELL_LAYER_SUFFIX_PROMPT


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
    job_id: str | None = None,
) -> ShellToolErrorObservation:
    # Unexpected Exception still becomes a tool observation so one shell tool
    # failure does not abort the agent loop, but it is logged with traceback for
    # debugging. BaseException is intentionally not caught by callers.
    logger.exception(
        "Unexpected shell tool failure: tool=%s job_id=%s",
        tool_name,
        job_id,
    )
    return _tool_error_from_exception(exc, job_id=job_id)


def _workspace_bootstrap_script(config: DifyShellLayerConfig) -> str:
    install_commands = [command for tool in config.cli_tools for command in tool.install_commands]
    if not install_commands:
        return ""
    lines: list[str] = ["set -eu", *_shell_config_export_lines(config), *install_commands]
    return "\n".join(lines)


def _shell_config_export_lines(config: DifyShellLayerConfig) -> list[str]:
    lines: list[str] = []
    # Plain env values travel through ShellCommandProtocol.run(env=...) so inline
    # secrets are not rendered into generated shell scripts.
    for secret_ref in config.secret_refs:
        lines.append(f'export {secret_ref.name}="${{{secret_ref.name}:-}}"')
    for tool in config.cli_tools:
        for secret_ref in tool.secret_refs:
            lines.append(f'export {secret_ref.name}="${{{secret_ref.name}:-}}"')
    return lines


def _shell_config_env(config: DifyShellLayerConfig) -> dict[str, str]:
    env: dict[str, str] = {}
    for env_var in config.env:
        env[env_var.name] = env_var.value
    for tool in config.cli_tools:
        for env_var in tool.env:
            env[env_var.name] = env_var.value
    return env


def _wrap_user_script(script: str, config: DifyShellLayerConfig) -> str:
    lines = _shell_config_export_lines(config)
    if not lines:
        return script
    return "\n".join([*lines, script])


def _shquote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


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
