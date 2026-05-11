"""Runtime execution for one scheduled Dify Agent run.

The runner is storage-agnostic: it builds an Agenton compositor, enters or
resumes its session, runs pydantic-ai with ``compositor.user_prompts`` as the user
input, emits stream events, suspends the session on exit, snapshots it, and then
publishes a terminal success or failure event.
"""

from collections.abc import AsyncIterable

from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.runtime.agent_factory import create_agent, normalize_user_input
from dify_agent.runtime.compositor_factory import build_pydantic_ai_compositor
from dify_agent.runtime.event_sink import (
    RunEventSink,
    emit_agent_output,
    emit_pydantic_ai_event,
    emit_run_failed,
    emit_run_started,
    emit_run_succeeded,
    emit_session_snapshot,
)
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt
from dify_agent.server.schemas import CreateRunRequest


class AgentRunValidationError(ValueError):
    """Raised when a run request is valid JSON but cannot execute."""


class AgentRunRunner:
    """Executes one run and writes only public run events to its sink."""

    sink: RunEventSink

    request: CreateRunRequest
    run_id: str

    def __init__(self, *, sink: RunEventSink, request: CreateRunRequest, run_id: str) -> None:
        self.sink = sink
        self.request = request
        self.run_id = run_id

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

        _ = await emit_agent_output(self.sink, run_id=self.run_id, output=output)
        _ = await emit_session_snapshot(self.sink, run_id=self.run_id, data=session_snapshot)
        _ = await emit_run_succeeded(self.sink, run_id=self.run_id)
        await self.sink.update_status(self.run_id, "succeeded")

    async def _run_agent(self) -> tuple[str, CompositorSessionSnapshot]:
        """Run pydantic-ai inside an entered Agenton session."""
        compositor = build_pydantic_ai_compositor(self.request.compositor)
        session = (
            compositor.session_from_snapshot(self.request.session_snapshot)
            if self.request.session_snapshot is not None
            else compositor.new_session()
        )
        async with compositor.enter(session) as active_session:
            active_session.suspend_on_exit()
            user_prompts = compositor.user_prompts
            if not has_non_blank_user_prompt(user_prompts):
                raise AgentRunValidationError(EMPTY_USER_PROMPTS_ERROR)

            async def handle_events(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
                async for event in events:
                    _ = await emit_pydantic_ai_event(self.sink, run_id=self.run_id, data=event)

            agent = create_agent(
                self.request.agent_profile,
                system_prompts=compositor.prompts,
                tools=compositor.tools,
            )
            result = await agent.run(normalize_user_input(user_prompts), event_stream_handler=handle_events)

        return result.output, compositor.snapshot_session(session)


__all__ = ["AgentRunRunner", "AgentRunValidationError"]
