import json
from collections.abc import Generator

from core.agent.entities import AgentScratchpadUnit
from core.agent.output_parser.cot_output_parser import CotAgentOutputParser
from core.model_runtime.entities.llm_entities import AssistantPromptMessage, LLMResultChunk, LLMResultChunkDelta


def mock_llm_response(text) -> Generator[LLMResultChunk, None, None]:
    for i in range(len(text)):
        yield LLMResultChunk(
            model="model",
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=text[i], tool_calls=[])),
        )


def test_cot_output_parser():
    test_cases = [
        {
            "input": 'Through: abc\nAction: ```{"action": "Final Answer", "action_input": "```echarts\n {}\n```"}```',
            "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
            "output": 'Through: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
        },
        # code block with json
        {
            "input": 'Through: abc\nAction: ```json\n{"action": "Final Answer", "action_input": "```echarts\n {'
            '}\n```"}```',
            "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
            "output": 'Through: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
        },
        # code block with JSON
        {
            "input": 'Through: abc\nAction: ```JSON\n{"action": "Final Answer", "action_input": "```echarts\n {'
            '}\n```"}```',
            "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
            "output": 'Through: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
        },
        # list
        {
            "input": 'Through: abc\nAction: ```[{"action": "Final Answer", "action_input": "```echarts\n {}\n```"}]```',
            "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
            "output": 'Through: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
        },
        # no code block
        {
            "input": 'Through: abc\nAction: {"action": "Final Answer", "action_input": "```echarts\n {}\n```"}',
            "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
            "output": 'Through: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
        },
        # no code block and json
        {"input": "Through: abc\nAction: efg", "action": {}, "output": "Through: abc\n efg"},
    ]

    for test_case in test_cases:
        # mock llm_response as a generator by text
        llm_response: Generator[LLMResultChunk, None, None] = mock_llm_response(test_case["input"])
        usage_dict: dict = {}
        results = CotAgentOutputParser.handle_react_stream_output(llm_response, usage_dict)
        streamed_text = ""
        actions: list[AgentScratchpadUnit.Action] = []
        for result in results:
            if isinstance(result, str):
                streamed_text += result
            elif isinstance(result, AgentScratchpadUnit.Action):
                actions.append(result)

        if test_case["action"]:
            assert actions, "expected an Action to be parsed"
            assert actions[0].to_dict() == test_case["action"]
            # New behavior: stream Final Answer action_input as it is produced.
            assert test_case["action"]["action_input"] in streamed_text
            assert usage_dict.get("final_answer_streamed") is True
        else:
            assert not actions
            if test_case["output"]:
                assert streamed_text == test_case["output"]


def test_cot_output_parser_streams_final_answer_action_input_inline_json():
    """
    When the model uses ReAct JSON with `action: Final Answer`, we should stream the
    `action_input` value as it is produced (before the JSON completes).
    """
    text = 'Action: {"action": "Final Answer", "action_input": "hello world"}'
    llm_response = mock_llm_response(text)
    usage_dict: dict = {}
    results = CotAgentOutputParser.handle_react_stream_output(llm_response, usage_dict)

    streamed = ""
    for item in results:
        if isinstance(item, str):
            streamed += item

    assert "hello world" in streamed
    assert usage_dict.get("final_answer_streamed") is True


def test_cot_output_parser_streams_final_answer_action_input_code_block_json():
    """
    Same as the inline JSON case, but with the common ```json fenced block format.
    """
    text = 'Action: ```json\n{"action": "Final Answer", "action_input": "hello"}\n```'
    llm_response = mock_llm_response(text)
    usage_dict: dict = {}
    results = CotAgentOutputParser.handle_react_stream_output(llm_response, usage_dict)

    streamed = ""
    for item in results:
        if isinstance(item, str):
            streamed += item

    assert "hello" in streamed
    assert usage_dict.get("final_answer_streamed") is True


def test_cot_output_parser_does_not_emit_partial_unicode_escape_in_action_input():
    """
    Ensure we don't emit partial escape fragments when `action_input` is incomplete.

    The parser keeps a small amount of manual logic to avoid cutting in the middle of
    escape sequences (e.g. a partial `\\uXXXX`). This test locks that behavior.
    """
    # Incomplete unicode escape (missing 2 hex digits).
    # Note: intentionally omit the closing `"` / `}` to simulate an unfinished stream.
    text = 'Action: {"action": "Final Answer", "action_input": "hello ' + "\\u4f"
    llm_response = mock_llm_response(text)
    usage_dict: dict = {}
    results = CotAgentOutputParser.handle_react_stream_output(llm_response, usage_dict)

    streamed_chunks: list[str] = []
    for item in results:
        if isinstance(item, str):
            streamed_chunks.append(item)

    # In this invalid-JSON case, the parser may later yield the raw JSON buffer (fallback path).
    # We only want to validate the *streamed final answer text* produced by the incremental
    # action_input streamer (which should never include partial escape fragments).
    streamed_final = "".join(c for c in streamed_chunks if '"action"' not in c and '"action_input"' not in c)

    # We should have streamed the safe prefix, but not the broken escape fragment.
    assert "hello " in streamed_final
    assert "\\u4f" not in streamed_final
    assert "\\" not in streamed_final
    assert usage_dict.get("final_answer_streamed") is True


def test_cot_output_parser_does_not_emit_trailing_backslash_in_action_input():
    """
    Ensure we don't emit a dangling backslash when `action_input` ends mid-escape.
    """
    # Simulate an LLM stopping mid-token: JSON string ends with a single backslash.
    # (This is invalid JSON, but can happen during streaming.)
    text = 'Action: {"action": "Final Answer", "action_input": "hello ' + "\\"
    llm_response = mock_llm_response(text)
    usage_dict: dict = {}
    results = CotAgentOutputParser.handle_react_stream_output(llm_response, usage_dict)

    streamed_chunks: list[str] = []
    for item in results:
        if isinstance(item, str):
            streamed_chunks.append(item)

    streamed_final = "".join(c for c in streamed_chunks if '"action"' not in c and '"action_input"' not in c)

    assert "hello " in streamed_final
    assert "\\" not in streamed_final
    assert usage_dict.get("final_answer_streamed") is True
