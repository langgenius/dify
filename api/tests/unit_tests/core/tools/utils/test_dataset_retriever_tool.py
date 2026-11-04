"""Unit tests for DatasetRetrieverTool behavior and retrieval wiring."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.tools.utils.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool as RetrievalTool
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool
from models.model import AppMode


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
    return DatasetIndexToolCallbackHandler(
        queue_manager=queue_manager, app_id="app", message_id="message", user_id="u", invoke_from=InvokeFrom.DEBUGGER
    )


def _retrieval_tool() -> RetrievalTool:
    return RetrievalTool(
        name="dataset_tool",
        description="desc",
        tenant_id="tenant",
        dataset_id="d1",
        retrieve_config=_retrieve_config(),
        inputs={},
        return_resource=False,
        retriever_from="dev",
    )


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_dataset_tools_returns_empty_for_empty_dataset_ids(sqlite_session: Session) -> None:
    # Arrange
    retrieve_config = _retrieve_config()

    # Act
    tools = DatasetRetrieverTool.get_dataset_tools(
        session=sqlite_session,
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


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_dataset_tools_returns_empty_for_missing_retrieve_config(sqlite_session: Session) -> None:
    # Arrange
    dataset_ids = ["d1"]

    # Act
    tools = DatasetRetrieverTool.get_dataset_tools(
        session=sqlite_session,
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


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_dataset_tools_builds_tool_and_restores_strategy(sqlite_session: Session) -> None:
    # Arrange
    retrieve_config = _retrieve_config()
    retrieval_tool = _retrieval_tool()

    # Act
    with patch.object(DatasetRetrieval, "to_dataset_retriever_tool", return_value=[retrieval_tool]):
        tools = DatasetRetrieverTool.get_dataset_tools(
            session=sqlite_session,
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
    assert tools[0].entity.identity.name == "dataset_tool"
    assert retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE


def _build_dataset_tool(sqlite_session: Session) -> tuple[DatasetRetrieverTool, RetrievalTool]:
    retrieval_tool = _retrieval_tool()
    with patch.object(DatasetRetrieval, "to_dataset_retriever_tool", return_value=[retrieval_tool]):
        tools = DatasetRetrieverTool.get_dataset_tools(
            session=sqlite_session,
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=_retrieve_config(),
            return_resource=False,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=_hit_callback(),
            user_id="u",
            inputs={},
        )
    return tools[0], retrieval_tool


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_runtime_parameters_shape(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool(sqlite_session)

    # Act
    params = tool.get_runtime_parameters()

    # Assert
    assert len(params) == 1
    assert params[0].name == "query"


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_empty_query_behavior(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool(sqlite_session)

    # Act
    empty_query = list(tool.invoke(session=sqlite_session, user_id="u", tool_parameters={}))

    # Assert
    assert len(empty_query) == 1
    assert empty_query[0].message.text == "please input query"


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_query_invocation_result(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool(sqlite_session)

    # Act
    with patch.object(RetrievalTool, "_run", return_value="result:hello") as retrieve:
        result = list(tool.invoke(session=sqlite_session, user_id="u", tool_parameters={"query": "hello"}))

    # Assert
    assert len(result) == 1
    assert result[0].message.text == "result:hello"
    retrieve.assert_called_once_with(sqlite_session, "hello")


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_validate_credentials(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool(sqlite_session)

    # Act
    result = tool.validate_credentials(credentials={}, parameters={}, format_only=False)

    # Assert
    assert result is None
