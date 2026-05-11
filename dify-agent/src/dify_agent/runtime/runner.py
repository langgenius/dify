"""Runtime execution for one scheduled Dify Agent run.

The runner is storage-agnostic: it builds an Agenton compositor, enters or
resumes its session, runs pydantic-ai with ``compositor.user_prompts`` as the user
input, emits stream events, applies request-level layer exit signals, snapshots
the resulting session, and then publishes a terminal success or failure event.
The Pydantic AI model is resolved from the active Agenton layer named by
``DIFY_AGENT_MODEL_LAYER_ID``. Successful terminal events contain both the
JSON-safe final output and session snapshot; there are no separate output or
snapshot events to correlate.
"""

from collections.abc import AsyncIterable
from typing import cast

from pydantic import JsonValue, TypeAdapter
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorSessionSnapshot, LayerRegistry
from dify_agent.layers.dify_plugin.llm_layer import DifyPluginLLMLayer
from dify_agent.protocol.schemas import DIFY_AGENT_MODEL_LAYER_ID, CreateRunRequest
from dify_agent.runtime.agent_factory import create_agent, normalize_user_input
from dify_agent.runtime.compositor_factory import build_pydantic_ai_compositor, create_default_layer_registry
from dify_agent.runtime.event_sink import (
    RunEventSink,
    emit_pydantic_ai_event,
    emit_run_failed,
    emit_run_started,
    emit_run_succeeded,
)
from dify_agent.runtime.layer_exit_signals import apply_layer_exit_signals, validate_layer_exit_signals
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt


_AGENT_OUTPUT_ADAPTER = TypeAdapter(object)


class AgentRunValidationError(ValueError):
    """Raised when a run request is valid JSON but cannot execute."""


class AgentRunRunner:
    """Executes one run and writes only public run events to its sink."""

    sink: RunEventSink

    request: CreateRunRequest
    run_id: str
    layer_registry: LayerRegistry

    def __init__(
        self,
        *,
        sink: RunEventSink,
        request: CreateRunRequest,
        run_id: str,
        layer_registry: LayerRegistry | None = None,
    ) -> None:
        self.sink = sink
        self.request = request
        self.run_id = run_id
        self.layer_registry = layer_registry or create_default_layer_registry()

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
        """Run pydantic-ai inside an entered Agenton session."""
        compositor = build_pydantic_ai_compositor(self.request.compositor, registry=self.layer_registry)
        try:
            validate_layer_exit_signals(compositor, self.request.layer_exit_signals)
        except ValueError as exc:
            raise AgentRunValidationError(str(exc)) from exc
        session = (
            compositor.session_from_snapshot(self.request.session_snapshot)
            if self.request.session_snapshot is not None
            else compositor.new_session()
        )
        async with compositor.enter(session) as active_session:
            apply_layer_exit_signals(active_session, self.request.layer_exit_signals)
            user_prompts = compositor.user_prompts
            if not has_non_blank_user_prompt(user_prompts):
                raise AgentRunValidationError(EMPTY_USER_PROMPTS_ERROR)

            async def handle_events(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
                async for event in events:
                    _ = await emit_pydantic_ai_event(self.sink, run_id=self.run_id, data=event)

            try:
                llm_layer = compositor.get_layer(DIFY_AGENT_MODEL_LAYER_ID, DifyPluginLLMLayer)
                llm_control = active_session.layer(DIFY_AGENT_MODEL_LAYER_ID)
                model = llm_layer.get_model(llm_control)
            except (KeyError, TypeError, RuntimeError) as exc:
                raise AgentRunValidationError(str(exc)) from exc

            agent = create_agent(model, system_prompts=compositor.prompts, tools=compositor.tools)
            result = await agent.run(normalize_user_input(user_prompts), event_stream_handler=handle_events)

        return _serialize_agent_output(result.output), compositor.snapshot_session(session)


def _serialize_agent_output(output: object) -> JsonValue:
    """Convert arbitrary pydantic-ai output into the public JSON-safe payload type."""
    return cast(JsonValue, _AGENT_OUTPUT_ADAPTER.dump_python(output, mode="json"))


__all__ = ["AgentRunRunner", "AgentRunValidationError"]
