"""Provider-visible request sequence produced by the standard compaction tiers.

Compaction must not make a run re-send a prefix it already sent: every
provider-side cache (prompt caching) is keyed on the token prefix, so a
compacted history that keeps getting rewritten pays the full price on every
turn. These tests pin the properties that keep that cost bounded: one
summarisation request per compaction, later requests that only extend the
previous one, and clearing that only invalidates the tool result it advances
past.
"""

from __future__ import annotations

from itertools import pairwise

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RequestUsage

from dify_agent.runtime.compaction import build_compaction_capability

_CLEARED = "[tool result cleared]"


def _round(index: int, result_chars: int) -> list[ModelMessage]:
    tool_call_id = f"call-{index}"
    return [
        ModelRequest(parts=[UserPromptPart(f"user-{index}-" + "u" * 200)]),
        ModelResponse(
            parts=[
                TextPart(f"thinking-{index}"),
                ToolCallPart("lookup", {"query": index, "pad": "p" * 300}, tool_call_id),
            ],
            model_name="probe",
        ),
        ModelRequest(parts=[ToolReturnPart("lookup", f"result-{index}-" + "r" * result_chars, tool_call_id)]),
        ModelResponse(parts=[TextPart(f"assistant-{index}-" + "a" * 300)], model_name="probe"),
    ]


def _history(turns: int, result_chars: int = 1_200) -> list[ModelMessage]:
    messages: list[ModelMessage] = []
    for index in range(turns):
        messages.extend(_round(index, result_chars))
    return messages


def _run_turns(
    messages: list[ModelMessage],
    turns: int,
    *,
    window: int = 4_000,
    follow_up_result_chars: int | None = None,
) -> list[list[ModelMessage]]:
    requests: list[list[ModelMessage]] = []
    next_index = len(messages) // 4

    def respond(request_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        del info
        requests.append(list(request_messages))
        # Derive the reply from the request size so a repeated summarisation
        # cannot pass for a reused one.
        text = f"response for {len(request_messages)} messages"
        if follow_up_result_chars is None:
            return ModelResponse(parts=[TextPart(text)], model_name="probe")
        # Report what the provider was sent: the compaction gate measures the
        # history against the last response's usage, so a stub that under-reports
        # it would stop the tiers from firing as the history really grows.
        return ModelResponse(
            parts=[TextPart(text)],
            model_name="probe",
            usage=RequestUsage(
                input_tokens=sum(len(str(message)) for message in request_messages) // 4,
                output_tokens=len(text) // 4,
            ),
        )

    agent: Agent[None, str] = Agent(FunctionModel(respond), deps_type=type(None))
    capability = build_compaction_capability(context_window_tokens=window, model_settings=None)
    assert capability is not None
    history = messages
    for turn in range(turns):
        result = agent.run_sync(f"turn-{turn}", message_history=history, capabilities=[capability])
        history = list(result.all_messages())
        if follow_up_result_chars is not None:
            history.extend(_round(next_index + turn, follow_up_result_chars))
    return requests


def _is_summarisation_request(request: list[ModelMessage]) -> bool:
    # Summarising is a standalone prompt; conversation requests carry the
    # system prompt plus the retained history.
    return len(request) == 1 and isinstance(request[0], ModelRequest)


def test_compaction_adds_exactly_one_summarisation_request() -> None:
    requests = _run_turns(_history(12), turns=3)

    summarisation_requests = [request for request in requests if _is_summarisation_request(request)]
    conversation_requests = [request for request in requests if not _is_summarisation_request(request)]

    assert len(summarisation_requests) == 1
    assert len(conversation_requests) == 3
    # The summary has to be produced before the first compacted conversation.
    assert requests[0] is summarisation_requests[0]


def test_compaction_keeps_later_provider_requests_prefix_aligned() -> None:
    requests = _run_turns(_history(12), turns=3)

    conversation_requests = [request for request in requests if not _is_summarisation_request(request)]
    assert len(conversation_requests) == 3

    for earlier, later in pairwise(conversation_requests):
        assert later[: len(earlier)] == earlier


def test_clearing_only_invalidates_the_tool_result_the_window_advances_past() -> None:
    """Clearing tool results is the whole compaction here, and each new tool round pushes
    the oldest still-visible result out of ``keep_pairs``.

    Blanking that result is the one rewrite a falling window cannot avoid, so it must be
    the only message that differs from the request before: a provider cache stays valid up
    to it, and no earlier message is re-sent differently.
    """
    requests = _run_turns(_history(8, result_chars=3_000), turns=3, window=8_000, follow_up_result_chars=3_000)

    conversation_requests = [request for request in requests if not _is_summarisation_request(request)]
    # Clearing alone keeps every request under the budget, so summarising never runs.
    assert len(conversation_requests) == len(requests) == 3

    cleared = [sum(str(message).count(_CLEARED) for message in request) for request in conversation_requests]
    assert cleared == [5, 6, 7]

    divergence_indexes: list[int] = []
    for earlier, later in pairwise(conversation_requests):
        assert len(later) > len(earlier)
        diverged = [index for index in range(len(earlier)) if earlier[index] != later[index]]
        assert len(diverged) == 1
        index = diverged[0]
        divergence_indexes.append(index)
        original_part = earlier[index].parts[0]
        cleared_part = later[index].parts[0]
        assert isinstance(original_part, ToolReturnPart)
        assert isinstance(cleared_part, ToolReturnPart)
        assert original_part.content.startswith("result-")
        assert cleared_part.content == _CLEARED
    # Each request blanks the tool result that just left the window -- the fifth, then the
    # sixth -- and never one the previous request had already cleared.
    assert divergence_indexes == [22, 26]
