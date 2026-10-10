"""Shell tools over the data plane exposed by the active Runtime layer."""

from __future__ import annotations

from collections.abc import Sequence
import json
import logging
import re
from dataclasses import dataclass, field
from typing import ClassVar, NotRequired, Protocol, TypedDict, override, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, field_validator, model_validator
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability, CapabilityOrdering
from pydantic_ai.capabilities.abstract import WrapRunHandler
from pydantic_ai.run import AgentRunResult
from pydantic_ai.toolsets import FunctionToolset
from typing_extensions import Self

from dify_agent.adapters.shell.protocols import (
    CompleteShellCommandResult,
    ShellCommandProtocol,
    ShellCommandResult,
    ShellPromptObservation,
)
from dify_agent.agent_stub.protocol import AGENT_STUB_AUTH_JWE_ENV_VAR
from dify_agent.agent_stub.shell_env import build_shell_agent_stub_env
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.runtime.layer import Capability as RuntimeCapability
from dify_agent.runtime.context import Deps
from dify_agent.layers.shell.configs import DifyShellLayerConfig
from dify_agent.layers.shell.output_text import normalized_output_text, utf8_prefix, utf8_suffix
from dify_agent.runtime.command_runner import execute_complete_with_commands
from dify_agent.runtime_backend import RuntimeLease


logger = logging.getLogger(__name__)


@runtime_checkable
class _HasErrorCode(Protocol):
    code: object


DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_TERMINATE_GRACE_SECONDS = 10.0
_SHELL_OUTPUT_PROMPT_EDGE_BYTES = 4 * 1024
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

Filesystem spaces:

- `$HOME` is the system space for reusable tools and state.
- The current working directory (`cwd`) is the active Workspace and temporary working space.
- Relative paths and the standard temp environment variables (`TMPDIR`, `TMP`, and `TEMP`) resolve directly to `cwd`.
- Do not use `/tmp`.

shell_run script rules:

- The script argument can be a normal shell script or a shebang script.
- If the first line is a shebang, the shell executes the script directly.

Tips:

- Python 3.13, uv, pip, Node.js, pnpm, and pnx are preinstalled in the local sandbox.
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
# requires-python = ">=3.13"
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
_BUILD_DRAFT_WORKING_LOCATION_PROMPT = """Working location:

- Prefer `$HOME` for work and changes intended for the system space.
- Use `cwd` for scratch files, intermediate results, and other temporary work."""
_DEFAULT_WORKING_LOCATION_PROMPT = """Working location:

- Prefer `cwd` for your work.
- Changes in `$HOME` or `cwd` do not update the saved Agent state."""
_SHELL_LAYER_SUFFIX_PROMPT = """Environment variables may contain API keys, tokens, or credentials.
You may refer to environment variable names when needed."""


class ShellToolErrorObservation(TypedDict):
    error: str
    job_id: NotRequired[str]


type ShellRunToolResult = str | ShellToolErrorObservation
type ShellInterruptToolResult = str | ShellToolErrorObservation


class Config(DifyShellLayerConfig):
    pass


class State(BaseModel):
    initialized: bool = False
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


class Capability(AbstractCapability[Deps]):
    """Own one ShellSession, bootstrap once and clean jobs on every outcome."""

    def __init__(self, name: str):
        self.id = name
        self.name = name

    @override
    def get_ordering(self) -> CapabilityOrdering:
        return CapabilityOrdering(wrapped_by=[RuntimeCapability], requires=[RuntimeCapability])

    @override
    def get_instructions(self):
        return self._instructions

    def _instructions(self, ctx: RunContext[Deps]) -> str:
        session = ctx.deps.resources.shells[self.name]
        return f"{session.build_prefix_prompt()}\n\n{_SHELL_LAYER_SUFFIX_PROMPT}"

    @override
    def get_toolset(self) -> FunctionToolset[Deps]:
        toolset = FunctionToolset[Deps](id=self.name, sequential=True)

        @toolset.tool(name="shell_run")
        async def shell_run(
            ctx: RunContext[Deps], script: str, timeout: float = DEFAULT_TIMEOUT_SECONDS
        ) -> ShellRunToolResult:
            """Start a shell job and return its output and status."""
            return await ctx.deps.resources.shells[self.name]._tool_run(script, timeout)

        @toolset.tool(name="shell_wait")
        async def shell_wait(
            ctx: RunContext[Deps], job_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS
        ) -> ShellRunToolResult:
            """Wait for output or completion from an existing shell job."""
            return await ctx.deps.resources.shells[self.name]._tool_wait(job_id, timeout)

        @toolset.tool(name="shell_input")
        async def shell_input(
            ctx: RunContext[Deps], job_id: str, text: str, timeout: float = DEFAULT_TIMEOUT_SECONDS
        ) -> ShellRunToolResult:
            """Send stdin to a shell job and wait for its next output."""
            return await ctx.deps.resources.shells[self.name]._tool_input(job_id, text, timeout)

        @toolset.tool(name="shell_interrupt")
        async def shell_interrupt(
            ctx: RunContext[Deps], job_id: str, grace_seconds: float = DEFAULT_TERMINATE_GRACE_SECONDS
        ) -> ShellInterruptToolResult:
            """Interrupt a running shell job and return its final status."""
            return await ctx.deps.resources.shells[self.name]._tool_interrupt(job_id, grace_seconds)

        return toolset

    @override
    async def wrap_run(self, ctx: RunContext[Deps], *, handler: WrapRunHandler) -> AgentRunResult:
        session = ShellSession(self.name, ctx.deps)
        ctx.deps.resources.shells[self.name] = session
        try:
            state = session.runtime_state
            if not state.initialized:
                script = _workspace_bootstrap_script(session.config)
                if script:
                    result = await session._run_internal_script_complete(script, cwd=session._require_workspace_cwd())
                    if result.exit_code != 0 or not result.output_complete:
                        raise RuntimeError(
                            f"Failed to bootstrap shell workspace: {result.status} exit_code={result.exit_code}"
                        )
                state.initialized = True
                session.save_state(state)
            return await handler()
        finally:
            try:
                await session._delete_tracked_jobs_best_effort(session.runtime_state.job_ids)
            finally:
                session._clear_tracked_jobs()
                del ctx.deps.resources.shells[self.name]


@dataclass(slots=True)
class ShellSession:
    """Run-scoped shell operations over borrowed lease and canonical JSON state.

    Capabilities and tools share this live command adapter, never copied Config
    or State models. Shell tools run sequentially because offsets and tokens
    share one session. Binding and Workspace retirement remain API-owned.
    """

    name: str
    deps: Deps
    _job_agent_stub_tokens: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    @property
    def config(self) -> Config:
        return Config.model_validate(self.deps.layers[self.name]["config"])

    @property
    def runtime_state(self) -> State:
        return State.model_validate(self.deps.layers[self.name]["state"])

    def save_state(self, state: State) -> None:
        self.deps.layers[self.name]["state"] = state.model_dump(mode="json")

    def build_prefix_prompt(self) -> str:
        context_name = self.config.execution_context
        context = (
            DifyExecutionContextLayerConfig.model_validate(self.deps.layers[context_name]["config"])
            if context_name
            else None
        )
        is_build_draft = context is not None and context.agent_config_version_kind == "build_draft"
        working = _BUILD_DRAFT_WORKING_LOCATION_PROMPT if is_build_draft else _DEFAULT_WORKING_LOCATION_PROMPT
        return f"{_SHELL_LAYER_PREFIX_PROMPT}\n\n{working}"

    async def _tool_run(self, script: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Start a shell job in the current workspace and return its output and status."""

        try:
            env = self._build_shell_command_env(include_agent_stub_env=True)
            agent_stub_token = env.get(AGENT_STUB_AUTH_JWE_ENV_VAR)
            result = await self._require_resource().commands.run(
                _wrap_user_script(script, self.config),
                cwd=self._require_workspace_cwd(),
                env=env,
                timeout=timeout,
            )
            # Register the remote job before observing output so cancellation during
            # a tail request still leaves cleanup with its job and redaction token.
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, 0)
            if agent_stub_token is not None and not result.done:
                self._job_agent_stub_tokens[result.job_id] = agent_stub_token
            observation = await render_prompt_observation_from_result(
                self._require_resource().commands,
                result,
                edge_bytes=_SHELL_OUTPUT_PROMPT_EDGE_BYTES,
            )
            self._remember_job_offset(result.job_id, observation.offset)
            if agent_stub_token is not None and not result.done:
                self._job_agent_stub_tokens[result.job_id] = agent_stub_token
            else:
                self._job_agent_stub_tokens.pop(result.job_id, None)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                self._redact_output(observation.text, sensitive_values=(agent_stub_token,)),
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc)
        except Exception as exc:
            return _tool_unexpected_error("shell_run", exc)

    async def _tool_wait(self, job_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Wait for more output or completion from an existing shell job."""

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
            redacted_output = self._redact_output(
                observation.text,
                sensitive_values=(self._job_agent_stub_tokens.get(job_id),),
            )
            if result.done:
                self._job_agent_stub_tokens.pop(job_id, None)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                redacted_output,
            )
        except (RuntimeError, ValueError) as exc:
            return _tool_error_from_exception(exc, job_id=job_id)
        except Exception as exc:
            return _tool_unexpected_error("shell_wait", exc, job_id=job_id)

    async def _tool_input(self, job_id: str, text: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> ShellRunToolResult:
        """Send text to a running shell job and wait for its next output."""

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
            redacted_output = self._redact_output(
                observation.text,
                sensitive_values=(self._job_agent_stub_tokens.get(job_id),),
            )
            if result.done:
                self._job_agent_stub_tokens.pop(job_id, None)
            return _tagged_shell_observation(
                _metadata_dict(
                    job_id=result.job_id,
                    status=result.status,
                    done=result.done,
                    exit_code=result.exit_code,
                    output_path=observation.output_path,
                ),
                redacted_output,
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
        """Interrupt a running shell job and return its final status."""

        try:
            self._ensure_tracked_job(job_id)
            result = await self._require_resource().commands.interrupt(job_id, grace_seconds=grace_seconds)
            self._remember_job_id(result.job_id)
            self._remember_job_offset(result.job_id, result.offset)
            self._job_agent_stub_tokens.pop(result.job_id, None)
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
            mode="stdio",
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
            mode="stdio",
        )

    def _require_resource(self) -> RuntimeLease:
        lease = self.deps.resources.leases.get(self.config.runtime)
        if lease is None:
            raise RuntimeError("Shell requires an active Runtime lease.")
        return lease

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
        state = self.runtime_state
        state.job_ids = [*state.job_ids, job_id]
        self.save_state(state)

    def _remember_job_offset(self, job_id: str, offset: int) -> None:
        state = self.runtime_state
        state.job_offsets = {**state.job_offsets, job_id: offset}
        self.save_state(state)

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
        state = self.runtime_state
        state.job_offsets = {}
        state.job_ids = []
        self.save_state(state)
        self._job_agent_stub_tokens.clear()

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
        context_name = self.config.execution_context
        execution_context = (
            DifyExecutionContextLayerConfig.model_validate(self.deps.layers[context_name]["config"])
            if context_name
            else None
        )
        agent_stub_env = build_shell_agent_stub_env(
            agent_stub_api_base_url=self.deps.services.agent_stub_api_base_url,
            execution_context=execution_context,
            token_factory=self.deps.services.agent_stub_token_factory,
            session_id=None,
        )
        if agent_stub_env is None:
            if not require_agent_stub_env:
                return env
            raise RuntimeError("Agent Stub environment injection is not available for this shell session.")
        env.update(agent_stub_env)
        return env

    def _redact_output(self, text: str, *, sensitive_values: Sequence[str | None] = ()) -> str:
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
        # Built-in: always redact actual sensitive values supplied by the
        # command owner. Redaction must never mint replacement credentials.
        for value in sensitive_values:
            if value and len(value) > 8:
                text = text.replace(value, "***")
        # Server-level + per-agent regex patterns.
        for pattern in (*self.deps.services.shell_redact_patterns, *self.config.redact_patterns):
            text = re.sub(pattern, "***", text)
        return text


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


__all__ = [
    "Config",
    "State",
    "Capability",
    "ShellSession",
    "CompleteRemoteCommandResult",
    "DEFAULT_TERMINATE_GRACE_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "render_prompt_observation_from_result",
]
