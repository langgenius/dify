"""Runtime execution for one scheduled Dify Agent run.

The runner is storage-agnostic: it normalizes the public Dify composition into
Agenton's graph/config split, enters a fresh ``CompositorRun`` (or resumes one
from a snapshot), runs pydantic-ai with ``run.user_prompts`` as the user input,
emits stream events, applies request-level ``on_exit`` signals, and then
publishes a terminal success or failure event. The Pydantic AI model is resolved
from the active Agenton layer named by ``DIFY_AGENT_MODEL_LAYER_ID``. An
optional structured output layer named by ``DIFY_AGENT_OUTPUT_LAYER_ID`` is read
after entry and resolved into an output contract whose type both exposes the
output schema to the model and performs runtime JSON Schema validation through
custom Pydantic hooks. Invalid structured outputs therefore trigger Pydantic
AI's normal output-validation retry behavior before Dify Agent emits
``run_succeeded``. Layers still never own the FastAPI lifespan-owned plugin
daemon HTTP client. Successful terminal events contain both the JSON-safe final
output and session snapshot; there are no separate output or snapshot events to
correlate.
"""

from collections.abc import AsyncIterable
from typing import cast

import httpx
from pydantic import JsonValue, TypeAdapter
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorSessionSnapshot, LayerProviderInput
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.protocol.schemas import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest, normalize_composition
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
from dify_agent.runtime.layer_exit_signals import apply_layer_exit_signals, validate_layer_exit_signals
from dify_agent.runtime.output_type import resolve_run_output_contract, validate_output_layer_composition
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt


_AGENT_OUTPUT_ADAPTER = TypeAdapter(object)


class AgentRunValidationError(ValueError):
    """Raised when a run request is valid JSON but cannot execute."""


class AgentRunRunner:
    """Executes one run and writes only public run events to its sink."""

    sink: RunEventSink

    request: CreateRunRequest
    run_id: str
    layer_providers: tuple[LayerProviderInput, ...]
    plugin_daemon_http_client: httpx.AsyncClient

    def __init__(
        self,
        *,
        sink: RunEventSink,
        request: CreateRunRequest,
        run_id: str,
        plugin_daemon_http_client: httpx.AsyncClient,
        layer_providers: tuple[LayerProviderInput, ...] | None = None,
    ) -> None:
        self.sink = sink
        self.request = request
        self.run_id = run_id
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()

    async def run(self) -> None:
        """Execute the run and emit the documented event sequence."""
        await self.sink.update_status(self.run_id, "running")
        _ = await emit_run_started(self.sink, run_id=self.run_id)

        try:
            output, session_snapshot = await self._run_agent()
        except Exception as exc:
            message = str(exc) or type(exc).__name__
            _ = await emit_run_failed(self.sink, run_id=self.run_id, error=message)
            await self.sink.update_status(self.run_id, "failed", message)
            raise

        _ = await emit_run_succeeded(
            self.sink,
            run_id=self.run_id,
            output=output,
            session_snapshot=session_snapshot,
        )
        await self.sink.update_status(self.run_id, "succeeded")

    async def _run_agent(self) -> tuple[JsonValue, CompositorSessionSnapshot]:
        """Run pydantic-ai inside an entered Agenton run.

        Known input-shaped Agenton enter-time runtime errors, such as trying to
        resume a ``CLOSED`` snapshot layer, are normalized to
        ``AgentRunValidationError``. Output-layer graph invariants are validated
        from the public composition before entering Agenton so misnamed or extra
        ``dify.output`` layers never silently degrade to text output. Later
        runtime failures still propagate as execution errors so they become
        terminal failed runs rather than client validation responses. Structured
        output uses a resolved contract whose type itself encodes both the
        model-facing schema and the runtime validation hooks, so invalid model
        outputs can be corrected before Dify Agent emits success.
        """
        try:
            validate_output_layer_composition(self.request.composition)
            graph_config, layer_configs = normalize_composition(self.request.composition)
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            validate_layer_exit_signals(compositor, self.request.on_exit)
        except (KeyError, TypeError, ValueError) as exc:
            raise AgentRunValidationError(str(exc)) from exc

        entered_run = False
        try:
            async with compositor.enter(configs=layer_configs, session_snapshot=self.request.session_snapshot) as run:
                entered_run = True
                apply_layer_exit_signals(run, self.request.on_exit)
                user_prompts = run.user_prompts
                if not has_non_blank_user_prompt(user_prompts):
                    raise AgentRunValidationError(EMPTY_USER_PROMPTS_ERROR)

                async def handle_events(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
                    async for event in events:
                        _ = await emit_pydantic_ai_event(self.sink, run_id=self.run_id, data=event)

                try:
                    output_contract = resolve_run_output_contract(run)
                    llm_layer = run.get_layer(DIFY_AGENT_MODEL_LAYER_ID, DifyPluginLLMLayer)
                    model = llm_layer.get_model(http_client=self.plugin_daemon_http_client)
                except (KeyError, TypeError, RuntimeError, ValueError) as exc:
                    raise AgentRunValidationError(str(exc)) from exc

                agent = create_agent(
                    model,
                    system_prompts=run.prompts,
                    tools=run.tools,
                    output_type=output_contract.output_type,
                )
                result = await agent.run(normalize_user_input(user_prompts), event_stream_handler=handle_events)
                output = _serialize_agent_output(result.output)
        except RuntimeError as exc:
            if not entered_run and is_agenton_enter_validation_runtime_error(exc):
                raise AgentRunValidationError(str(exc)) from exc
            raise

        if run.session_snapshot is None:
            raise RuntimeError("Agenton run did not produce a session snapshot after exit.")

        return output, run.session_snapshot


def _serialize_agent_output(output: object) -> JsonValue:
    """Convert arbitrary pydantic-ai output into the public JSON-safe payload type."""
    return cast(JsonValue, _AGENT_OUTPUT_ADAPTER.dump_python(output, mode="json"))


__all__ = ["AgentRunRunner", "AgentRunValidationError"]
