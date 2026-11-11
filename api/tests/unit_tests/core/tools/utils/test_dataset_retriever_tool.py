"""Dataset tools query injected records and preserve their dependencies when forked."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TypedDict, override
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import DatasetRetrieveConfigEntity, ModelConfig
from core.app.entities.app_invoke_entities import EasyUIBasedAppGenerateEntity, InvokeFrom
from core.rag.entities import MetadataFilteringCondition, RetrievalSourceMetadata
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest, Source
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.dataset import Dataset, Document
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler
from services.tools.dataset.tool import DatasetRetrieverTool
from tests.helpers.unit.model_factories import make_dataset


class RetrievalCall(TypedDict):
    tenant_id: str
    app_id: str
    user_id: str
    dataset_id: str
    query: str
    config: DatasetRetrieveConfigEntity
    top_k: int
    inputs: dict[str, object]
    invoke_from: InvokeFrom
    return_resource: bool
    hit_callback: DatasetIndexToolCallbackHandler


@dataclass
class Retrieval:
    calls: list[RetrievalCall] = field(default_factory=list)

    @property
    def llm_usage(self) -> LLMUsage:
        return LLMUsage.empty_usage()

    def set_request_metadata(self, request_metadata: Mapping[str, object] | None) -> None:
        del request_metadata

    def knowledge_retrieval(self, request: KnowledgeRetrievalRequest) -> list[Source]:
        raise AssertionError(f"unexpected knowledge retrieval: {request}")

    def get_metadata_filter_condition(
        self,
        dataset_ids: list[str],
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_filtering_mode: str,
        metadata_model_config: ModelConfig | None,
        metadata_filtering_conditions: MetadataFilteringCondition | None,
        inputs: dict[str, object],
    ) -> tuple[dict[str, list[str]] | None, MetadataFilteringCondition | None]:
        raise AssertionError(
            "unexpected metadata filtering: "
            f"{dataset_ids}, {query}, {tenant_id}, {user_id}, {metadata_filtering_mode}, "
            f"{metadata_model_config}, {metadata_filtering_conditions}, {inputs}"
        )

    def retrieve_dataset(
        self,
        *,
        tenant_id: str,
        app_id: str,
        user_id: str,
        dataset_id: str,
        query: str,
        config: DatasetRetrieveConfigEntity,
        top_k: int,
        inputs: dict[str, object],
        invoke_from: InvokeFrom,
        return_resource: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
    ) -> str:
        self.calls.append(
            RetrievalCall(
                tenant_id=tenant_id,
                app_id=app_id,
                user_id=user_id,
                dataset_id=dataset_id,
                query=query,
                config=config,
                top_k=top_k,
                inputs=inputs,
                invoke_from=invoke_from,
                return_resource=return_resource,
                hit_callback=hit_callback,
            )
        )
        return f"result:{query}"


class NoResources(DatasetIndexToolCallbackHandler):
    def __init__(self) -> None:
        pass

    @override
    def return_retriever_resource_info(self, resource: Sequence[RetrievalSourceMetadata]) -> None:
        del resource
        raise AssertionError("unexpected resources")


@dataclass(frozen=True)
class RetrievalFactory:
    retrieval: Retrieval

    def __call__(self, application_generate_entity: EasyUIBasedAppGenerateEntity | None = None) -> Retrieval:
        del application_generate_entity
        return self.retrieval


type DatasetTools = tuple[
    list[DatasetRetrieverTool],
    Retrieval,
    DatasetRetrieveConfigEntity,
    str,
    NoResources,
]


@pytest.fixture
def dataset_tools(sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]) -> DatasetTools:
    dataset_id = str(uuid4())
    sqlite_session.add(
        make_dataset(dataset_id=dataset_id, tenant_id="tenant", provider="external", description="one\ntwo")
    )
    sqlite_session.commit()
    retrieval = Retrieval()
    callback = NoResources()
    config = DatasetRetrieveConfigEntity(retrieve_strategy="multiple")
    tools = DatasetRetrieverTool.get_dataset_tools(
        records=KnowledgeRetrievalRepository(sqlite_session_factory),
        retrieval=RetrievalFactory(retrieval),
        tenant_id="tenant",
        app_id="app",
        dataset_ids=[dataset_id],
        retrieve_config=config,
        return_resource=True,
        invoke_from=InvokeFrom.DEBUGGER,
        hit_callback=callback,
        user_id="user",
        inputs={"x": 1},
    )
    return tools, retrieval, config, dataset_id, callback


def test_tool_metadata_and_fork_preserve_injected_retrieval(
    dataset_tools: DatasetTools, unbound_session: Session
) -> None:
    tools, retrieval, config, dataset_id, callback = dataset_tools
    assert len(tools) == 1
    tool = tools[0]
    assert tool.entity.description is not None
    assert tool.entity.description.llm == "onetwo"
    assert [parameter.name for parameter in tool.get_runtime_parameters()] == ["query"]
    assert config.retrieve_strategy == "multiple"
    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant"))
    result = list(forked.invoke(session=unbound_session, user_id="user", tool_parameters={"query": "hello"}))
    assert isinstance(result[0].message, ToolInvokeMessage.TextMessage)
    assert result[0].message.text == "result:hello"
    assert retrieval.calls == [
        {
            "tenant_id": "tenant",
            "app_id": "app",
            "user_id": "user",
            "dataset_id": dataset_id,
            "query": "hello",
            "config": config,
            "top_k": 2,
            "inputs": {"x": 1},
            "invoke_from": InvokeFrom.DEBUGGER,
            "return_resource": True,
            "hit_callback": callback,
        }
    ]


def test_empty_query_does_not_start_retrieval(dataset_tools: DatasetTools, unbound_session: Session) -> None:
    tools, retrieval, _, _, _ = dataset_tools
    messages = list(tools[0].invoke(session=unbound_session, user_id="user", tool_parameters={}))
    assert isinstance(messages[0].message, ToolInvokeMessage.TextMessage)
    assert messages[0].message.text == "please input query"
    assert not retrieval.calls


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
@pytest.mark.parametrize("case", ["no-datasets", "no-config", "foreign-tenant"])
def test_tool_preparation_rejects_unavailable_datasets(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], case: str
) -> None:
    sqlite_session.add(make_dataset(dataset_id="dataset", tenant_id="other", provider="external"))
    sqlite_session.commit()
    result = DatasetRetrieverTool.get_dataset_tools(
        records=KnowledgeRetrievalRepository(sqlite_session_factory),
        retrieval=RetrievalFactory(Retrieval()),
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
