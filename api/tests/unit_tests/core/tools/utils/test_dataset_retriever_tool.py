"""Unit tests for DatasetRetrieverTool behavior and retrieval wiring."""

from __future__ import annotations

from unittest.mock import Mock, create_autospec, patch

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.tools.utils.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool as RetrievalTool
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool
from models.model import AppMode
from services.knowledge.entities.retrieval import RetrievableDataset
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


def _retrieve_config() -> DatasetRetrieveConfigEntity:
    return DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE)


def _hit_callback() -> DatasetIndexToolCallbackHandler:
    with patch("core.app.apps.base_app_queue_manager.redis_client.setex"):
        queue_manager = MessageBasedAppQueueManager(
            task_id="task",
            user_id="u",
            invoke_from=InvokeFrom.DEBUGGER,
            conversation_id="conversation",
            app_mode=AppMode.CHAT,
            message_id="message",
        )
    return DatasetIndexToolCallbackHandler(queue_manager=queue_manager)


def _knowledge_retrieval() -> Mock:
    retrieval = create_autospec(KnowledgeRetriever, instance=True, spec_set=True)
    retrieval.list_datasets.return_value = [RetrievableDataset(dataset_id="d1", name="Dataset", description="desc")]
    return retrieval


def test_get_dataset_tools_returns_empty_for_empty_dataset_ids() -> None:
    # Arrange
    retrieve_config = _retrieve_config()
    knowledge_retrieval = _knowledge_retrieval()

    # Act
    tools = DatasetRetrieverTool.get_dataset_tools(
        knowledge_retrieval=knowledge_retrieval,
        app_id="app",
        tenant_id="tenant",
        dataset_ids=[],
        retrieve_config=retrieve_config,
        return_resource=False,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=_hit_callback(),
        user_id="u",
        inputs={},
    )

    # Assert
    assert tools == []


def test_get_dataset_tools_returns_empty_for_missing_retrieve_config() -> None:
    # Arrange
    dataset_ids = ["d1"]
    knowledge_retrieval = _knowledge_retrieval()

    # Act
    tools = DatasetRetrieverTool.get_dataset_tools(
        knowledge_retrieval=knowledge_retrieval,
        app_id="app",
        tenant_id="tenant",
        dataset_ids=dataset_ids,
        retrieve_config=None,  # type: ignore[arg-type]
        return_resource=False,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=_hit_callback(),
        user_id="u",
        inputs={},
    )

    # Assert
    assert tools == []


def test_get_dataset_tools_builds_tool_without_mutating_strategy() -> None:
    # Arrange
    retrieve_config = _retrieve_config()
    knowledge_retrieval = _knowledge_retrieval()

    # Act
    tools = DatasetRetrieverTool.get_dataset_tools(
        knowledge_retrieval=knowledge_retrieval,
        app_id="app",
        tenant_id="tenant",
        dataset_ids=["d1"],
        retrieve_config=retrieve_config,
        return_resource=True,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=_hit_callback(),
        user_id="u",
        inputs={"x": 1},
    )

    # Assert
    assert len(tools) == 1
    assert tools[0].entity.identity.name == "dataset_d1"
    assert retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE
    knowledge_retrieval.list_datasets.assert_called_once_with(tenant_id="tenant", dataset_ids=["d1"])
    assert tools[0].retrieval_tool.knowledge_retrieval is knowledge_retrieval
    assert tools[0].retrieval_tool.metadata_inputs == {"x": "1"}


def _build_dataset_tool() -> tuple[DatasetRetrieverTool, RetrievalTool]:
    knowledge_retrieval = _knowledge_retrieval()
    tools = DatasetRetrieverTool.get_dataset_tools(
        knowledge_retrieval=knowledge_retrieval,
        app_id="app",
        tenant_id="tenant",
        dataset_ids=["d1"],
        retrieve_config=_retrieve_config(),
        return_resource=False,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=_hit_callback(),
        user_id="u",
        inputs={},
    )
    retrieval_tool = tools[0].retrieval_tool
    assert retrieval_tool.knowledge_retrieval is knowledge_retrieval
    return tools[0], retrieval_tool


def test_runtime_parameters_shape() -> None:
    # Arrange
    tool, _ = _build_dataset_tool()

    # Act
    params = tool.get_runtime_parameters()

    # Assert
    assert len(params) == 1
    assert params[0].name == "query"


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_empty_query_behavior(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool()

    # Act
    empty_query = list(tool.invoke(session=sqlite_session, user_id="u", tool_parameters={}))

    # Assert
    assert len(empty_query) == 1
    assert empty_query[0].message.text == "please input query"


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_query_invocation_result(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool()

    # Act
    with patch.object(RetrievalTool, "_run", return_value="result:hello") as retrieve:
        result = list(tool.invoke(session=sqlite_session, user_id="u", tool_parameters={"query": "hello"}))

    # Assert
    assert len(result) == 1
    assert result[0].message.text == "result:hello"
    retrieve.assert_called_once_with("hello")


def test_validate_credentials() -> None:
    # Arrange
    tool, _ = _build_dataset_tool()

    # Act
    result = tool.validate_credentials(credentials={}, parameters={}, format_only=False)

    # Assert
    assert result is None
