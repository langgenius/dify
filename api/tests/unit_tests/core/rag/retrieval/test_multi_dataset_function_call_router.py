from unittest.mock import Mock

from graphon.model_runtime.entities.llm_entities import LLMUsage

from core.rag.retrieval.router.multi_dataset_function_call_router import FunctionCallMultiDatasetRouter


class TestFunctionCallMultiDatasetRouter:
    def test_invoke_returns_none_when_no_tools(self) -> None:
        router = FunctionCallMultiDatasetRouter()

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[],
            model_config=Mock(),
            model_instance=Mock(),
        )

        assert dataset_id is None
        assert usage == LLMUsage.empty_usage()

    def test_invoke_returns_single_tool_directly(self) -> None:
        router = FunctionCallMultiDatasetRouter()
        tool = Mock()
        tool.name = "dataset-1"

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[tool],
            model_config=Mock(),
            model_instance=Mock(),
        )

        assert dataset_id == "dataset-1"
        assert usage == LLMUsage.empty_usage()

    def test_invoke_returns_tool_from_model_response(self) -> None:
        router = FunctionCallMultiDatasetRouter()
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"
        usage = LLMUsage.empty_usage()
        response = Mock()
        response.usage = usage
        response.message.tool_calls = [Mock(function=Mock())]
        response.message.tool_calls[0].function.name = "dataset-2"
        model_instance = Mock()
        model_instance.invoke_llm.return_value = response

        dataset_id, returned_usage = router.invoke(
            query="python",
            dataset_tools=[tool_1, tool_2],
            model_config=Mock(),
            model_instance=model_instance,
        )

        assert dataset_id == "dataset-2"
        assert returned_usage == usage
        model_instance.invoke_llm.assert_called_once()

    def test_invoke_returns_none_when_no_tool_calls(self) -> None:
        router = FunctionCallMultiDatasetRouter()
        response = Mock()
        response.usage = LLMUsage.empty_usage()
        response.message.tool_calls = []
        model_instance = Mock()
        model_instance.invoke_llm.return_value = response
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[tool_1, tool_2],
            model_config=Mock(),
            model_instance=model_instance,
        )

        assert dataset_id is None
        assert usage == response.usage

    def test_invoke_returns_empty_usage_when_model_raises(self) -> None:
        router = FunctionCallMultiDatasetRouter()
        model_instance = Mock()
        model_instance.invoke_llm.side_effect = RuntimeError("boom")
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[tool_1, tool_2],
            model_config=Mock(),
            model_instance=model_instance,
        )

        assert dataset_id is None
        assert usage == LLMUsage.empty_usage()
