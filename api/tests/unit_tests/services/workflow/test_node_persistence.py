"""Node creation and execution must use the injected database and release read transactions."""

from collections.abc import Generator, Sequence
from datetime import datetime
from decimal import Decimal
from typing import cast
from unittest.mock import create_autospec
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, grant_retriever_segment_access
from core.datasource.datasource_manager import DatasourceManager
from core.db import session_factory
from core.model_manager import ModelInstance
from core.workflow.nodes.agent.strategy_protocols import ResolvedAgentStrategy
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.system_variables import build_system_variables
from extensions.application_services.workflow import build_workflow_execution_dependencies
from graphon.model_runtime.entities import PromptMessage, PromptMessageTool
from graphon.nodes.llm.entities import LLMNodeData
from graphon.runtime import GraphRuntimeState, VariablePool
from models.base import TypeBase
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import ConversationFromSource
from models.model import App, Conversation, Message, MessageFile, UploadFile
from models.oauth import DatasourceProvider
from services.workflow.execution.adapters.node_factory import DifyNodeFactory
from tests.unit_tests.model_factories import (
    make_app,
    make_conversation,
    make_dataset,
    make_document,
    make_message,
    make_upload_file,
)
from tests.workflow_test_utils import build_test_graph_init_params


@pytest.fixture
def databases(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    engines: list[Engine] = [create_engine("sqlite://", poolclass=QueuePool) for _ in range(2)]
    tables = cast(
        list[Table],
        [
            model.__table__
            for model in (
                App,
                Conversation,
                Message,
                MessageFile,
                Dataset,
                Document,
                DocumentSegment,
                SegmentAttachmentBinding,
                UploadFile,
                DatasourceProvider,
            )
        ],
    )
    for engine in engines:
        TypeBase.metadata.create_all(engine, tables=tables)
    session_makers: list[sessionmaker[Session]] = [sessionmaker(engine, expire_on_commit=False) for engine in engines]
    injected, global_sessions = session_makers

    def reject_global(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Node queried the global database")

    event.listen(engines[1], "before_cursor_execute", reject_global)
    from extensions.ext_database import db

    monkeypatch.setattr(type(db), "engine", property(lambda _db: engines[1]))
    monkeypatch.setattr(session_factory, "create_session", global_sessions)
    try:
        yield injected
    finally:
        for engine in engines:
            engine.dispose()


def factory(
    sessions: sessionmaker[Session],
    *,
    app_id: str = "app",
    rebind: bool = False,
    **system_variables: object,
) -> DifyNodeFactory:
    runtime = build_workflow_execution_dependencies(sessions)
    state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(system_variables=build_system_variables(system_variables)),
        start_at=0,
    )
    result = DifyNodeFactory(
        graph_init_params=build_test_graph_init_params(app_id=app_id),
        graph_runtime_state=state,
        workflow_runtime=runtime,
    )
    return result.with_runtime_state(state) if rebind else result


def llm_data() -> LLMNodeData:
    return LLMNodeData.model_validate(
        {
            "type": "llm",
            "title": "LLM",
            "model": {
                "provider": "provider",
                "name": "model",
                "mode": "chat",
                "completion_params": {},
            },
            "prompt_template": [],
            "memory": {"window": {"enabled": True, "size": 5}},
            "context": {"enabled": False},
            "vision": {"enabled": False},
        }
    )


@pytest.mark.parametrize("rebind", [False, True])
@pytest.mark.parametrize("app_id", ["app", "other-app"])
def test_node_memory_reads_injected_history_and_releases_before_token_count(
    databases: sessionmaker[Session], rebind: bool, app_id: str
) -> None:
    sessions = databases
    with sessions.begin() as session:
        session.add(make_app(app_id="app", tenant_id="tenant"))
        session.add(
            make_conversation(
                conversation_id="conversation", app_id="app", inputs={}, from_source=ConversationFromSource.CONSOLE
            )
        )
        session.add(
            make_message(
                message_id="message",
                app_id="app",
                conversation_id="conversation",
                inputs={},
                query="hello",
                answer="world",
                answer_tokens=1,
                message={},
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
            )
        )
    calls: list[Sequence[PromptMessage]] = []

    def count_tokens(
        prompt_messages: Sequence[PromptMessage],
        tools: Sequence[PromptMessageTool] | None = None,
    ) -> int:
        _ = tools
        assert sessions.kw["bind"].pool.checkedout() == 0
        calls.append(prompt_messages)
        return 2

    model_mock = create_autospec(ModelInstance, instance=True, spec_set=True)
    model_mock.get_llm_num_tokens.side_effect = count_tokens
    model = cast(ModelInstance, model_mock)

    memory = factory(sessions, app_id=app_id, rebind=rebind, conversation_id="conversation")._build_memory_for_llm_node(
        node_data=llm_data(),
        model_instance=model,
    )
    assert memory is not None
    messages = memory.get_history_prompt_messages()
    assert [message.content for message in messages] == (["hello", "world"] if app_id == "app" else [])
    assert len(calls) == (1 if app_id == "app" else 0)
    assert sessions.kw["bind"].pool.checkedout() == 0


def seed_attachment(
    sessions: sessionmaker[Session], *, upload_tenant: str = "tenant", binding_dataset: str = "dataset"
) -> tuple[str, str]:
    segment_id, upload_id = str(uuid4()), str(uuid4())
    with sessions.begin() as session:
        session.add(make_dataset(dataset_id="dataset", tenant_id="tenant"))
        session.add(make_document(document_id="document", tenant_id="tenant", dataset_id="dataset"))
        segment = DocumentSegment(
            tenant_id="tenant",
            dataset_id="dataset",
            document_id="document",
            position=1,
            content="image",
            word_count=1,
            tokens=1,
            created_by="user",
        )
        segment.id = segment_id
        session.add(segment)
        session.add(
            make_upload_file(
                file_id=upload_id,
                tenant_id=upload_tenant,
                name="diagram.png",
                extension="png",
                mime_type="image/png",
                key="injected-file",
            )
        )
        session.add(
            SegmentAttachmentBinding(
                tenant_id="tenant",
                dataset_id=binding_dataset,
                document_id="document",
                segment_id=segment_id,
                attachment_id=upload_id,
            )
        )
    return segment_id, upload_id


@pytest.mark.parametrize("rebind", [False, True])
@pytest.mark.parametrize("scope", ["valid", "other-tenant", "wrong-dataset", "ungranted", "wrong-context"])
def test_node_attachments_use_injected_owner_chain_without_global_file_lookup(
    databases: sessionmaker[Session], rebind: bool, scope: str
) -> None:
    segment_id, upload_id = seed_attachment(
        databases,
        upload_tenant="other" if scope == "other-tenant" else "tenant",
        binding_dataset="other" if scope == "wrong-dataset" else "dataset",
    )
    node_factory = factory(databases, rebind=rebind)
    statements = []
    event.listen(databases.kw["bind"], "before_cursor_execute", lambda *args: statements.append(args[2]))
    access = FileAccessScope(
        tenant_id="tenant", user_id="visitor", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.WEB_APP
    )
    loader = node_factory._retriever_attachment_loader
    if scope == "wrong-context":
        loader = node_factory._build_retriever_attachment_loader(llm_data())
    with bind_file_access_scope(access):
        if scope != "ungranted":
            grant_retriever_segment_access([segment_id])
        files = loader.load(segment_id=segment_id)
    if scope == "valid":
        assert len(files) == 1
        assert files[0].related_id == upload_id
        assert files[0].storage_key == "injected-file"
        assert files[0].filename == "diagram.png"
    else:
        assert files == []
    if scope in {"ungranted", "wrong-context"}:
        assert statements == []
    assert databases.kw["bind"].pool.checkedout() == 0


def test_datasource_node_reads_injected_credential_before_plugin_stream(
    databases: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with databases.begin() as session:
        record = DatasourceProvider(
            tenant_id="tenant",
            name="auth",
            provider="notion",
            plugin_id="vendor/notion",
            auth_type="api-key",
            encrypted_credentials={"secret": "encrypted"},
        )
        session.add(record)
    calls: list[str] = []

    def decrypt(
        _self: object,
        *,
        tenant_id: str,
        datasource_provider: DatasourceProvider,
        plugin_id: str,
        provider: str,
    ) -> dict[str, str]:
        assert (tenant_id, plugin_id, provider) == ("tenant", "vendor/notion", "notion")
        assert databases.kw["bind"].pool.checkedout() == 0
        assert datasource_provider.id == record.id
        calls.append("decrypt")
        return {"secret": "clear"}

    monkeypatch.setattr(
        "services.data_source.provider_service.DatasourceProviderService.decrypt_datasource_provider_credentials",
        decrypt,
    )
    node = factory(
        databases, datasource_type="online_document", datasource_info={"credential_id": record.id}
    ).create_node(
        {
            "id": "datasource",
            "data": {
                "type": "datasource",
                "title": "Notion",
                "provider_name": "notion",
                "plugin_id": "vendor/notion",
                "provider_type": "online_document",
                "datasource_name": "notion",
            },
        }
    )
    assert isinstance(node, DatasourceNode)

    def get_icon_url(**_kwargs: object) -> str:
        return "icon.svg"

    def stream_node_events(**kwargs: object) -> Generator[object, None, None]:
        assert databases.kw["bind"].pool.checkedout() == 0
        assert kwargs["credentials"] == {"secret": "clear"}
        calls.append("stream")
        yield from ()

    datasource_manager = create_autospec(DatasourceManager, spec_set=True)
    datasource_manager.get_icon_url.side_effect = get_icon_url
    datasource_manager.stream_node_events.side_effect = stream_node_events
    node.datasource_manager = datasource_manager
    assert list(node._run()) == []
    assert calls == ["decrypt", "stream"]


@pytest.mark.parametrize("scope", ["valid", "foreign-tenant", "foreign-app", "absent-conversation"])
def test_agent_model_parameter_memory_uses_injected_history(
    databases: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, scope: str
) -> None:
    from core.agent.plugin_entities import AgentStrategyParameter
    from core.workflow.nodes.agent.entities import AgentNodeData
    from services.workflow.execution.adapters.agent_runtime import AgentRuntimeSupport

    sessions = databases
    with sessions.begin() as session:
        session.add(make_app(app_id="app", tenant_id="tenant"))
        session.add(
            make_conversation(
                conversation_id="conversation", app_id="app", inputs={}, from_source=ConversationFromSource.CONSOLE
            )
        )
        for index in range(2):
            session.add(
                make_message(
                    message_id=f"message-{index}",
                    app_id="app",
                    conversation_id="conversation",
                    created_at=datetime(2026, 1, 1, 0, index),
                    inputs={},
                    query=f"query-{index}",
                    answer=f"answer-{index}",
                    answer_tokens=1,
                    message={},
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
                    currency="USD",
                    from_source=ConversationFromSource.CONSOLE,
                )
            )

    def count_tokens(
        prompt_messages: Sequence[PromptMessage],
        tools: Sequence[PromptMessageTool] | None = None,
    ) -> int:
        _ = tools
        assert sessions.kw["bind"].pool.checkedout() == 0
        return len(prompt_messages)

    model_mock = create_autospec(ModelInstance, instance=True, spec_set=True)
    model_mock.get_llm_num_tokens.side_effect = count_tokens
    model = cast(ModelInstance, model_mock)

    support = AgentRuntimeSupport(workflow_runtime=build_workflow_execution_dependencies(sessions))
    monkeypatch.setattr(support, "fetch_model", lambda **_kwargs: (model, None))
    data = AgentNodeData.model_validate(
        {
            "title": "Agent",
            "memory": {"window": {"enabled": True, "size": 1}},
            "agent_parameters": {"model": {"type": "constant", "value": {"provider": "test", "model": "test"}}},
        }
    )
    parameter = AgentStrategyParameter.model_validate(
        {"name": "model", "type": "model-selector", "label": {"en_US": "Model"}}
    )
    variables = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            conversation_id=None if scope == "absent-conversation" else "conversation"
        )
    )
    strategy: ResolvedAgentStrategy = create_autospec(ResolvedAgentStrategy, instance=True, spec_set=True)
    result = support.build_parameters(
        agent_parameters=[parameter],
        variable_pool=variables,
        node_data=data,
        strategy=strategy,
        tenant_id="foreign" if scope == "foreign-tenant" else "tenant",
        user_id="user",
        app_id="foreign" if scope == "foreign-app" else "app",
        invoke_from=InvokeFrom.DEBUGGER,
    )
    messages = result["model"]["history_prompt_messages"]
    assert [m["content"] for m in messages] == (["query-1", "answer-1"] if scope == "valid" else [])
    assert sessions.kw["bind"].pool.checkedout() == 0
