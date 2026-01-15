from collections.abc import Sequence

from core.agent.cot_agent_runner import _stream_text_as_llm_chunks
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage


def test_react_final_answer_is_streamed_in_multiple_chunks():
    """
    Ensure the ReAct(CoT) agent's final answer is emitted incrementally.

    The UI expects streaming `agent_message` events; this test locks the backend behavior
    that the final answer is not emitted as a single `LLMResultChunk`.
    """
    final_answer: str = "hello world"
    prompt_messages: Sequence[PromptMessage] = []
    usage = LLMUsage.empty_usage()

    chunks = list(
        _stream_text_as_llm_chunks(
            text=final_answer,
            model="mock-model",
            prompt_messages=prompt_messages,
            usage=usage,
            chunk_size=1,
        )
    )

    # For non-trivial outputs, we should have more than one chunk.
    assert len(chunks) > 1

    # The streamed text should re-assemble to the original final answer.
    rebuilt = "".join(str(c.delta.message.content or "") for c in chunks)
    assert rebuilt == final_answer

    # Usage should only be attached once (the last chunk), to avoid duplication.
    assert chunks[-1].delta.usage == usage
    assert all(c.delta.usage is None for c in chunks[:-1])

