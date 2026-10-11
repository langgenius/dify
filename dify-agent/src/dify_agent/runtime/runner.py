"""Storage-agnostic execution of native Pydantic AI module runs.

Validate all JSON data and references before I/O, create fresh native components,
and persist only State after capability cleanup. Captured history is saved in
finally, including interrupted tool responses; current instructions are never
stored. Live clients belong to the server lifespan and leases to native wrap_run
scopes. Workspace and Binding retirement remain API-owned.
"""

import asyncio
from collections.abc import AsyncIterable, Callable, Mapping
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable
from types import ModuleType

from graphon.model_runtime.entities.llm_entities import LLMUsage
from pydantic import JsonValue, TypeAdapter
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import AgentStreamEvent, PartDeltaEvent, PartStartEvent, TextPart, TextPartDelta
from pydantic_ai.usage import RunUsage, UsageLimits

from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.context import Services
from dify_agent.runtime.modules import REGISTRY, load_modules, create_modules, snapshot_modules
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.toolsets import AbstractToolset
from dify_agent.layers import history as history_module
from dify_agent.layers.prompt import layer as prompt_module
from dify_agent.layers.dify_plugin import llm_layer as llm_module
from dify_agent.layers.output import output_layer as output_module
from dify_agent.layers.user_prompt import layer as user_prompt_module
from dify_agent.layers.knowledge import layer as knowledge_module
from dify_agent.layers.knowledge.client import DifyKnowledgeBaseClientError
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    CreateRunRequest,
    DIFY_AGENT_MODEL_LAYER_ID,
    RunFailureType,
)
from dify_agent.runtime.agent_factory import create_agent, normalize_user_input
from dify_agent.runtime.compaction import build_compaction_capability
from dify_agent.runtime_backend import BindingLostError
from dify_agent.runtime.event_coalescer import (
    DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS,
    DEFAULT_TEXT_DELTA_MAX_CHARS,
    coalesce_agent_stream_events,
)
from dify_agent.runtime.event_sink import (
    RunEventSink,
    emit_pydantic_ai_event,
    emit_run_failed,
    emit_run_started,
    emit_run_succeeded,
)
from dify_agent.runtime.observability import AgentObservability
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt


_AGENT_OUTPUT_ADAPTER = TypeAdapter(object)
_MAX_AGENT_STEPS_PER_RUN = 500
DEFAULT_AGENT_RUN_TIMEOUT_SECONDS = 60 * 60


@runtime_checkable
class _HasAccumulatedUsage(Protocol):
    @property
    def accumulated_usage(self) -> LLMUsage | None: ...


class AgentRunValidationError(ValueError):
    """Raised when a run request is valid JSON but cannot execute."""


def _run_failed_error_payload(exc: Exception) -> tuple[str, RunFailureType | None, str | None]:
    """Return the public failed-run error text, type, and structured reason."""
    message = str(exc) or type(exc).__name__
    reason: str | None = None

    if isinstance(exc, UsageLimitExceeded):
        return message, RunFailureType.AGENT_RUN_LIMIT_EXCEEDED, None

    if isinstance(exc, BindingLostError):
        return message, None, "binding_lost"

    if isinstance(exc, ModelHTTPError):
        body = exc.body
        if isinstance(body, Mapping):
            body_message = body.get("message")
            if isinstance(body_message, str) and body_message:
                message = body_message

            error_type = body.get("error_type")
            if isinstance(error_type, str) and error_type:
                reason = error_type

        if reason is None and exc.status_code == 429:
            reason = "InvokeRateLimitError"

    if isinstance(exc, DifyKnowledgeBaseClientError):
        reason = exc.error_code or "DifyKnowledgeBaseClientError"

    return message, None, reason


def _extract_agent_message_delta(event: AgentStreamEvent) -> str | None:
    """Return agent-message text content from Pydantic AI stream events."""
    if isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
        return event.delta.content_delta
    if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
        return event.part.content
    return None


@dataclass(slots=True)
class RunSuccessOutcome:
    """Normalized successful runner output before event emission."""

    output: JsonValue | None
    session_snapshot: SessionSnapshot
    usage: AgentRunUsage | None


class AgentRunRunner:
    """Executes one run and writes only public run events to its sink."""

    sink: RunEventSink

    request: CreateRunRequest
    run_id: str
    services: Services
    registry: Mapping[str, ModuleType]
    is_cancelled: Callable[[], bool]
    run_timeout_seconds: float
    stream_text_delta_coalescing_enabled: bool
    stream_text_delta_flush_interval_seconds: float
    stream_text_delta_max_chars: int
    agent_observability: AgentObservability | None
    _terminal_session_snapshot: SessionSnapshot | None
    _terminal_usage: AgentRunUsage | None

    def __init__(
        self,
        *,
        sink: RunEventSink,
        request: CreateRunRequest,
        run_id: str,
        services: Services,
        registry: Mapping[str, ModuleType] = REGISTRY,
        is_cancelled: Callable[[], bool] | None = None,
        run_timeout_seconds: float = DEFAULT_AGENT_RUN_TIMEOUT_SECONDS,
        stream_text_delta_coalescing_enabled: bool = True,
        stream_text_delta_flush_interval_seconds: float = DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS,
        stream_text_delta_max_chars: int = DEFAULT_TEXT_DELTA_MAX_CHARS,
        agent_observability: AgentObservability | None = None,
    ) -> None:
        if stream_text_delta_flush_interval_seconds <= 0:
            raise ValueError("stream_text_delta_flush_interval_seconds must be positive")
        if stream_text_delta_max_chars <= 0:
            raise ValueError("stream_text_delta_max_chars must be positive")
        self.sink = sink
        self.request = request
        self.run_id = run_id
        self.services = services
        self.registry = registry
        self.is_cancelled = is_cancelled or (lambda: False)
        self.run_timeout_seconds = run_timeout_seconds
        self.stream_text_delta_coalescing_enabled = stream_text_delta_coalescing_enabled
        self.stream_text_delta_flush_interval_seconds = stream_text_delta_flush_interval_seconds
        self.stream_text_delta_max_chars = stream_text_delta_max_chars
        self.agent_observability = agent_observability
        self._terminal_session_snapshot = None
        self._terminal_usage = None

    @property
    def terminal_session_snapshot(self) -> SessionSnapshot | None:
        """Return the snapshot captured after native capability cleanup."""
        return self._terminal_session_snapshot

    @property
    def terminal_usage(self) -> AgentRunUsage | None:
        """Return usage accumulated before the current run reached any terminal state."""
        return self._terminal_usage

    async def run(self) -> None:
        """Execute the run and emit the documented event sequence."""
        self._terminal_session_snapshot = None
        self._terminal_usage = None
        if self.is_cancelled():
            return
        _ = await emit_run_started(self.sink, run_id=self.run_id)

        try:
            outcome = await self._run_agent()
        except Exception as exc:
            if self.is_cancelled():
                return
            message, error_type, reason = _run_failed_error_payload(exc)
            finalization = await emit_run_failed(
                self.sink,
                run_id=self.run_id,
                error=message,
                error_type=error_type,
                reason=reason,
                session_snapshot=self._terminal_session_snapshot,
                usage=self._terminal_usage,
            )
            if finalization.applied:
                raise
            return

        if self.is_cancelled():
            return
        _ = await emit_run_succeeded(
            self.sink,
            run_id=self.run_id,
            output=outcome.output,
            session_snapshot=outcome.session_snapshot,
            usage=outcome.usage,
        )

    async def _run_agent(self) -> RunSuccessOutcome:
        try:
            deps = load_modules(self.request, self.services, self.run_id, registry=self.registry)
            modules = create_modules(deps, registry=self.registry)
            model_module = modules[DIFY_AGENT_MODEL_LAYER_ID]
            if not isinstance(model_module, llm_module.Capability):
                raise ValueError("The llm module must provide native model assembly")
            model = model_module.build_model(deps)
            llm_config = llm_module.Config.model_validate(deps.layers[DIFY_AGENT_MODEL_LAYER_ID]["config"])
            history = modules.get("history")
            if history is not None and not isinstance(history, history_module.Capability):
                raise ValueError("The history slot must provide the history module")
            message_history = history.load_messages(deps) if isinstance(history, history_module.Capability) else None
            output = modules.get("output")
            if output is not None and not isinstance(output, output_module.Capability):
                raise ValueError("The output slot must provide the output module")
            output_type = (
                output.build_output_contract(deps).output_type if isinstance(output, output_module.Capability) else str
            )
            user_content = []
            for module in modules.values():
                if isinstance(module, (prompt_module.Toolset, user_prompt_module.Capability)):
                    user_content.extend(module.build_user_content(deps))
            eager_user_content = any(
                isinstance(module, knowledge_module.Capability) and module.provides_user_content(deps)
                for module in modules.values()
            )
            if not has_non_blank_user_prompt(user_content) and not eager_user_content:
                raise ValueError(EMPTY_USER_PROMPTS_ERROR)
            capabilities = [module for module in modules.values() if isinstance(module, AbstractCapability)]
            compaction = build_compaction_capability(
                context_window_tokens=llm_config.context_window_tokens, model_settings=llm_config.model_settings
            )
            if compaction is not None:
                capabilities.append(compaction)
            agent = create_agent(
                model,
                toolsets=[module for module in modules.values() if isinstance(module, AbstractToolset)],
                capabilities=capabilities,
                output_type=output_type,
            )
            if self.agent_observability is not None:
                from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig

                self.agent_observability.instrument(
                    agent,
                    execution_context=DifyExecutionContextLayerConfig.model_validate(
                        deps.layers[llm_config.execution_context]["config"]
                    ),
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise AgentRunValidationError(str(exc)) from exc

        async def handle_events(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
            published_events = coalesce_agent_stream_events(
                events,
                enabled=self.stream_text_delta_coalescing_enabled,
                flush_interval_seconds=self.stream_text_delta_flush_interval_seconds,
                max_chars=self.stream_text_delta_max_chars,
            )
            async for event in published_events:
                if self.is_cancelled():
                    raise asyncio.CancelledError
                await emit_pydantic_ai_event(
                    self.sink, run_id=self.run_id, data=event, agent_message_delta=_extract_agent_message_delta(event)
                )

        timeout = asyncio.timeout(self.run_timeout_seconds)
        try:
            with capture_run_messages() as messages:
                finished = False
                try:
                    async with timeout:
                        result = await agent.run(
                            normalize_user_input(user_content),
                            deps=deps,
                            message_history=message_history,
                            event_stream_handler=handle_events,
                            usage_limits=UsageLimits(request_limit=_MAX_AGENT_STEPS_PER_RUN),
                        )
                    finished = True
                finally:
                    if messages and isinstance(history, history_module.Capability):
                        history.save_messages(deps, messages, interrupted=not finished)
            complete_usage = model.accumulated_usage if isinstance(model, _HasAccumulatedUsage) else None
            self._terminal_usage = _serialize_agent_usage(
                complete_usage if complete_usage is not None else result.usage
            )
            final_output = _serialize_agent_output(result.output)
        except TimeoutError as exc:
            if not timeout.expired():
                raise
            raise UsageLimitExceeded(
                f"Agent run exceeded the configured limit of {self.run_timeout_seconds:g} seconds"
            ) from exc
        finally:
            # Native wrap_run scopes have exited, including cancellation cleanup.
            self._terminal_session_snapshot = snapshot_modules(deps, registry=self.registry)
            if isinstance(model, _HasAccumulatedUsage):
                usage = _serialize_agent_usage(model.accumulated_usage)
                if usage is not None:
                    self._terminal_usage = usage
        return RunSuccessOutcome(
            output=final_output, session_snapshot=self._terminal_session_snapshot, usage=self._terminal_usage
        )


def _serialize_agent_output(output: object) -> JsonValue:
    """Convert arbitrary pydantic-ai output into the public JSON-safe payload type."""
    return cast(JsonValue, _AGENT_OUTPUT_ADAPTER.dump_python(output, mode="json"))


def _serialize_agent_usage(usage: LLMUsage | RunUsage | None) -> AgentRunUsage | None:
    """Convert complete daemon or fallback pydantic-ai usage into the public shape."""
    if usage is None:
        return None
    if isinstance(usage, LLMUsage):
        return AgentRunUsage.model_validate(usage.model_dump(mode="python"))
    return AgentRunUsage(
        prompt_tokens=usage.input_tokens,
        completion_tokens=usage.output_tokens,
        total_tokens=usage.total_tokens,
    )


__all__ = ["AgentRunRunner", "AgentRunValidationError"]
