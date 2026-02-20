from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool


def _retrieve_config() -> DatasetRetrieveConfigEntity:
    return DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE)


def test_get_dataset_tools_handles_empty_inputs_and_builds_tools():
    assert (
        DatasetRetrieverTool.get_dataset_tools(
            tenant_id="tenant",
            dataset_ids=[],
            retrieve_config=_retrieve_config(),
            return_resource=False,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
            user_id="u",
            inputs={},
        )
        == []
    )
    assert (
        DatasetRetrieverTool.get_dataset_tools(
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=None,
            return_resource=False,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
            user_id="u",
            inputs={},
        )
        == []
    )

    retrieve_config = _retrieve_config()
    retrieval_tool = SimpleNamespace(name="dataset_tool", description="desc", run=lambda query: f"result:{query}")
    feature = Mock()
    feature.to_dataset_retriever_tool.return_value = [retrieval_tool]

    with patch("core.tools.utils.dataset_retriever_tool.DatasetRetrieval", return_value=feature):
        tools = DatasetRetrieverTool.get_dataset_tools(
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=retrieve_config,
            return_resource=True,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
            user_id="u",
            inputs={"x": 1},
        )

    assert len(tools) == 1
    assert tools[0].entity.identity.name == "dataset_tool"
    # retrieve_strategy should be restored after invocation.
    assert retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE


def test_dataset_retriever_tool_runtime_parameters_and_invoke():
    retrieval_tool = SimpleNamespace(name="dataset_tool", description="desc", run=lambda query: f"result:{query}")
    feature = Mock()
    feature.to_dataset_retriever_tool.return_value = [retrieval_tool]
    with patch("core.tools.utils.dataset_retriever_tool.DatasetRetrieval", return_value=feature):
        tool = DatasetRetrieverTool.get_dataset_tools(
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=_retrieve_config(),
            return_resource=False,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
            user_id="u",
            inputs={},
        )

    t = tool[0]
    params = t.get_runtime_parameters()
    assert len(params) == 1
    assert params[0].name == "query"

    empty_query = list(t.invoke(user_id="u", tool_parameters={}))
    assert empty_query[0].message.text == "please input query"

    t.retrieval_tool = retrieval_tool
    result = list(t.invoke(user_id="u", tool_parameters={"query": "hello"}))
    assert result[0].message.text == "result:hello"
    assert t.validate_credentials(credentials={}, parameters={}, format_only=False) is None
