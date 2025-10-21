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

    parser = CotAgentOutputParser()
    usage_dict = {}
    for test_case in test_cases:
        # mock llm_response as a generator by text
        llm_response: Generator[LLMResultChunk, None, None] = mock_llm_response(test_case["input"])
        results = parser.handle_react_stream_output(llm_response, usage_dict)
        output = ""
        for result in results:
            if isinstance(result, str):
                output += result
            elif isinstance(result, AgentScratchpadUnit.Action):
                if test_case["action"]:
                    assert result.to_dict() == test_case["action"]
                output += json.dumps(result.to_dict())
        if test_case["output"]:
            assert output == test_case["output"]
