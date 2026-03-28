import pytest

from core.rag.retrieval.output_parser.react_output import ReactAction, ReactFinish
from core.rag.retrieval.output_parser.structured_chat import StructuredChatOutputParser


class TestStructuredChatOutputParser:
    def test_parse_action_without_action_input(self) -> None:
        parser = StructuredChatOutputParser()
        text = 'Action:\n```json\n{"action":"some_action"}\n```'
        result = parser.parse(text)

        assert isinstance(result, ReactAction)
        assert result.tool == "some_action"
        assert result.tool_input == {}

    def test_parse_json_without_action_key(self) -> None:
        parser = StructuredChatOutputParser()
        text = 'Action:\n```json\n{"not_action":"search"}\n```'
        with pytest.raises(ValueError, match="Could not parse LLM output"):
            parser.parse(text)

    def test_parse_returns_action_for_tool_call(self) -> None:
        parser = StructuredChatOutputParser()
        text = (
            'Thought: call tool\nAction:\n```json\n{"action":"search_dataset","action_input":{"query":"python"}}\n```'
        )

        result = parser.parse(text)

        assert isinstance(result, ReactAction)
        assert result.tool == "search_dataset"
        assert result.tool_input == {"query": "python"}
        assert result.log == text

    def test_parse_returns_finish_for_final_answer(self) -> None:
        parser = StructuredChatOutputParser()
        text = 'Thought: done\nAction:\n```json\n{"action":"Final Answer","action_input":"final text"}\n```'

        result = parser.parse(text)

        assert isinstance(result, ReactFinish)
        assert result.return_values == {"output": "final text"}
        assert result.log == text

    def test_parse_returns_finish_for_json_array_payload(self) -> None:
        parser = StructuredChatOutputParser()
        text = 'Action:\n```json\n[{"action":"search","action_input":"hello"}]\n```'
        result = parser.parse(text)

        assert isinstance(result, ReactFinish)
        assert result.return_values == {"output": text}
        assert result.log == text

    def test_parse_returns_finish_for_plain_text(self) -> None:
        parser = StructuredChatOutputParser()
        text = "No structured action block"

        result = parser.parse(text)

        assert isinstance(result, ReactFinish)
        assert result.return_values == {"output": text}

    def test_parse_raises_value_error_for_invalid_json(self) -> None:
        parser = StructuredChatOutputParser()
        text = 'Action:\n```json\n{"action":"search","action_input": }\n```'

        with pytest.raises(ValueError, match="Could not parse LLM output"):
            parser.parse(text)
