"""Runtime execution for one scheduled Dify Agent run.

The runner is storage-agnostic: it normalizes the public Dify composition into
Agenton's graph/config split and chooses one of two execution modes after the
composition is normalized and the ``on_exit`` policy is validated:

- model runs: enter a fresh ``CompositorRun`` (or resume one from a snapshot),
  render the current Dify system prompts into temporary ``message_history``, run
  pydantic-ai with either the current ``run.user_prompts`` or deferred external
  tool results, emit stream events, apply request-level ``on_exit`` signals, and
  publish a terminal success or failure event;
- lifecycle-only runs: enter from a supplied snapshot, apply request-level
  ``on_exit`` signals, exit without invoking a model, and succeed with explicit
  ``output = null`` and ``usage = null``.

The Pydantic AI model is resolved from the active Agenton layer named by
``DIFY_AGENT_MODEL_LAYER_ID``. An optional history layer contributes stored
message history only through session state; successful model runs append only
``result.new_messages()`` back into that layer so current system prompts are not
persisted. An optional structured output layer named by
``DIFY_AGENT_OUTPUT_LAYER_ID`` is read after entry and resolved into an output
contract whose type both exposes the output schema to the model and performs
runtime JSON Schema validation through custom Pydantic hooks. When the ask-human
layer is active, the runtime also allows ``DeferredToolRequests`` output and
publishes that deferred request through the normal ``run_succeeded`` event as
``deferred_tool_call`` instead of a final ``output``. Invalid structured outputs
or invalid deferred-tool behavior still trigger normal retries/failures before
Dify Agent emits success. Layers still never own the FastAPI lifespan-owned
plugin daemon or Dify API inner HTTP clients. Successful terminal events contain
both the JSON-safe final output or deferred tool call and the session snapshot;
there are no separate output or snapshot events to correlate.
"""

from collections.abc import AsyncIterable, Callable
from collections import Counter
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast, runtime_checkable

import httpx
from pydantic import JsonValue, TypeAdapter
from pydantic_ai.messages import AgentStreamEvent
from pydantic_ai.output import OutputSpec
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults

from agenton.compositor import CompositorSessionSnapshot, LayerConfigInput, LayerProviderInput
from agenton.layers.types import PydanticAITool
from dify_agent.layers.ask_human.layer import get_ask_human_layer, validate_ask_human_layer_composition
from dify_agent.layers.dify_core_tools.layer import DifyCoreToolsLayer
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.layers.dify_plugin.tools_layer import DifyPluginToolsLayer
from dify_agent.layers.knowledge.layer import DifyKnowledgeBaseLayer
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    CreateRunRequest,
    DIFY_AGENT_MODEL_LAYER_ID,
    DeferredToolCallPayload,
    normalize_composition,
)
from dify_agent.runtime.agent_factory import create_agent, normalize_user_input
from dify_agent.runtime.agenton_validation import is_agenton_enter_validation_runtime_error
from dify_agent.runtime.compositor_factory import build_pydantic_ai_compositor, create_default_layer_providers
from dify_agent.runtime.event_sink import (
    RunEventSink,
    emit_pydantic_ai_event,
    emit_run_failed,
    emit_run_started,
    emit_run_succeeded,
)
from dify_agent.runtime.history import (
    append_successful_run_history,
    build_run_message_history,
    get_history_layer,
    validate_history_layer_composition,
)
from dify_agent.runtime.layer_exit_signals import apply_layer_exit_signals, validate_layer_exit_signals
from dify_agent.runtime.output_type import resolve_run_output_contract, validate_output_layer_composition
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt


_AGENT_OUTPUT_ADAPTER = TypeAdapter(object)


@runtime_checkable
class _HasUsage(Protocol):
    usage: object


@runtime_checkable
class _HasInputTokens(Protocol):
    input_tokens: object


@runtime_checkable
class _HasOutputTokens(Protocol):
    output_tokens: object


@runtime_checkable
class _HasTotalTokens(Protocol):
    total_tokens: object


class AgentRunValidationError(ValueError):
    """Raised when a run request is valid JSON but cannot execute."""


def _has_model_layer(request: CreateRunRequest) -> bool:
    """Return whether the public composition includes the reserved model layer."""
    return any(layer.name == DIFY_AGENT_MODEL_LAYER_ID for layer in request.composition.layers)


@dataclass(slots=True)
class RunSuccessOutcome:
    """Normalized successful runner output before event emission."""

    result_kind: Literal["output", "deferred_tool_call"]
    output: JsonValue | None
    deferred_tool_call: DeferredToolCallPayload | None
    session_snapshot: CompositorSessionSnapshot
    usage: AgentRunUsage | None


class AgentRunRunner:
    """Executes one run and writes only public run events to its sink."""

    sink: RunEventSink

    request: CreateRunRequest
    run_id: str
    layer_providers: tuple[LayerProviderInput, ...]
    plugin_daemon_http_client: httpx.AsyncClient
    dify_api_http_client: httpx.AsyncClient

    def __init__(
        self,
        *,
        sink: RunEventSink,
        request: CreateRunRequest,
        run_id: str,
        plugin_daemon_http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
        layer_providers: tuple[LayerProviderInput, ...] | None = None,
    ) -> None:
        self.sink = sink
        self.request = request
        self.run_id = run_id
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.dify_api_http_client = dify_api_http_client
        self.layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()

    async def run(self) -> None:
        """Execute the run and emit the documented event sequence."""
        await self.sink.update_status(self.run_id, "running")
        _ = await emit_run_started(self.sink, run_id=self.run_id)

        try:
            outcome = await self._run_agent()
        except Exception as exc:
            message = str(exc) or type(exc).__name__
            _ = await emit_run_failed(self.sink, run_id=self.run_id, error=message)
            await self.sink.update_status(self.run_id, "failed", message)
            raise

        _ = await emit_run_succeeded(
            self.sink,
            run_id=self.run_id,
            **(
                {"output": outcome.output}
                if outcome.result_kind == "output"
                else {"deferred_tool_call": outcome.deferred_tool_call}
            ),
            session_snapshot=outcome.session_snapshot,
            usage=outcome.usage,
        )
        await self.sink.update_status(self.run_id, "succeeded")

    async def _run_agent(self) -> RunSuccessOutcome:
        """Run the normalized request in model or lifecycle-only mode.

        Known request-shaped Agenton enter-time failures are normalized to
        ``AgentRunValidationError``. That includes the existing small class of
        enter-time ``RuntimeError`` values reported by Agenton plus
        layer-construction or snapshot-hydration ``ValueError`` failures that
        arise before the run becomes active, such as missing shell settings for a
        requested ``dify.shell`` layer or malformed serialized shell offsets.
        Output/history-layer graph invariants are validated from the public
        composition before entering Agenton so misnamed or extra reserved layers
        never silently degrade. Later runtime failures still propagate as
        execution errors so they become terminal failed runs rather than client
        validation responses. Structured output uses a resolved contract whose
        type itself encodes both the model-facing schema and the runtime
        validation hooks, so invalid model outputs can be corrected before Dify
        Agent emits success.
        """
        try:
            validate_output_layer_composition(self.request.composition)
            validate_history_layer_composition(self.request.composition)
            validate_ask_human_layer_composition(self.request.composition)
            graph_config, layer_configs = normalize_composition(self.request.composition)
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            validate_layer_exit_signals(compositor, self.request.on_exit)
        except (KeyError, TypeError, ValueError) as exc:
            raise AgentRunValidationError(str(exc)) from exc

        if not _has_model_layer(self.request):
            return await self._run_lifecycle_only(compositor=compositor, layer_configs=layer_configs)
        return await self._run_model(compositor=compositor, layer_configs=layer_configs)

    async def _run_lifecycle_only(
        self,
        *,
        compositor: Any,
        layer_configs: dict[str, LayerConfigInput],
    ) -> RunSuccessOutcome:
        """Replay only layer lifecycle work for a no-LLM composition plus snapshot."""
        if self.request.session_snapshot is None:
            raise AgentRunValidationError(
                f"Missing '{DIFY_AGENT_MODEL_LAYER_ID}' requires a session_snapshot for lifecycle-only runs."
            )
        if self.request.deferred_tool_results is not None:
            raise AgentRunValidationError(
                f"Deferred tool results require the reserved '{DIFY_AGENT_MODEL_LAYER_ID}' layer."
            )

        entered_run = False
        try:
            async with compositor.enter(configs=layer_configs, session_snapshot=self.request.session_snapshot) as run:
                entered_run = True
                apply_layer_exit_signals(run, self.request.on_exit)
        except RuntimeError as exc:
            if not entered_run and is_agenton_enter_validation_runtime_error(exc):
                raise AgentRunValidationError(str(exc)) from exc
            raise
        except ValueError as exc:
            if not entered_run:
                raise AgentRunValidationError(str(exc)) from exc
            raise

        if run.session_snapshot is None:
            raise RuntimeError("Agenton run did not produce a session snapshot after exit.")
        return RunSuccessOutcome(
            result_kind="output",
            output=None,
            deferred_tool_call=None,
            session_snapshot=run.session_snapshot,
            usage=None,
        )

    async def _run_model(
        self,
        *,
        compositor: Any,
        layer_configs: dict[str, LayerConfigInput],
    ) -> RunSuccessOutcome:
        """Run the normal model/deferred-tool path inside an entered Agenton run."""
        entered_run = False
        output: JsonValue | None = None
        deferred_tool_call: DeferredToolCallPayload | None = None
        result_kind: Literal["output", "deferred_tool_call"] | None = None
        usage: AgentRunUsage | None = None
        try:
            async with compositor.enter(configs=layer_configs, session_snapshot=self.request.session_snapshot) as run:
                entered_run = True
                apply_layer_exit_signals(run, self.request.on_exit)
                user_prompts = run.user_prompts
                deferred_tool_results = _resolve_deferred_tool_results(self.request)
                if deferred_tool_results is None and not has_non_blank_user_prompt(user_prompts):
                    raise AgentRunValidationError(EMPTY_USER_PROMPTS_ERROR)

                async def handle_events(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
                    async for event in events:
                        _ = await emit_pydantic_ai_event(self.sink, run_id=self.run_id, data=event)

                try:
                    output_contract = resolve_run_output_contract(run)
                    history_layer = get_history_layer(run)
                    message_history = await build_run_message_history(
                        system_prompts=run.prompts,
                        stored_history=history_layer.message_history if history_layer is not None else (),
                    )
                    ask_human_layer = get_ask_human_layer(run)
                    llm_layer = run.get_layer(DIFY_AGENT_MODEL_LAYER_ID, DifyPluginLLMLayer)
                    model = llm_layer.get_model(http_client=self.plugin_daemon_http_client)
                    tools = await _resolve_run_tools(
                        run,
                        plugin_daemon_http_client=self.plugin_daemon_http_client,
                        dify_api_http_client=self.dify_api_http_client,
                    )
                except (KeyError, TypeError, RuntimeError, ValueError) as exc:
                    raise AgentRunValidationError(str(exc)) from exc

                if deferred_tool_results is not None and history_layer is None:
                    raise AgentRunValidationError(
                        "Deferred tool results require a 'history' layer with prior message history."
                    )

                agent = create_agent(
                    model,
                    tools=tools,
                    output_type=_resolve_agent_output_type(output_contract.output_type, ask_human_layer is not None),
                )
                result = await agent.run(
                    None if deferred_tool_results is not None else normalize_user_input(user_prompts),
                    message_history=message_history,
                    deferred_tool_results=deferred_tool_results,
                    event_stream_handler=handle_events,
                )
                usage = _serialize_agent_usage(_result_usage(result))
                append_successful_run_history(history_layer, result.new_messages())
                if isinstance(result.output, DeferredToolRequests):
                    if ask_human_layer is None:
                        raise AgentRunValidationError(
                            "Deferred tool requests were returned, but no active ask_human layer is available for validation."
                        )
                    if history_layer is None:
                        raise AgentRunValidationError(
                            "ask_human deferred tool requests require a 'history' layer so the pending tool call can be resumed."
                        )
                    deferred_tool_call = ask_human_layer.build_deferred_tool_call_payload(result.output)
                    result_kind = "deferred_tool_call"
                else:
                    output = _serialize_agent_output(result.output)
                    result_kind = "output"
        except RuntimeError as exc:
            if not entered_run and is_agenton_enter_validation_runtime_error(exc):
                raise AgentRunValidationError(str(exc)) from exc
            raise
        except ValueError as exc:
            if not entered_run:
                raise AgentRunValidationError(str(exc)) from exc
            raise

        if run.session_snapshot is None:
            raise RuntimeError("Agenton run did not produce a session snapshot after exit.")
        if result_kind is None:
            raise RuntimeError("Agent run did not resolve either a final output or a deferred tool call.")

        return RunSuccessOutcome(
            result_kind=result_kind,
            output=output,
            deferred_tool_call=deferred_tool_call,
            session_snapshot=run.session_snapshot,
            usage=usage,
        )


def _serialize_agent_output(output: object) -> JsonValue:
    """Convert arbitrary pydantic-ai output into the public JSON-safe payload type."""
    return cast(JsonValue, _AGENT_OUTPUT_ADAPTER.dump_python(output, mode="json"))


def _result_usage(result: object) -> object | None:
    """Return pydantic-ai result usage across method/property API variants."""
    if not isinstance(result, _HasUsage):
        return None

    usage = result.usage
    if isinstance(usage, _HasInputTokens) or isinstance(usage, _HasOutputTokens):
        return usage
    if callable(usage):
        usage_getter = cast(Callable[[], object], usage)
        return usage_getter()
    return usage


def _serialize_agent_usage(usage: object | None) -> AgentRunUsage | None:
    """Convert pydantic-ai request usage into the public Agent run usage shape."""
    if usage is None:
        return None
    input_tokens = int(usage.input_tokens or 0) if isinstance(usage, _HasInputTokens) else 0
    output_tokens = int(usage.output_tokens or 0) if isinstance(usage, _HasOutputTokens) else 0
    total_tokens = int(usage.total_tokens or 0) if isinstance(usage, _HasTotalTokens) else 0
    return AgentRunUsage(
        prompt_tokens=input_tokens,
        completion_tokens=output_tokens,
        total_tokens=total_tokens,
    )


def _resolve_agent_output_type(output_type: OutputSpec[object], allow_deferred_tools: bool) -> OutputSpec[object]:
    """Return the run output type, optionally augmented with deferred-tool support."""
    if not allow_deferred_tools:
        return output_type
    return cast(OutputSpec[object], [output_type, DeferredToolRequests])


def _resolve_deferred_tool_results(request: CreateRunRequest) -> DeferredToolResults | None:
    """Convert public deferred tool results into the pydantic-ai resume input."""
    if request.deferred_tool_results is None:
        return None
    return request.deferred_tool_results.to_pydantic_ai()


async def _resolve_run_tools(
    run: Any,
    *,
    plugin_daemon_http_client: httpx.AsyncClient,
    dify_api_http_client: httpx.AsyncClient,
) -> list[PydanticAITool[object]]:
    """Return the static compositor tools plus any Dify runtime tools."""
    resolved_tools = list(cast(list[PydanticAITool[object]], run.tools))
    for slot in run.slots.values():
        layer = slot.layer
        if isinstance(layer, DifyPluginToolsLayer):
            resolved_tools.extend(
                await layer.get_tools(
                    http_client=plugin_daemon_http_client,
                    dify_api_http_client=dify_api_http_client,
                )
            )
        if isinstance(layer, DifyCoreToolsLayer):
            resolved_tools.extend(await layer.get_tools(http_client=dify_api_http_client))
        if isinstance(layer, DifyKnowledgeBaseLayer):
            resolved_tools.extend(await layer.get_tools(http_client=dify_api_http_client))
    _validate_unique_tool_names(resolved_tools)
    return resolved_tools


def _validate_unique_tool_names(tools: list[PydanticAITool[object]]) -> None:
    """Reject duplicate tool names across static and dynamic tool sources."""
    duplicate_names = sorted(name for name, count in Counter(tool.name for tool in tools).items() if count > 1)
    if duplicate_names:
        names = ", ".join(duplicate_names)
        raise ValueError(f"Agent run requires unique tool names across all layers, got duplicates: {names}.")


__all__ = ["AgentRunRunner", "AgentRunValidationError"]
