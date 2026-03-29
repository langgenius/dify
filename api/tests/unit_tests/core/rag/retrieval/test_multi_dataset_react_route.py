from types import SimpleNamespace
from unittest.mock import Mock, patch

from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import PromptMessageRole
from graphon.model_runtime.entities.model_entities import ModelType

from core.rag.retrieval.output_parser.react_output import ReactAction, ReactFinish
from core.rag.retrieval.router.multi_dataset_react_route import ReactMultiDatasetRouter


class TestReactMultiDatasetRouter:
    def test_invoke_returns_none_when_no_tools(self) -> None:
        router = ReactMultiDatasetRouter()

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[],
            model_config=Mock(),
            model_instance=Mock(),
            user_id="u1",
            tenant_id="t1",
        )

        assert dataset_id is None
        assert usage == LLMUsage.empty_usage()

    def test_invoke_returns_single_tool_directly(self) -> None:
        router = ReactMultiDatasetRouter()
        tool = Mock()
        tool.name = "dataset-1"

        dataset_id, usage = router.invoke(
            query="python",
            dataset_tools=[tool],
            model_config=Mock(),
            model_instance=Mock(),
            user_id="u1",
            tenant_id="t1",
        )

        assert dataset_id == "dataset-1"
        assert usage == LLMUsage.empty_usage()

    def test_invoke_returns_tool_from_react_invoke(self) -> None:
        router = ReactMultiDatasetRouter()
        usage = LLMUsage.empty_usage()
        tool_1 = Mock(name="dataset-1")
        tool_1.name = "dataset-1"
        tool_2 = Mock(name="dataset-2")
        tool_2.name = "dataset-2"

        with patch.object(router, "_react_invoke", return_value=("dataset-2", usage)) as mock_react:
            dataset_id, returned_usage = router.invoke(
                query="python",
                dataset_tools=[tool_1, tool_2],
                model_config=Mock(),
                model_instance=Mock(),
                user_id="u1",
                tenant_id="t1",
            )

        mock_react.assert_called_once()
        assert dataset_id == "dataset-2"
        assert returned_usage == usage

    def test_invoke_handles_react_invoke_errors(self) -> None:
        router = ReactMultiDatasetRouter()
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"

        with patch.object(router, "_react_invoke", side_effect=RuntimeError("boom")):
            dataset_id, usage = router.invoke(
                query="python",
                dataset_tools=[tool_1, tool_2],
                model_config=Mock(),
                model_instance=Mock(),
                user_id="u1",
                tenant_id="t1",
            )

        assert dataset_id is None
        assert usage == LLMUsage.empty_usage()

    def test_react_invoke_returns_action_tool(self) -> None:
        router = ReactMultiDatasetRouter()
        model_config = Mock()
        model_config.mode = "chat"
        model_config.parameters = {"temperature": 0.1}
        model_instance = Mock()
        usage = LLMUsage.empty_usage()
        tools = [Mock(name="dataset-1"), Mock(name="dataset-2")]
        tools[0].name = "dataset-1"
        tools[0].description = "desc"
        tools[1].name = "dataset-2"
        tools[1].description = "desc"

        with (
            patch.object(router, "create_chat_prompt", return_value=[Mock()]) as mock_chat_prompt,
            patch(
                "core.rag.retrieval.router.multi_dataset_react_route.AdvancedPromptTransform"
            ) as mock_prompt_transform,
            patch.object(router, "_invoke_llm", return_value=('{"action":"dataset-2","action_input":{}}', usage)),
            patch("core.rag.retrieval.router.multi_dataset_react_route.StructuredChatOutputParser") as mock_parser_cls,
        ):
            mock_prompt_transform.return_value.get_prompt.return_value = [Mock()]
            mock_parser_cls.return_value.parse.return_value = ReactAction("dataset-2", {}, "log")

            dataset_id, returned_usage = router._react_invoke(
                query="python",
                model_config=model_config,
                model_instance=model_instance,
                tools=tools,
                user_id="u1",
                tenant_id="t1",
            )

        mock_chat_prompt.assert_called_once()
        assert mock_prompt_transform.return_value.get_prompt.call_args.kwargs["model_instance"] is model_instance
        assert dataset_id == "dataset-2"
        assert returned_usage == usage

    def test_react_invoke_returns_none_for_finish(self) -> None:
        router = ReactMultiDatasetRouter()
        model_config = Mock()
        model_config.mode = "completion"
        model_config.parameters = {"temperature": 0.1}
        usage = LLMUsage.empty_usage()
        tool = Mock()
        tool.name = "dataset-1"
        tool.description = "desc"

        with (
            patch.object(router, "create_completion_prompt", return_value=Mock()) as mock_completion_prompt,
            patch(
                "core.rag.retrieval.router.multi_dataset_react_route.AdvancedPromptTransform"
            ) as mock_prompt_transform,
            patch.object(
                router, "_invoke_llm", return_value=('{"action":"Final Answer","action_input":"done"}', usage)
            ),
            patch("core.rag.retrieval.router.multi_dataset_react_route.StructuredChatOutputParser") as mock_parser_cls,
        ):
            mock_prompt_transform.return_value.get_prompt.return_value = [Mock()]
            mock_parser_cls.return_value.parse.return_value = ReactFinish({"output": "done"}, "log")

            dataset_id, returned_usage = router._react_invoke(
                query="python",
                model_config=model_config,
                model_instance=Mock(),
                tools=[tool],
                user_id="u1",
                tenant_id="t1",
            )

        mock_completion_prompt.assert_called_once()
        assert dataset_id is None
        assert returned_usage == usage

    def test_invoke_llm_and_handle_result(self) -> None:
        router = ReactMultiDatasetRouter()
        usage = LLMUsage.empty_usage()
        delta = SimpleNamespace(message=SimpleNamespace(content="part"), usage=usage)
        chunk = SimpleNamespace(model="m1", prompt_messages=[Mock()], delta=delta)
        model_instance = Mock()
        model_instance.invoke_llm.return_value = iter([chunk])

        with (
            patch("core.rag.retrieval.router.multi_dataset_react_route.ModelManager.for_tenant") as mock_manager,
            patch("core.rag.retrieval.router.multi_dataset_react_route.deduct_llm_quota") as mock_deduct,
        ):
            mock_manager.return_value.get_model_instance.return_value = model_instance
            text, returned_usage = router._invoke_llm(
                completion_param={"temperature": 0.1},
                model_instance=model_instance,
                prompt_messages=[Mock()],
                stop=["Observation:"],
                user_id="u1",
                tenant_id="t1",
            )

        assert text == "part"
        assert returned_usage == usage
        mock_manager.assert_called_once_with(tenant_id="t1", user_id="u1")
        mock_manager.return_value.get_model_instance.assert_called_once_with(
            tenant_id="t1",
            provider=model_instance.provider,
            model_type=ModelType.LLM,
            model=model_instance.model_name,
        )
        mock_deduct.assert_called_once()

    def test_handle_invoke_result_with_empty_usage(self) -> None:
        router = ReactMultiDatasetRouter()
        delta = SimpleNamespace(message=SimpleNamespace(content="part"), usage=None)
        chunk = SimpleNamespace(model="m1", prompt_messages=[Mock()], delta=delta)

        text, usage = router._handle_invoke_result(iter([chunk]))

        assert text == "part"
        assert usage == LLMUsage.empty_usage()

    def test_create_chat_prompt(self) -> None:
        router = ReactMultiDatasetRouter()
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_1.description = "d1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"
        tool_2.description = "d2"

        chat_prompt = router.create_chat_prompt(query="python", tools=[tool_1, tool_2])
        assert len(chat_prompt) == 2
        assert chat_prompt[0].role == PromptMessageRole.SYSTEM
        assert chat_prompt[1].role == PromptMessageRole.USER
        assert "dataset-1" in chat_prompt[0].text
        assert "dataset-2" in chat_prompt[0].text

    def test_create_completion_prompt(self) -> None:
        router = ReactMultiDatasetRouter()
        tool_1 = Mock()
        tool_1.name = "dataset-1"
        tool_1.description = "d1"
        tool_2 = Mock()
        tool_2.name = "dataset-2"
        tool_2.description = "d2"

        completion_prompt = router.create_completion_prompt(tools=[tool_1, tool_2])
        assert "dataset-1: d1" in completion_prompt.text
        assert "dataset-2: d2" in completion_prompt.text

    def test_react_invoke_uses_completion_branch_for_non_chat_mode(self) -> None:
        router = ReactMultiDatasetRouter()
        model_config = Mock()
        model_config.mode = "unknown-mode"
        model_config.parameters = {}
        tool = Mock()
        tool.name = "dataset-1"
        tool.description = "desc"

        with (
            patch.object(router, "create_completion_prompt", return_value=Mock()) as mock_completion_prompt,
            patch(
                "core.rag.retrieval.router.multi_dataset_react_route.AdvancedPromptTransform"
            ) as mock_prompt_transform,
            patch.object(
                router,
                "_invoke_llm",
                return_value=('{"action":"Final Answer","action_input":"done"}', LLMUsage.empty_usage()),
            ),
            patch("core.rag.retrieval.router.multi_dataset_react_route.StructuredChatOutputParser") as mock_parser_cls,
        ):
            mock_prompt_transform.return_value.get_prompt.return_value = [Mock()]
            mock_parser_cls.return_value.parse.return_value = ReactFinish({"output": "done"}, "log")
            dataset_id, usage = router._react_invoke(
                query="python",
                model_config=model_config,
                model_instance=Mock(),
                tools=[tool],
                user_id="u1",
                tenant_id="t1",
            )

        mock_completion_prompt.assert_called_once()
        assert dataset_id is None
        assert usage == LLMUsage.empty_usage()
