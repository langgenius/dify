"""Unit tests for DatasetRetrieverTool behavior and retrieval wiring."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool


def _retrieve_config() -> DatasetRetrieveConfigEntity:
    return DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE)


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
        hit_callback=Mock(),
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
        hit_callback=Mock(),
        user_id="u",
        inputs={},
    )

    # Assert
    assert tools == []


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_get_dataset_tools_builds_tool_and_restores_strategy(sqlite_session: Session) -> None:
    # Arrange
    retrieve_config = _retrieve_config()
    retrieval_tool = SimpleNamespace(name="dataset_tool", description="desc", run=lambda query: f"result:{query}")
    feature = Mock()
    feature.to_dataset_retriever_tool.return_value = [retrieval_tool]

    # Act
    with patch("core.tools.utils.dataset_retriever_tool.DatasetRetrieval", return_value=feature):
        tools = DatasetRetrieverTool.get_dataset_tools(
            session=sqlite_session,
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=retrieve_config,
            return_resource=True,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
            user_id="u",
            inputs={"x": 1},
        )

    # Assert
    assert len(tools) == 1
    assert tools[0].entity.identity.name == "dataset_tool"
    assert retrieve_config.retrieve_strategy == DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE


def _build_dataset_tool(sqlite_session: Session) -> tuple[DatasetRetrieverTool, SimpleNamespace]:
    retrieval_tool = SimpleNamespace(
        name="dataset_tool",
        description="desc",
        run=lambda session, query: f"result:{query}",
    )
    feature = Mock()
    feature.to_dataset_retriever_tool.return_value = [retrieval_tool]
    with patch("core.tools.utils.dataset_retriever_tool.DatasetRetrieval", return_value=feature):
        tools = DatasetRetrieverTool.get_dataset_tools(
            session=sqlite_session,
            tenant_id="tenant",
            dataset_ids=["d1"],
            retrieve_config=_retrieve_config(),
            return_resource=False,
            invoke_from=InvokeFrom.DEBUGGER,
            hit_callback=Mock(),
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
    result = list(tool.invoke(session=sqlite_session, user_id="u", tool_parameters={"query": "hello"}))

    # Assert
    assert len(result) == 1
    assert result[0].message.text == "result:hello"


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_validate_credentials(sqlite_session: Session) -> None:
    # Arrange
    tool, _ = _build_dataset_tool(sqlite_session)

    # Act
    result = tool.validate_credentials(credentials={}, parameters={}, format_only=False)

    # Assert
    assert result is None
