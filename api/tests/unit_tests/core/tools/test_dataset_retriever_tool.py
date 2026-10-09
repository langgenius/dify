"""Dataset tools query injected records and preserve their dependencies when forked."""

from dataclasses import dataclass, field
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from models.dataset import Dataset, Document
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from services.tools.dataset.tool import DatasetRetrieverTool
from tests.unit_tests.model_factories import make_dataset


@dataclass
class Retrieval:
    calls: list = field(default_factory=list)

    def retrieve_dataset(self, **kwargs):
        self.calls.append(kwargs)
        return f"result:{kwargs['query']}"


class NoResources:
    def return_retriever_resource_info(self, _resources):
        raise AssertionError("unexpected resources")


@pytest.fixture
def dataset_tools(sqlite_session: Session, sqlite_session_factory):
    dataset_id = str(uuid4())
    sqlite_session.add(
        make_dataset(dataset_id=dataset_id, tenant_id="tenant", provider="external", description="one\ntwo")
    )
    sqlite_session.commit()
    retrieval = Retrieval()
    config = DatasetRetrieveConfigEntity(retrieve_strategy="multiple")
    tools = DatasetRetrieverTool.get_dataset_tools(
        records=KnowledgeRetrievalRepository(sqlite_session_factory),
        retrieval=lambda: retrieval,
        tenant_id="tenant",
        app_id="app",
        dataset_ids=[dataset_id],
        retrieve_config=config,
        return_resource=True,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=NoResources(),
        user_id="user",
        inputs={"x": 1},
    )
    return tools, retrieval, config


def test_tool_metadata_and_fork_preserve_injected_retrieval(dataset_tools, unbound_session: Session):
    tools, retrieval, config = dataset_tools
    assert len(tools) == 1
    tool = tools[0]
    assert tool.entity.description.llm == "onetwo"
    assert [parameter.name for parameter in tool.get_runtime_parameters()] == ["query"]
    assert config.retrieve_strategy == "multiple"
    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant"))
    result = list(forked.invoke(session=unbound_session, user_id="user", tool_parameters={"query": "hello"}))
    assert result[0].message.text == "result:hello"
    assert retrieval.calls[0]["inputs"] == {"x": 1}
    assert retrieval.calls[0]["app_id"] == "app"


def test_empty_query_does_not_start_retrieval(dataset_tools, unbound_session: Session):
    tools, retrieval, _ = dataset_tools
    assert list(tools[0].invoke(session=unbound_session, user_id="user", tool_parameters={}))[0].message.text == (
        "please input query"
    )
    assert not retrieval.calls


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
@pytest.mark.parametrize("case", ["no-datasets", "no-config", "foreign-tenant"])
def test_tool_preparation_rejects_unavailable_datasets(sqlite_session, sqlite_session_factory, case):
    sqlite_session.add(make_dataset(dataset_id="dataset", tenant_id="other", provider="external"))
    sqlite_session.commit()
    result = DatasetRetrieverTool.get_dataset_tools(
        records=KnowledgeRetrievalRepository(sqlite_session_factory),
        retrieval=Retrieval,
        tenant_id="tenant",
        app_id="app",
        dataset_ids=[] if case == "no-datasets" else ["dataset"],
        retrieve_config=None if case == "no-config" else DatasetRetrieveConfigEntity(retrieve_strategy="single"),
        return_resource=False,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=NoResources(),
        user_id="user",
        inputs={},
    )
    assert result == []
