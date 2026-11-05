from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from inspect import unwrap
from types import SimpleNamespace
from typing import Any, Literal
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent
from flask import Flask
from pydantic import BaseModel, ValidationError
from pytest_mock import MockerFixture
from redis import Redis
from sqlalchemy import Engine as _app_generator_Engine
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy import select
from sqlalchemy.engine import Engine as _advanced_chat_app_generator_Engine
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.advanced_chat.app_generator as app_generator_module
import core.workflow.nodes.human_input.entities  # noqa: F401
from constants import UUID_NIL
from controllers.service_api.app.completion import ChatApi
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat import app_generator as adv_app_gen_module
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.advanced_chat.generate_task_pipeline import (
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow import app_generator as wf_app_gen_module
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
    UserFrom,
    WorkflowAppGenerateEntity,
)
from core.app.file_access import DatabaseFileAccessController
from core.app.task_pipeline import message_cycle_manager
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.model_manager import ModelInstance
from core.workflow import node_factory as node_factory_module
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_system_variables
from enums import DeploymentEdition
from extensions.application_services.message_branches import resolve_message_history
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from factories import variable_factory
from graphon.engine import Engine as _pause_resume_Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import (
    EngineEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowStartReason
from graphon.entities.base_node_data import BaseNodeData, RetryConfig
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowNodeExecutionStatus
from graphon.graph import Graph
from graphon.node_events import NodeRunResult, PauseRequestedEvent
from graphon.nodes.base.entities import OutputVariableEntity
from graphon.nodes.base.node import Node
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables.input_entities import VariableEntity
from libs.datetime_utils import naive_utc_now
from models import Account as _advanced_chat_app_generator_Account
from models import Workflow as _advanced_chat_app_generator_Workflow
from models.account import Account as _app_generator_Account
from models.account import Account as _pause_resume_Account
from models.enums import ConversationFromSource, EndUserType, MessageStatus
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import ConversationVariable, WorkflowType
from models.workflow import Workflow as _app_generator_Workflow
from models.workflow import Workflow as _pause_resume_Workflow
from services.errors.conversation import ConversationNotExistsError
from services.workflow_run_agg import WorkflowRunAgg
from tasks.app_generate.workflow_execute_task import AppExecutionParams
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.core.message_branch_model import RecordingBranchModel
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import (
    make_app,
    make_conversation,
    make_end_user,
    make_message,
    make_upload_file,
)
from tests.workflow_test_utils import build_test_graph_init_params


class _TraceRecorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


def _trace_scope() -> TraceScope:
    return TraceScope(
        emitter=_TraceRecorder(),
        tenant_id="tenant",
        app_id="app",
        user_id="user-id",
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )


def _record_trace_scope_requests(monkeypatch: pytest.MonkeyPatch, trace_scope: TraceScope) -> list[dict[str, object]]:
    requests: list[dict[str, object]] = []

    def create_trace_scope(**kwargs: object) -> TraceScope:
        requests.append(kwargs)
        return trace_scope

    monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.create_trace_scope", create_trace_scope)
    return requests


def _app_generator_make_app(*, app_id: str = "app", tenant_id: str = "tenant") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Advanced Chat App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _app_generator_make_workflow(
    *,
    workflow_id: str = "workflow-id",
    tenant_id: str = "tenant",
    app_id: str = "app",
    features: dict[str, object] | None = None,
) -> _app_generator_Workflow:
    return _app_generator_Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=_app_generator_Workflow.VERSION_DRAFT,
        graph="{}",
        _features=json.dumps(features or {}),
        created_by="user",
    )


def _app_generator_make_account(*, account_id: str = "user-id") -> _app_generator_Account:
    account = _app_generator_Account(name="Advanced Chat User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_end_user(*, end_user_id: str = "end-user-id", session_id: str = "session-id") -> EndUser:
    return EndUser(
        id=end_user_id,
        tenant_id="tenant",
        app_id="app",
        type=EndUserType.BROWSER,
        session_id=session_id,
    )


def _make_conversation(*, conversation_id: str = "conversation-id", app_id: str = "app") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.ADVANCED_CHAT,
        name="Advanced Chat Conversation",
        _inputs={},
        from_source=ConversationFromSource.API,
    )


def _make_message(
    *, message_id: str = "message-id", conversation_id: str = "conversation-id", app_id: str = "app"
) -> Message:
    message = Message(
        id=message_id,
        app_id=app_id,
        conversation_id=conversation_id,
        _inputs={},
        query="hello",
        message={},
        answer="",
        status=MessageStatus.NORMAL,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    message.created_at = naive_utc_now()
    return message


class TestAdvancedChatAppGeneratorValidation:
    def test_generate_requires_query(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

        with pytest.raises(ValueError, match="query is required"):
            generator.generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                user=_app_generator_make_account(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
                session=unbound_session,
            )

    def test_generate_requires_string_query(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

        with pytest.raises(ValueError, match="query must be a string"):
            generator.generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                user=_app_generator_make_account(),
                args={"inputs": {}, "query": 123},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
                session=unbound_session,
            )

    def test_single_iteration_generate_validates_args(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_iteration_generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                node_id="",
                user=_app_generator_make_account(),
                args={"inputs": {}},
                streaming=False,
                session=unbound_session,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                node_id="node",
                user=_app_generator_make_account(),
                args={},
                streaming=False,
                session=unbound_session,
            )

    def test_single_loop_generate_validates_args(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_loop_generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                node_id="",
                user=_app_generator_make_account(),
                args=SimpleNamespace(inputs={}),
                streaming=False,
                session=unbound_session,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                node_id="node",
                user=_app_generator_make_account(),
                args=SimpleNamespace(inputs=None),
                streaming=False,
                session=unbound_session,
            )


class TestAdvancedChatAppGeneratorInternals:
    @staticmethod
    def _build_app_config() -> WorkflowUIBasedAppConfig:
        return WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

    def test_generate_loads_conversation_and_files(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        app_config = self._build_app_config()

        conversation = _make_conversation()
        built_files: list[object] = []
        build_files_called = {"called": False}
        captured: dict[str, object] = {}
        session = unbound_session
        get_conversation = MagicMock(return_value=conversation)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.ConversationService.get_conversation",
            get_conversation,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
            lambda *args, **kwargs: {"enabled": True},
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.file_factory.build_from_mappings",
            lambda **kwargs: build_files_called.update({"called": True}) or built_files,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )
        monkeypatch.setattr(generator, "_prepare_user_inputs", lambda **kwargs: kwargs["user_inputs"])
        trace_scope = _trace_scope()
        scope_requests = _record_trace_scope_requests(monkeypatch, trace_scope)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        from models import Account

        user = Account(name="Tester", email="tester@example.com")
        user.id = "user-id"

        app_model = _app_generator_make_app()
        app_model.tracing = '{"enabled": true, "tracing_provider": "langfuse"}'

        result = generator.generate(
            app_model=app_model,
            workflow=_app_generator_make_workflow(),
            user=user,
            args={
                "query": "hello",
                "inputs": {"k": "v"},
                "conversation_id": "conversation-id",
                "files": [{"id": "f"}],
                "trace_session_id": "session-1",
            },
            invoke_from=InvokeFrom.WEB_APP,
            workflow_run_id="run-id",
            streaming=False,
            session=session,
        )

        assert result == {"ok": True}
        assert captured["conversation"] is conversation
        assert captured["application_generate_entity"].files == built_files
        assert captured["session"] is session
        assert build_files_called["called"] is True
        assert get_conversation.call_args.kwargs["session"] is session
        application_generate_entity = captured["application_generate_entity"]
        assert isinstance(application_generate_entity, AdvancedChatAppGenerateEntity)
        assert application_generate_entity.trace_scope is trace_scope
        assert scope_requests == [
            {
                "tenant_id": "tenant",
                "app_id": "app",
                "app_tracing": '{"enabled": true, "tracing_provider": "langfuse"}',
                "user_id": "user-id",
                "extras": application_generate_entity.extras,
            }
        ]
        assert application_generate_entity.extras["trace_session_id"] == "session-1"

    def test_resume_delegates_to_generate(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        existing_trace_scope = _trace_scope()
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=existing_trace_scope,
            workflow_run_id="run-id",
        )

        captured_entity: AdvancedChatAppGenerateEntity | None = None
        captured_graph_runtime_state: object | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity, captured_graph_runtime_state
            captured_entity = kwargs["application_generate_entity"]
            captured_graph_runtime_state = kwargs["graph_runtime_state"]
            return SimpleNamespace(resumed=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=_app_generator_make_app(app_id="app-id"),
            workflow=_app_generator_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
            pause_state_config=None,
        )

        assert result.resumed is True
        assert captured_entity is not None
        assert captured_entity.trace_scope is existing_trace_scope
        assert captured_graph_runtime_state is not None

    def test_single_iteration_generate_builds_debug_task(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        draft_sessions: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = _app_generator_make_workflow()
        session = unbound_session

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="execution"),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="node"),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.DraftVarLoader", lambda **kwargs: var_loader)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        class _DraftVarService:
            def __init__(self, session):
                draft_sessions.append(session)

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_iteration_generate(
            app_model=_app_generator_make_app(),
            workflow=workflow,
            node_id="node-1",
            user=_app_generator_make_account(),
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
            session=session,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert draft_sessions == [session]
        assert captured["variable_loader"] is var_loader
        assert captured["session"] is session
        assert captured["application_generate_entity"].single_iteration_run.node_id == "node-1"
        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

    def test_single_loop_generate_builds_debug_task(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        draft_sessions: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = _app_generator_make_workflow()
        session = unbound_session

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="execution"),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="node"),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.DraftVarLoader", lambda **kwargs: var_loader)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        class _DraftVarService:
            def __init__(self, session):
                draft_sessions.append(session)

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_loop_generate(
            app_model=_app_generator_make_app(),
            workflow=workflow,
            node_id="node-2",
            user=_app_generator_make_account(),
            args=SimpleNamespace(inputs={"foo": "bar"}, trace_session_id="session-1"),
            streaming=False,
            session=session,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert draft_sessions == [session]
        assert captured["variable_loader"] is var_loader
        assert captured["session"] is session
        assert captured["application_generate_entity"].single_loop_run.node_id == "node-2"
        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

    def test_generate_internal_flow_initial_conversation_with_pause_layer(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 0
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        app = _app_generator_make_app()
        workflow = _app_generator_make_workflow(workflow_id="wf-1", features={"feature": True})
        conversation = _make_conversation(conversation_id="conv-1")
        message = _make_message(message_id="msg-1", conversation_id=conversation.id)
        sqlite_session.add_all([app, workflow, conversation, message])
        sqlite_session.commit()
        commit_count = 0

        def _record_commit(session: Session) -> None:
            nonlocal commit_count
            commit_count += 1

        sqlalchemy_event.listen(sqlite_session, "after_commit", _record_commit)
        captured: dict[str, object] = {}
        thread_data: dict[str, object] = {}
        init_records = MagicMock(return_value=(conversation, message))
        get_thread_messages_length = MagicMock(return_value=2)

        monkeypatch.setattr(generator, "_init_generate_records", init_records)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.get_thread_messages_length", get_thread_messages_length
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.MessageBasedAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.contextvars.copy_context", lambda: "ctx")

        class _Thread:
            def __init__(self, *, target, kwargs):
                thread_data["target"] = target
                thread_data["kwargs"] = kwargs

            def start(self):
                thread_data["started"] = True

            def join(self, timeout):
                thread_data["joined"] = True
                thread_data["join_timeout"] = timeout

            def is_alive(self):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")
        monkeypatch.setattr(
            generator,
            "_handle_advanced_chat_response",
            lambda **kwargs: captured.update(kwargs) or {"raw": True},
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateResponseConverter.convert",
            lambda response, invoke_from: {"response": response, "invoke_from": invoke_from},
        )

        pause_state_config = SimpleNamespace(session_factory="session-factory", state_owner_user_id="owner")

        response = generator._generate(
            workflow=workflow,
            user=_app_generator_make_account(account_id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            session=sqlite_session,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=None,
            message=None,
            stream=False,
            pause_state_config=pause_state_config,
        )

        assert response["response"] == {"raw": True}
        assert thread_data["started"] is True
        assert thread_data["joined"] is True
        assert thread_data["join_timeout"] == 300
        assert thread_data["kwargs"]["pause_state_config"] is pause_state_config
        assert generator._dialogue_count == 3
        assert init_records.call_args.kwargs["session"] is sqlite_session
        get_thread_messages_length.assert_called_once_with(conversation.id, session=sqlite_session)
        assert commit_count == 1
        assert json.loads(conversation.override_model_configs) == {"feature": True}
        assert captured["draft_var_saver_factory"] == "draft-factory"
        assert isinstance(captured["workflow"], WorkflowSnapshot)
        assert isinstance(captured["conversation"], ConversationSnapshot)
        assert isinstance(captured["message"], MessageSnapshot)

    def test_generate_internal_flow_with_existing_records_skips_init(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 0
        app_config = self._build_app_config()
        default_file = make_upload_file(tenant_id=app_config.tenant_id)
        app_config.variables = [
            VariableEntity.model_validate(
                {
                    "type": "file",
                    "variable": "file",
                    "label": "File",
                    "default": {"transfer_method": "local_file", "upload_file_id": default_file.id},
                }
            )
        ]
        file_runtime = DifyWorkflowFileRuntime(file_access_controller=DatabaseFileAccessController())
        monkeypatch.setattr(file_runtime, "_secret_key", lambda: b"test-key")

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        app = _app_generator_make_app()
        workflow = _app_generator_make_workflow(workflow_id="wf-2")
        conversation = _make_conversation(conversation_id="conv-2")
        message = _make_message(message_id="msg-2", conversation_id=conversation.id)
        sqlite_session.add_all([app, workflow, conversation, message, default_file])
        sqlite_session.commit()
        commit_count = 0

        def _record_commit(session: Session) -> None:
            nonlocal commit_count
            commit_count += 1

        sqlalchemy_event.listen(sqlite_session, "after_commit", _record_commit)
        init_records = MagicMock()
        get_thread_messages_length = MagicMock(return_value=0)
        thread_data: dict[str, object] = {}

        monkeypatch.setattr(generator, "_init_generate_records", init_records)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.get_thread_messages_length", get_thread_messages_length
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.MessageBasedAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )

        class _Thread:
            def __init__(self, *, target, kwargs):
                thread_data["target"] = target
                thread_data["kwargs"] = kwargs

            def start(self):
                thread_data["started"] = True

            def join(self, timeout):
                thread_data["joined"] = True
                thread_data["join_timeout"] = timeout

            def is_alive(self):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")

        def handle_response(**kwargs):
            assert file_runtime.resolve_upload_file_uri(upload_file_id=default_file.id).startswith(
                f"/files/{default_file.id}/file-preview?"
            )
            return {"raw": True}

        monkeypatch.setattr(generator, "_handle_advanced_chat_response", handle_response)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateResponseConverter.convert",
            lambda response, invoke_from: response,
        )

        response = generator._generate(
            workflow=workflow,
            user=_make_end_user(end_user_id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            session=sqlite_session,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        assert response == {"raw": True}
        init_records.assert_not_called()
        get_thread_messages_length.assert_called_once_with(conversation.id, session=sqlite_session)
        assert thread_data["started"] is True
        assert thread_data["joined"] is True
        assert thread_data["join_timeout"] == 300
        assert commit_count == 0
        assert (
            thread_data["kwargs"]["context"]
            .run(file_runtime.resolve_upload_file_uri, upload_file_id=default_file.id)
            .startswith(f"/files/{default_file.id}/file-preview?")
        )

    def test_generate_worker_raises_when_workflow_not_found(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )

        with pytest.raises(ValueError, match="Workflow not found"):
            generator._generate_worker(
                flask_app=SimpleNamespace(),
                application_generate_entity=application_generate_entity,
                queue_manager=MagicMock(),
                conversation_id="conv",
                message_id="msg",
                context=SimpleNamespace(),
                variable_loader=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
                graph_runtime_state=None,
            )

    def test_generate_worker_raises_when_app_not_found_for_internal_call(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add(_app_generator_make_workflow())
        sqlite_session.commit()

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )

        with pytest.raises(ValueError, match="App not found"):
            generator._generate_worker(
                flask_app=SimpleNamespace(),
                application_generate_entity=application_generate_entity,
                queue_manager=MagicMock(),
                conversation_id="conv",
                message_id="msg",
                context=SimpleNamespace(),
                variable_loader=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
                graph_runtime_state=None,
            )

    def test_generate_worker_handles_stopped_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        queue_manager = MagicMock()
        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        sqlite_session.add_all([_app_generator_make_app(), _app_generator_make_workflow()])
        sqlite_session.commit()

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def prepare(self):
                raise GenerateTaskStoppedError()

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
        restore_workflow_run_graph = MagicMock()
        monkeypatch.setattr(generator, "_restore_workflow_run_graph", restore_workflow_run_graph)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )

        generator._generate_worker(
            flask_app=SimpleNamespace(),
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            context=SimpleNamespace(),
            variable_loader=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        queue_manager.publish_error.assert_not_called()
        assert restore_workflow_run_graph.call_args.kwargs["workflow"].id == "workflow-id"
        assert restore_workflow_run_graph.call_args.kwargs["workflow_run_id"] == "run-id"

    def test_generate_worker_handles_validation_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        class _ValidationModel(BaseModel):
            value: int

        try:
            _ValidationModel(value="invalid")
        except ValidationError as error:
            validation_error = error
        else:
            raise AssertionError("validation error should be created")

        queue_manager = MagicMock()
        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add_all([_app_generator_make_app(), _app_generator_make_workflow()])
        sqlite_session.commit()

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def prepare(self):
                raise validation_error

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )

        generator._generate_worker(
            flask_app=SimpleNamespace(),
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            context=SimpleNamespace(),
            variable_loader=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=None,
        )

        queue_manager.publish_error.assert_called_once()

    def test_generate_worker_handles_value_and_unknown_errors(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        app_config = self._build_app_config()
        sqlite_session.add_all([_app_generator_make_app(), _app_generator_make_workflow()])
        sqlite_session.commit()

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        def _make_runner(error: Exception):
            class _Runner:
                def __init__(self, **kwargs):
                    _ = kwargs

                def prepare(self):
                    raise error

            return _Runner

        for raised_error in [ValueError("bad input"), RuntimeError("unexpected")]:
            generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
            generator._dialogue_count = 1
            application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
                task_id="task",
                app_config=app_config,
                inputs={},
                query="hello",
                files=[],
                user_id="internal-user",
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                extras={},
                trace_scope=None,
                workflow_run_id="run-id",
            )

            queue_manager = MagicMock()
            generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
            generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

            monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)
            monkeypatch.setattr(
                "core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner",
                _make_runner(raised_error),
            )
            apply_config_overrides(monkeypatch, DEBUG=True)
            monkeypatch.setattr(
                "core.app.apps.advanced_chat.app_generator.db",
                SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
            )

            generator._generate_worker(
                flask_app=SimpleNamespace(),
                application_generate_entity=application_generate_entity,
                queue_manager=queue_manager,
                conversation_id="conv",
                message_id="msg",
                context=SimpleNamespace(),
                variable_loader=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
                graph_runtime_state=None,
            )

            queue_manager.publish_error.assert_called_once()

    def test_handle_response_closed_file_raises_stopped(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        class _Pipeline:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def process(self):
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_advanced_chat_response(
                application_generate_entity=application_generate_entity,
                workflow=WorkflowSnapshot(id="wf", tenant_id="tenant", features_dict={}),
                queue_manager=SimpleNamespace(),
                conversation=ConversationSnapshot(id="conv", mode=AppMode.ADVANCED_CHAT),
                message=MessageSnapshot(
                    id="msg",
                    query="hello",
                    created_at=naive_utc_now(),
                    status=MessageStatus.NORMAL,
                    answer="",
                ),
                user=_app_generator_make_account(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

    def test_handle_response_re_raises_value_error(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1
        app_config = self._build_app_config()
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        class _Pipeline:
            def __init__(self, **kwargs):
                _ = kwargs

            def process(self):
                raise ValueError("other error")

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateTaskPipeline", _Pipeline)

        with caplog.at_level(logging.ERROR, logger="core.app.apps.advanced_chat.app_generator"):
            with pytest.raises(ValueError, match="other error"):
                generator._handle_advanced_chat_response(
                    application_generate_entity=application_generate_entity,
                    workflow=WorkflowSnapshot(id="wf", tenant_id="tenant", features_dict={}),
                    queue_manager=SimpleNamespace(),
                    conversation=ConversationSnapshot(id="conv", mode=AppMode.ADVANCED_CHAT),
                    message=MessageSnapshot(
                        id="msg",
                        query="hello",
                        created_at=naive_utc_now(),
                        status=MessageStatus.NORMAL,
                        answer="",
                    ),
                    user=_app_generator_make_account(),
                    draft_var_saver_factory=lambda **kwargs: None,
                    stream=False,
                )

        assert "Failed to process generate task pipeline, conversation_id: conv" in caplog.messages

    def test_generate_worker_handles_invoke_auth_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator._dialogue_count = 1

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="end-user-id",
            stream=False,
            invoke_from=InvokeFrom.SERVICE_API,
            extras={},
            trace_scope=None,
            workflow_run_id="run-id",
        )

        queue_manager = MagicMock()

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add_all([_app_generator_make_app(), _app_generator_make_workflow(), _make_end_user()])
        sqlite_session.commit()

        class _Runner:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def prepare(self):
                from graphon.model_runtime.errors.invoke import InvokeAuthorizationError

                raise InvokeAuthorizationError("bad key")

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)

        @contextmanager
        def _fake_context[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
        )

        generator._generate_worker(
            flask_app=SimpleNamespace(),
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            context=SimpleNamespace(),
            variable_loader=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=None,
        )

        assert queue_manager.publish_error.called

    def test_generate_debugger_enables_retrieve_source(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: _app_generator_Engine
    ):
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda app_model, workflow: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
            lambda features_dict, is_vision=False: None,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        captured = {}

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        app_model = _app_generator_make_app()
        workflow = _app_generator_make_workflow()
        user = _app_generator_make_account(account_id="user")

        result = generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            args={"query": "hello\x00", "inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_run_id="run-id",
            streaming=False,
            session=unbound_session,
        )

        assert result == {"ok": True}
        assert app_config.additional_features.show_retrieve_source is True
        assert captured["application_generate_entity"].query == "hello"

    def test_service_api_explicit_parent_requires_admission_adapter(self, unbound_session: Session) -> None:
        """An unconfigured internal caller cannot bypass explicit branch admission."""
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        with pytest.raises(ValueError, match="selection is not configured"):
            generator.generate(
                app_model=_app_generator_make_app(),
                workflow=_app_generator_make_workflow(),
                user=_make_end_user(),
                args={"query": "hello", "inputs": {}, "parent_message_id": "p1"},
                invoke_from=InvokeFrom.SERVICE_API,
                workflow_run_id="run-id",
                streaming=False,
                session=unbound_session,
            )


class TestAdvancedChatAppGeneratorResume:
    @staticmethod
    def _build_app_config() -> WorkflowUIBasedAppConfig:
        return WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

    def test_resume_recreates_trace_scope_when_missing(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ) -> None:
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={"trace_session_id": "session-1"},
            trace_scope=None,
            workflow_run_id="run-id",
        )
        trace_scope = _trace_scope()
        scope_requests = _record_trace_scope_requests(monkeypatch, trace_scope)
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)
        app_model = _app_generator_make_app(app_id="app-id")
        app_model.tracing = '{"enabled": true, "tracing_provider": "langfuse"}'

        result = generator.resume(
            app_model=app_model,
            workflow=_app_generator_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_scope is trace_scope
        assert scope_requests == [
            {
                "tenant_id": "tenant",
                "app_id": "app-id",
                "app_tracing": '{"enabled": true, "tracing_provider": "langfuse"}',
                "user_id": "session-id",
                "extras": {"trace_session_id": "session-1"},
            }
        ]

    def test_resume_preserves_existing_trace_scope(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ) -> None:
        generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
        existing_trace_scope = _trace_scope()
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_scope=existing_trace_scope,
            workflow_run_id="run-id",
        )
        scope_requests = _record_trace_scope_requests(monkeypatch, _trace_scope())
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=_app_generator_make_app(app_id="app-id"),
            workflow=_app_generator_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_scope is existing_trace_scope
        assert scope_requests == []


def _make_app_config() -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_generate_entity(app_config: WorkflowUIBasedAppConfig) -> AdvancedChatAppGenerateEntity:
    return AdvancedChatAppGenerateEntity(
        task_id="task-id",
        app_config=app_config,
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query="hello",
        files=[],
        parent_message_id=None,
        user_id="user-id",
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        workflow_run_id="workflow-run-id",
    )


def _app() -> App:
    return App(
        id="app-id",
        tenant_id="tenant-id",
        name="Advanced chat app",
        description="",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _workflow() -> _advanced_chat_app_generator_Workflow:
    return _advanced_chat_app_generator_Workflow.new(
        tenant_id="tenant-id",
        app_id="app-id",
        type="chat",
        version=_advanced_chat_app_generator_Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="user-id",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _account() -> _advanced_chat_app_generator_Account:
    account = _advanced_chat_app_generator_Account(name="User", email="user@example.com")
    account.id = "user-id"
    return account


def test_init_generate_records_sets_conversation_metadata(sqlite_session: Session):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)

    generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
    )

    assert entity.conversation_id == conversation.id
    assert conversation.id is not None
    assert entity.is_new_conversation is True


def test_init_generate_records_marks_existing_conversation(sqlite_session: Session):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)

    existing_conversation = Conversation(
        app_id=app_config.app_id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=app_config.app_mode.value,
        name="existing",
        _inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.WEB_APP.value,
        from_source=ConversationFromSource.API,
        from_end_user_id="user-id",
        from_account_id=None,
    )
    existing_conversation.id = "existing-conversation-id"
    sqlite_session.add(existing_conversation)
    sqlite_session.flush()

    generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=existing_conversation,
        session=sqlite_session,
    )

    assert entity.conversation_id == "existing-conversation-id"
    assert conversation is existing_conversation
    assert entity.is_new_conversation is False


def test_generate_falls_back_to_new_conversation_when_conversation_missing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: _advanced_chat_app_generator_Engine,
    sqlite_session: Session,
):
    app_config = _make_app_config()
    workflow = _workflow()
    app_model = _app()
    user = _account()

    def raise_conversation_not_exists(**_kwargs):
        raise ConversationNotExistsError()

    monkeypatch.setattr(
        "core.app.apps.advanced_chat.app_generator.ConversationService.get_conversation",
        raise_conversation_not_exists,
    )
    monkeypatch.setattr(
        "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
        lambda **_kwargs: app_config,
    )
    monkeypatch.setattr(app_generator_module, "db", SimpleNamespace(engine=sqlite_engine))
    trace_scope = TraceScope(
        emitter=_TraceRecorder(),
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )
    scope_requests: list[dict[str, object]] = []

    def create_trace_scope(**kwargs: object) -> TraceScope:
        scope_requests.append(kwargs)
        return trace_scope

    monkeypatch.setattr(app_generator_module, "create_trace_scope", create_trace_scope)
    monkeypatch.setattr(
        "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        lambda **_kwargs: SimpleNamespace(),
    )
    monkeypatch.setattr(
        "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        lambda **_kwargs: SimpleNamespace(),
    )

    captured: dict[str, object] = {}
    session = sqlite_session

    def fake_generate(self, **kwargs):
        captured.update(kwargs)
        return {"status": "ok"}

    monkeypatch.setattr(AdvancedChatAppGenerator, "_generate", fake_generate)

    result = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run).generate(
        app_model=app_model,
        workflow=workflow,
        user=user,
        args={"inputs": {}, "query": "hello", "conversation_id": "missing-conversation-id"},
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_run_id="workflow-run-id",
        streaming=False,
        session=session,
    )

    assert result == {"status": "ok"}
    assert captured["conversation"] is None
    assert captured["session"] is session
    application_generate_entity = captured["application_generate_entity"]
    assert isinstance(application_generate_entity, AdvancedChatAppGenerateEntity)
    assert application_generate_entity.conversation_id is None
    assert application_generate_entity.trace_scope is trace_scope
    assert scope_requests == [
        {
            "tenant_id": "tenant-id",
            "app_id": "app-id",
            "app_tracing": None,
            "user_id": "user-id",
            "extras": application_generate_entity.extras,
        }
    ]


def test_message_cycle_manager_uses_new_conversation_flag(monkeypatch: pytest.MonkeyPatch):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)
    entity.conversation_id = "existing-conversation-id"
    entity.is_new_conversation = True
    entity.extras = {"auto_generate_conversation_name": True}

    captured = {}

    class DummyThread:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.started = False

        def start(self):
            self.started = True

    def fake_thread[**P](*args: P.args, **kwargs: P.kwargs):
        thread = DummyThread(**kwargs)
        captured["thread"] = thread
        return thread

    monkeypatch.setattr(message_cycle_manager, "Timer", fake_thread)

    manager = MessageCycleManager(application_generate_entity=entity, task_state=MagicMock())
    thread = manager.generate_conversation_name(conversation_id="existing-conversation-id", query="hello")

    assert thread is captured["thread"]
    assert thread.started is True
    assert entity.is_new_conversation is False


class _StubToolNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.TOOL
    pause_on: bool = False


class _StubToolNode(Node[_StubToolNodeData]):
    node_type = BuiltinNodeTypes.TOOL

    @classmethod
    def version(cls) -> str:
        return "1"

    def __init__(
        self,
        node_id: str,
        data: _StubToolNodeData,
        *,
        init_params,
        runtime_state,
        **_kwargs: Any,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )

    def _get_error_strategy(self):
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self):
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    def _run(self):
        if self.node_data.pause_on:
            yield PauseRequestedEvent(reason=SchedulingPause(message="test pause"))
            return

        result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={"value": f"{self.id}-done"},
        )
        yield self._convert_node_run_result_to_node_event(result)


def _patch_tool_node(mocker: MockerFixture):
    original_resolve_node_class = node_factory_module.resolve_workflow_node_class

    def _patched_resolve_node_class(
        *,
        node_type: NodeType,
        node_version: str,
        node_data: Mapping[str, Any] | BaseNodeData | None = None,
    ) -> type[Node]:
        if node_type == BuiltinNodeTypes.TOOL:
            return _StubToolNode
        return original_resolve_node_class(
            node_type=node_type,
            node_version=node_version,
            node_data=node_data,
        )

    mocker.patch.object(node_factory_module, "resolve_workflow_node_class", side_effect=_patched_resolve_node_class)


def _node_data(node_type: NodeType, data: BaseNodeData) -> dict[str, object]:
    node_data = data.model_dump()
    node_data["type"] = str(node_type)
    return node_data


def _build_graph_config(*, pause_on: str | None) -> dict[str, object]:
    start_data = StartNodeData(title="start", variables=[])
    tool_data_a = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_a")
    tool_data_b = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_b")
    tool_data_c = _StubToolNodeData(title="tool", pause_on=pause_on == "tool_c")
    end_data = EndNodeData(
        title="end",
        outputs=[OutputVariableEntity(variable="result", value_selector=["tool_c", "value"])],
        desc=None,
    )

    nodes = [
        {"id": "start", "data": _node_data(BuiltinNodeTypes.START, start_data)},
        {"id": "tool_a", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_a)},
        {"id": "tool_b", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_b)},
        {"id": "tool_c", "data": _node_data(BuiltinNodeTypes.TOOL, tool_data_c)},
        {"id": "end", "data": _node_data(BuiltinNodeTypes.END, end_data)},
    ]
    edges = [
        {"source": "start", "target": "tool_a"},
        {"source": "tool_a", "target": "tool_b"},
        {"source": "tool_b", "target": "tool_c"},
        {"source": "tool_c", "target": "end"},
    ]
    return {"nodes": nodes, "edges": edges}


def _build_graph(runtime_state: RuntimeState, *, pause_on: str | None) -> Graph:
    graph_config = _build_graph_config(pause_on=pause_on)
    params = build_test_graph_init_params(
        workflow_id="workflow",
        graph_config=graph_config,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from="account",
        invoke_from="service-api",
        call_depth=0,
    )

    node_factory = DifyNodeFactory(
        init_params=params,
        runtime_state=runtime_state,
    )

    return Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")


def _build_runtime_state(run_id: str) -> RuntimeState:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="user", app_id="app", workflow_id="workflow"),
        user_inputs={},
        conversation_variables=[],
    )
    variable_pool.add(("sys", "workflow_run_id"), run_id)
    return RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=time.perf_counter())


def _pause_resume_make_app() -> App:
    return App(
        id="app",
        tenant_id="tenant",
        name="Pause Resume App",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
    )


def _pause_resume_make_workflow() -> _pause_resume_Workflow:
    return _pause_resume_Workflow(
        id="workflow",
        tenant_id="tenant",
        app_id="app",
        type=WorkflowType.CHAT,
        version=_pause_resume_Workflow.VERSION_DRAFT,
        graph="{}",
        _features="{}",
        created_by="user",
    )


def _pause_resume_make_account() -> _pause_resume_Account:
    account = _pause_resume_Account(name="Pause Resume User", email="pause@example.com")
    account.id = "user"
    return account


def _pause_resume_make_conversation() -> Conversation:
    return Conversation(
        id="conv",
        app_id="app",
        mode=AppMode.ADVANCED_CHAT,
        name="Pause Resume Conversation",
        _inputs={},
        from_source=ConversationFromSource.API,
    )


def _pause_resume_make_message() -> Message:
    return Message(
        id="msg",
        app_id="app",
        conversation_id="conv",
        _inputs={},
        query="query",
        message={},
        answer="answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )


def _pause_resume_make_app_config(app_mode: AppMode) -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(tenant_id="tenant", app_id="app", app_mode=app_mode, workflow_id="workflow")


def _make_workflow_generate_entity() -> WorkflowAppGenerateEntity:
    """A deserialized paused entity: its trace scope is not persisted."""
    return WorkflowAppGenerateEntity(
        task_id="task",
        app_config=_pause_resume_make_app_config(AppMode.WORKFLOW),
        inputs={},
        files=[],
        user_id="user",
        user_from=UserFrom.END_USER,
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id="paused-run",
    )


def _make_advanced_chat_generate_entity() -> AdvancedChatAppGenerateEntity:
    """A deserialized paused entity: its trace scope is not persisted."""
    return AdvancedChatAppGenerateEntity(
        task_id="task",
        app_config=_pause_resume_make_app_config(AppMode.ADVANCED_CHAT),
        conversation_id="conv",
        inputs={},
        query="query",
        files=[],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_run_id="adv-paused",
    )


def _run_with_optional_pause(runtime_state: RuntimeState, *, pause_on: str | None) -> list[EngineEvent]:
    command_channel = InMemoryChannel()
    graph = _build_graph(runtime_state, pause_on=pause_on)
    engine = _pause_resume_Engine(
        graph=graph,
        runtime_state=runtime_state,
        command_channel=command_channel,
    )

    events: list[EngineEvent] = []
    for event in engine.run():
        events.append(event)
    return events


def _node_successes(events: list[EngineEvent]) -> list[str]:
    return [evt.node_id for evt in events if isinstance(evt, NodeRunSucceededEvent)]


def test_workflow_app_pause_resume_matches_baseline(mocker: MockerFixture):
    _patch_tool_node(mocker)

    baseline_state = _build_runtime_state("baseline")
    baseline_events = _run_with_optional_pause(baseline_state, pause_on=None)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_nodes = _node_successes(baseline_events)
    baseline_outputs = baseline_state.outputs

    paused_state = _build_runtime_state("paused-run")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    paused_nodes = _node_successes(paused_events)
    snapshot = paused_state.dumps()

    resumed_state = RuntimeState.from_snapshot(snapshot)

    generator = wf_app_gen_module.WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)

    def _fake_generate(**kwargs):
        state: RuntimeState = kwargs["graph_runtime_state"]
        events = _run_with_optional_pause(state, pause_on=None)
        return _node_successes(events)

    mocker.patch.object(generator, "_generate", side_effect=_fake_generate)

    resumed_nodes = generator.resume(
        app_model=_pause_resume_make_app(),
        workflow=_pause_resume_make_workflow(),
        user=_pause_resume_make_account(),
        application_generate_entity=_make_workflow_generate_entity(),
        graph_runtime_state=resumed_state,
        workflow_execution_repository=SimpleNamespace(),
        workflow_node_execution_repository=SimpleNamespace(),
    )

    assert paused_nodes + resumed_nodes == baseline_nodes
    assert resumed_state.outputs == baseline_outputs


def test_advanced_chat_pause_resume_matches_baseline(mocker: MockerFixture, unbound_session: Session):
    _patch_tool_node(mocker)

    baseline_state = _build_runtime_state("adv-baseline")
    baseline_events = _run_with_optional_pause(baseline_state, pause_on=None)
    assert isinstance(baseline_events[-1], GraphRunSucceededEvent)
    baseline_nodes = _node_successes(baseline_events)
    baseline_outputs = baseline_state.outputs

    paused_state = _build_runtime_state("adv-paused")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    assert isinstance(paused_events[-1], GraphRunPausedEvent)
    paused_nodes = _node_successes(paused_events)
    snapshot = paused_state.dumps()

    resumed_state = RuntimeState.from_snapshot(snapshot)

    generator = adv_app_gen_module.AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)

    def _fake_generate(**kwargs):
        state: RuntimeState = kwargs["graph_runtime_state"]
        events = _run_with_optional_pause(state, pause_on=None)
        return _node_successes(events)

    mocker.patch.object(generator, "_generate", side_effect=_fake_generate)

    resumed_nodes = generator.resume(
        app_model=_pause_resume_make_app(),
        workflow=_pause_resume_make_workflow(),
        user=_pause_resume_make_account(),
        conversation=_pause_resume_make_conversation(),
        message=_pause_resume_make_message(),
        session=unbound_session,
        application_generate_entity=_make_advanced_chat_generate_entity(),
        workflow_execution_repository=SimpleNamespace(),
        workflow_node_execution_repository=SimpleNamespace(),
        graph_runtime_state=resumed_state,
    )

    assert paused_nodes + resumed_nodes == baseline_nodes
    assert resumed_state.outputs == baseline_outputs


def test_resume_emits_resumption_start_reason(mocker: MockerFixture) -> None:
    _patch_tool_node(mocker)

    paused_state = _build_runtime_state("resume-reason")
    paused_events = _run_with_optional_pause(paused_state, pause_on="tool_a")
    initial_start = next(event for event in paused_events if isinstance(event, GraphRunStartedEvent))
    assert initial_start.reason == WorkflowStartReason.INITIAL

    resumed_state = RuntimeState.from_snapshot(paused_state.dumps())
    resumed_events = _run_with_optional_pause(resumed_state, pause_on=None)
    resume_start = next(event for event in resumed_events if isinstance(event, GraphRunStartedEvent))
    assert resume_start.reason == WorkflowStartReason.RESUMPTION


@pytest.mark.parametrize(
    ("streaming", "parent_index", "fail"),
    [
        (False, None, False),
        (False, 0, False),
        (False, 1, False),
        (True, None, False),
        (True, 0, False),
        (True, 1, False),
        (False, "omitted", False),
        (True, "omitted", False),
        (True, 0, True),
    ],
)
def test_service_api_branch_runs_real_graph_with_only_selected_model_history(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: _app_generator_Engine,
    monkeypatch: pytest.MonkeyPatch,
    parent_index: int | None | Literal["omitted"],
    streaming: bool,
    fail: bool,
) -> None:
    """API/blocking and serialized worker/SSE paths invoke the actual graph and model.

    Only provider configuration is supplied in-process. Controllers, admission,
    repositories, record creation, runner, node factory, memory, graph execution
    and response conversion remain real; no Celery broker is started locally.
    """
    if not hasattr(os, "register_at_fork"):

        def register_without_fork(*, after_in_child: Callable[[], None]) -> None:
            """Windows has no fork; this test runs the graph in threads only."""
            return None

        monkeypatch.setattr(os, "register_at_fork", register_without_fork, raising=False)
    app_record = make_app(
        app_id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.ADVANCED_CHAT, workflow_id=str(uuid4())
    )
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=app_record.tenant_id,
        app_id=app_record.id,
        end_user_type=EndUserType.SERVICE_API,
    )
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=app_record.id,
        mode=AppMode.ADVANCED_CHAT,
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        is_deleted=False,
    )
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "llm",
                "data": {
                    "type": "llm",
                    "title": "LLM",
                    "model": {"provider": "recording", "name": "branch-test", "mode": "chat", "completion_params": {}},
                    "prompt_template": [{"role": "system", "text": "State: {{#conversation.state#}}"}],
                    "context": {"enabled": False, "variable_selector": []},
                    "vision": {"enabled": False},
                    "memory": {"window": {"enabled": True, "size": 20}, "query_prompt_template": "{{#sys.query#}}"},
                },
            },
            {"id": "answer", "data": {"type": "answer", "title": "Answer", "answer": "{{#llm.text#}}"}},
        ],
        "edges": [{"source": "start", "target": "llm"}, {"source": "llm", "target": "answer"}],
    }
    workflow = _app_generator_make_workflow(
        workflow_id=app_record.workflow_id or str(uuid4()), tenant_id=app_record.tenant_id, app_id=app_record.id
    )
    workflow.version = "1"
    workflow.graph = json.dumps(graph)
    variable_id = str(uuid4())
    variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": variable_id, "name": "state", "value_type": "string", "value": "default-state"}
    )
    workflow.conversation_variables = [variable]
    current = variable_factory.build_conversation_variable_from_mapping(
        {"id": variable_id, "name": "state", "value_type": "string", "value": "current-state"}
    )
    current_variable = ConversationVariable.from_variable(
        app_id=app_record.id, conversation_id=conversation.id, variable=current
    )
    old = [
        make_message(
            message_id=str(uuid4()),
            app_id=app_record.id,
            conversation_id=conversation.id,
            query=f"old query {i}",
            answer=f"old answer {i}",
            inputs={},
            message={},
            answer_tokens=1,
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            created_at=datetime(2026, 1, 1) + timedelta(seconds=i),
        )
        for i in range(3)
    ]
    for i, message in enumerate(old):
        message.parent_message_id = old[i - 1].id if i else None
    with sqlite_session_factory.begin() as session:
        session.add_all([app_record, end_user, conversation, workflow, current_variable, *old])
    config = make_model_config(provider="recording", model="branch-test", mode="chat")
    provider = RecordingBranchModel(
        provider_schema=config.provider_model_bundle.configuration.provider,
        model_runtime=config.provider_model_bundle.model_type_instance.model_runtime,
    )
    config.provider_model_bundle.model_type_instance = provider
    provider.fail = fail
    model = ModelInstance(provider_model_bundle=config.provider_model_bundle, model="branch-test", credentials={})

    def recording_model_config(
        *,
        node_data_model: object,
        credentials_provider: object,
        model_factory: object,
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """Resolve the test provider at the credential boundary without network I/O."""
        return model, config

    monkeypatch.setattr(node_factory_module, "fetch_model_config", recording_model_config)
    flask_app = Flask(__name__)
    flask_app.config.update(SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url), SECRET_KEY="branch-unit-test")
    db.init_app(flask_app)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    parent = old[parent_index].id if isinstance(parent_index, int) else None
    payload = {
        "query": "edited question",
        "inputs": {},
        "conversation_id": conversation.id,
        "parent_message_id": parent,
        "response_mode": "streaming" if streaming else "blocking",
        "user": "test-user",
    }
    if parent_index == "omitted":
        payload.pop("parent_message_id")
    try:
        with flask_app.test_request_context(json=payload):
            flask_app.extensions["application_services"] = build_application_services(
                database_client=sqlite_session_factory,
                deployment_edition=DeploymentEdition.COMMUNITY,
                initialization_password="",
                redis=redis,
            )
            with sqlite_session_factory() as session:
                if streaming:
                    args = dict(payload)
                    if parent_index != "omitted":
                        history = resolve_message_history(
                            app=app_record,
                            workflow=workflow,
                            end_user_id=end_user.id,
                            conversation_id=conversation.id,
                            parent_message_id=parent,
                        )
                        args["message_history"] = history.model_dump(mode="json")
                    queued = AppExecutionParams.new(
                        app_model=app_record,
                        workflow=workflow,
                        user=end_user,
                        args=args,
                        invoke_from=InvokeFrom.SERVICE_API,
                        streaming=True,
                    )
                    restored = AppExecutionParams.model_validate_json(queued.model_dump_json())
                    result = AdvancedChatAppGenerator(
                        execution_driver=WorkflowRunAgg.run,
                        message_history_resolver=resolve_message_history,
                    ).generate(
                        app_model=app_record,
                        workflow=workflow,
                        user=end_user,
                        args=restored.args,
                        invoke_from=restored.invoke_from,
                        workflow_run_id=restored.workflow_run_id,
                        streaming=True,
                        session=session,
                    )
                    chunks = list(result)
                    terminal = "error" if fail else "message_end"
                    assert any(isinstance(chunk, Mapping) and chunk.get("event") == terminal for chunk in chunks)
                else:
                    result = unwrap(ChatApi.post)(ChatApi(), session=session, app_model=app_record, end_user=end_user)
                    assert result.get_json()["answer"] == "new answer"
            texts = [message.content for message in provider.recorded]
            assert "State: current-state" in texts
            assert "edited question" in texts
            assert ("old query 1" in texts) == (parent_index in (1, "omitted"))
            assert ("old query 2" in texts) == (parent_index == "omitted")
            assert ("old query 0" in texts) == (parent_index in (0, 1, "omitted"))
            with sqlite_session_factory() as session:
                saved = list(session.scalars(select(Message).where(Message.conversation_id == conversation.id)))
                generated = [message for message in saved if message.id not in {message.id for message in old}]
                assert len(generated) == 1
                assert generated[0].parent_message_id == (UUID_NIL if parent_index == "omitted" else parent)
                assert generated[0].answer == ("" if fail else "new answer")
                assert {(message.query, message.answer) for message in saved if message.id in {m.id for m in old}} == {
                    (message.query, message.answer) for message in old
                }
                generated_id = generated[0].id
            if not fail and parent_index != "omitted":
                with (
                    flask_app.test_request_context(
                        json={
                            **payload,
                            "query": "follow question",
                            "parent_message_id": generated_id,
                            "response_mode": "blocking",
                        }
                    ),
                    sqlite_session_factory() as session,
                ):
                    followed = unwrap(ChatApi.post)(ChatApi(), session=session, app_model=app_record, end_user=end_user)
                    assert followed.get_json()["answer"] == "new answer"
                follow_texts = [message.content for message in provider.recorded]
                assert "edited question" in follow_texts
                assert "follow question" in follow_texts
                assert "old query 2" not in follow_texts
    finally:
        redis_client.close()
        with flask_app.app_context():
            db.session.remove()
            db.engine.dispose()
