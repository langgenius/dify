"""Agent log retrieval through production composition and an isolated database."""

import json
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal
from typing import Literal, TypedDict
from uuid import uuid4

import pytest
from flask import has_app_context
from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.db import session_factory
from core.tools.entities.tool_entities import ApiProviderSchemaType
from extensions.application_services.agent import build_agent_app_services
from graphon.file import FileTransferMethod, FileType
from machinery.context import RequestContext
from models.account import Account
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType, MessageFileBelongsTo
from models.model import (
    App,
    AppAnnotationSetting,
    AppMode,
    AppModelConfig,
    Conversation,
    EndUser,
    Message,
    MessageAgentThought,
    MessageFile,
    UploadFile,
)
from models.tools import ApiToolProvider, ToolFile
from services.agent.log_contracts import AgentLogAppNotFoundError, AgentLogConfigurationError, AgentLogNotFoundError
from services.agent.log_service import AgentLogService
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message, make_upload_file

CONTEXT = RequestContext("request", None, "viewer", "tenant")

type AgentLogStore = tuple[sessionmaker[Session], AgentLogService]


class AgentToolCall(TypedDict):
    status: str
    error: object | None
    time_cost: float | int
    tool_name: str
    tool_label: str
    tool_input: object
    tool_output: object
    tool_parameters: dict[str, object]
    tool_icon: object


class AgentIteration(TypedDict):
    tokens: int
    tool_calls: list[AgentToolCall]
    tool_raw: dict[str, object]
    thought: str | None
    created_at: str
    files: list[object]


class AgentLogMeta(TypedDict):
    status: str
    executor: str
    start_time: str
    elapsed_time: float
    total_tokens: int
    agent_mode: str
    iterations: int


class AgentLogResult(TypedDict):
    meta: AgentLogMeta
    iterations: list[AgentIteration]
    files: list[dict[str, object]]


@pytest.fixture(autouse=True)
def _provide_app_context() -> None:
    """This application use case must work without Flask or current_user."""


@pytest.fixture
def store(
    monkeypatch: pytest.MonkeyPatch, workflow_variables: WorkflowExecutionVariables
) -> Iterator[AgentLogStore]:
    engine = create_engine("sqlite://", poolclass=QueuePool)
    tables: list[Table] = []
    for model in (
        App,
        Account,
        Conversation,
        Message,
        AppModelConfig,
        MessageAgentThought,
        MessageFile,
        UploadFile,
        ToolFile,
        ApiToolProvider,
        AppAnnotationSetting,
        EndUser,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        tables.append(table)
    TypeBase.metadata.create_all(
        engine,
        tables=tables,
    )
    sessions = sessionmaker(engine, expire_on_commit=False)

    def reject_global(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Agent logs accessed a global database or user")

    monkeypatch.setattr(session_factory, "create_session", reject_global)
    from extensions.ext_database import db

    monkeypatch.setattr(db, "session", reject_global)
    monkeypatch.setattr(type(db), "engine", property(reject_global))
    with sessions.begin() as session:
        account = make_account(account_id="viewer", timezone="Asia/Shanghai", name="Viewer")
        config = AppModelConfig(
            app_id="app",
            model=json.dumps({"provider": "openai", "name": "gpt", "mode": "chat"}),
            agent_mode=json.dumps(
                {
                    "enabled": True,
                    "strategy": "react",
                    "tools": [
                        {"enabled": True, "provider_type": "api", "provider_id": "provider", "tool_name": "search"}
                    ],
                }
            ),
        )
        session.add_all([account, config])
        session.flush()
        session.add(make_app(app_id="app", tenant_id="tenant", mode=AppMode.AGENT_CHAT, app_model_config_id=config.id))
        session.add(
            make_conversation(
                conversation_id="conversation",
                app_id="app",
                from_account_id="viewer",
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
            )
        )
        session.add(
            make_message(
                message_id="message",
                app_id="app",
                conversation_id="conversation",
                inputs={},
                query="Hi",
                message={},
                answer="Hello",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id="viewer",
                message_tokens=7,
                answer_tokens=3,
                created_at=datetime(2024, 1, 1),
                provider_response_latency=1.5,
            )
        )
        provider = ApiToolProvider(
            tenant_id="tenant",
            user_id="viewer",
            name="api",
            description="Search",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            icon='{"content":"S","background":"#000"}',
            tools_str="[]",
            credentials_str="{}",
        )
        provider.id = "provider"
        session.add(provider)
        session.add(
            MessageAgentThought(
                message_id="message",
                position=1,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="viewer",
                thought="Search first",
                tool="search",
                tool_labels_str='{"search":"Search"}',
                tokens=10,
                tool_meta_str='{"search":{"tool_parameters":{"limit":3},"time_cost":1.2}}',
                tool_input='{"query":"test"}',
                observation='{"result":"found"}',
                message_files='["generated-file"]',
            )
        )
    service = build_agent_app_services(database_client=sessions, variables=workflow_variables).logs
    try:
        yield sessions, service
    finally:
        engine.dispose()


def get_log(service: AgentLogService, context: RequestContext = CONTEXT, **kwargs: str) -> AgentLogResult:
    result = service.get(
        context, **{"app_id": "app", "conversation_id": "conversation", "message_id": "message", **kwargs}
    )
    return AgentLogResult(meta=result["meta"], iterations=result["iterations"], files=result["files"])


def test_log_uses_loaded_timezone_configuration_and_tool_metadata(store: AgentLogStore) -> None:
    assert not has_app_context()
    sessions, service = store
    result = get_log(service)
    assert result["meta"] == {
        "status": "success",
        "executor": "Viewer",
        "start_time": "2024-01-01T08:00:00+08:00",
        "elapsed_time": 1.5,
        "total_tokens": 10,
        "agent_mode": "react",
        "iterations": 1,
    }
    thought = result["iterations"][0]
    assert thought["tokens"] == 10
    assert thought["files"] == ["generated-file"]
    assert thought["tool_calls"] == [
        {
            "status": "success",
            "error": None,
            "time_cost": 1.2,
            "tool_name": "search",
            "tool_label": "Search",
            "tool_input": {"query": "test"},
            "tool_output": {"result": "found"},
            "tool_parameters": {"limit": 3},
            "tool_icon": {"content": "S", "background": "#000"},
        }
    ]
    assert sessions.kw["bind"].pool.checkedout() == 0


@pytest.mark.parametrize("failure", ["workspace", "mode", "conversation", "message", "config"])
def test_log_enforces_complete_owner_chain(
    store: AgentLogStore,
    failure: Literal["workspace", "mode", "conversation", "message", "config"],
) -> None:
    sessions, service = store
    context = CONTEXT
    with sessions.begin() as session:
        if failure == "workspace":
            context = CONTEXT._replace(active_workspace_id="foreign")
        elif failure == "mode":
            app = session.get(App, "app")
            assert app is not None
            app.mode = AppMode.WORKFLOW
        elif failure == "conversation":
            conversation = session.get(Conversation, "conversation")
            assert conversation is not None
            conversation.app_id = "another-app"
        elif failure == "message":
            message = session.get(Message, "message")
            assert message is not None
            message.app_id = "another-app"
        else:
            app = session.get(App, "app")
            assert app is not None
            app.app_model_config_id = None
    error = (
        AgentLogAppNotFoundError
        if failure in {"workspace", "mode"}
        else (AgentLogConfigurationError if failure == "config" else AgentLogNotFoundError)
    )
    with pytest.raises(error):
        get_log(service, context)


@pytest.mark.parametrize(
    "file_type", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL, FileTransferMethod.TOOL_FILE]
)
def test_log_releases_read_transaction_before_file_processing(
    store: AgentLogStore, monkeypatch: pytest.MonkeyPatch, file_type: FileTransferMethod
) -> None:
    sessions, service = store
    remote_calls: list[str] = []

    def remote_info(url: str) -> tuple[str, str, int]:
        assert sessions.kw["bind"].pool.checkedout() == 0
        remote_calls.append(url)
        return "text/plain", "remote.txt", 42

    monkeypatch.setattr("factories.file_factory.builders.get_remote_file_info", remote_info)
    with sessions.begin() as session:
        reference = str(uuid4())
        if file_type == FileTransferMethod.LOCAL_FILE:
            session.add(make_upload_file(file_id=reference, tenant_id="tenant", name="local.txt"))
        elif file_type == FileTransferMethod.TOOL_FILE:
            tool_file = ToolFile(
                user_id="viewer",
                tenant_id="tenant",
                conversation_id="conversation",
                file_key="generated/result.txt",
                mimetype="text/plain",
                name="result.txt",
                size=15,
            )
            tool_file.id = reference
            session.add(tool_file)
        session.add(
            MessageFile(
                message_id="message",
                type=FileType.DOCUMENT,
                transfer_method=file_type,
                url="https://example.com/remote.txt"
                if file_type == FileTransferMethod.REMOTE_URL
                else f"/files/tools/{reference}.txt",
                upload_file_id=reference if file_type == FileTransferMethod.LOCAL_FILE else None,
                belongs_to=MessageFileBelongsTo.USER,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="viewer",
            )
        )
    result = get_log(service)
    assert (
        result["files"][0]["filename"]
        == {
            FileTransferMethod.LOCAL_FILE: "local.txt",
            FileTransferMethod.REMOTE_URL: "remote.txt",
            FileTransferMethod.TOOL_FILE: "result.txt",
        }[file_type]
    )
    assert result["files"][0]["belongs_to"] == "user"
    assert len(remote_calls) == (1 if file_type == FileTransferMethod.REMOTE_URL else 0)
    assert sessions.kw["bind"].pool.checkedout() == 0
    with sessions() as session:
        file = session.scalar(select(MessageFile))
        if file_type == FileTransferMethod.TOOL_FILE:
            assert file is not None
            assert file.upload_file_id is None  # Viewing a log does not rewrite attachment records.


def test_log_handles_missing_executor_and_malformed_thought_metadata(store: AgentLogStore) -> None:
    sessions, service = store
    with sessions.begin() as session:
        conversation = session.get(Conversation, "conversation")
        assert conversation is not None
        conversation.from_account_id = "deleted"
        thought = session.scalar(select(MessageAgentThought))
        assert thought is not None
        thought.tool_labels_str = thought.tool_meta_str = thought.tool_input = thought.observation = "invalid-json"
    result = get_log(service)
    assert result["meta"]["executor"] == "Unknown"
    tool = result["iterations"][0]["tool_calls"][0]
    assert tool["tool_label"] == "search"
    assert tool["tool_input"] == {}
    assert tool["tool_output"] == "invalid-json"


@pytest.mark.parametrize("tenant_id", ["tenant", "foreign"])
def test_log_resolves_end_user_inside_workspace(store: AgentLogStore, tenant_id: Literal["tenant", "foreign"]) -> None:
    sessions, service = store
    with sessions.begin() as session:
        user = EndUser(
            tenant_id=tenant_id, app_id="app", name="Customer", type=EndUserType.SERVICE_API, session_id="session"
        )
        session.add(user)
        session.flush()
        conversation = session.get(Conversation, "conversation")
        assert conversation is not None
        conversation.from_account_id = None
        conversation.from_end_user_id = user.id
    assert get_log(service)["meta"]["executor"] == ("Customer" if tenant_id == "tenant" else "Unknown")


def test_log_preserves_tool_errors_and_empty_iterations(store: AgentLogStore) -> None:
    sessions, service = store
    with sessions.begin() as session:
        thought = session.scalar(select(MessageAgentThought))
        assert thought is not None
        thought.tool_meta_str = '{"search":{"error":"Remote unavailable","time_cost":2}}'
        thought.tokens = None
    result = get_log(service)
    assert result["iterations"][0]["tokens"] == 0
    tool = result["iterations"][0]["tool_calls"][0]
    assert (tool["status"], tool["error"], tool["time_cost"]) == ("error", "Remote unavailable", 2)
    with sessions.begin() as session:
        thought = session.scalar(select(MessageAgentThought))
        assert thought is not None
        session.delete(thought)
    result = get_log(service)
    assert result["meta"]["iterations"] == 0
    assert result["iterations"] == []


def test_log_rejects_disabled_agent_configuration(store: AgentLogStore) -> None:
    sessions, service = store
    with sessions.begin() as session:
        config = session.scalar(select(AppModelConfig))
        assert config is not None
        config.agent_mode = '{"enabled":false}'
    with pytest.raises(AgentLogConfigurationError, match="Agent config not found"):
        get_log(service)
