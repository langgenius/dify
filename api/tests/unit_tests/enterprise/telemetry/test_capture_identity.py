"""Enterprise identities survive owned app capture and queued delivery."""

import gc
import json
import weakref
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.advanced_chat.app_runner import AdvancedChatAppRunner
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, ChatAppGenerateEntity, InvokeFrom
from core.ops.basic_chat_trace import record_basic_chat_result
from core.ops.completion_trace import record_completion_result
from core.ops.legacy_agent_trace import record_legacy_agent_result
from core.ops.message_trace import MessageTraceRecorder
from core.ops.provider_export import span_attributes
from core.ops.trace_data import CompletedTrace
from core.ops.trace_source import create_message_trace, read_message_trace_fields
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.workflow.file_reference import build_file_reference
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from extensions.storage.storage_type import StorageType
from graphon.engine_events import GraphRunPausedEvent, GraphRunSucceededEvent
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod
from graphon.runtime import RuntimeState
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation, EndUser, Message, MessageAgentThought, UploadFile
from models.workflow import Workflow, WorkflowType
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def create_app_user(
    session: Session, *, name: str, app_mode: AppMode, external_user: bool
) -> tuple[Tenant, App, Account | EndUser]:
    tenant = Tenant(name=name)
    account = Account(name=name, email=f"{uuid4()}@example.com")
    session.add_all([tenant, account])
    session.flush()
    session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
    app_model = App(
        tenant_id=tenant.id,
        name=name,
        mode=app_mode,
        enable_site=True,
        enable_api=True,
        created_by=account.id,
    )
    session.add(app_model)
    session.flush()
    user: Account | EndUser = account
    if external_user:
        user = EndUser(
            tenant_id=tenant.id,
            app_id=app_model.id,
            type=EndUserType.SERVICE_API,
            session_id="alice",
            external_user_id="alice",
        )
        session.add(user)
    session.commit()
    return tenant, app_model, user


@pytest.fixture
def capture_queue(
    app: Flask,
    sqlite_engine: Engine,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> RecordingQueue:
    config_overrides(SECRET_KEY="enterprise-capture-test")
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite_engine))
    monkeypatch.setattr("core.ops.trace_source._enterprise_config", lambda: {"endpoint": "https://collector.example"})
    queue = RecordingQueue()
    monkeypatch.setitem(app.extensions, "ops_trace_queue", queue)
    return queue


@pytest.mark.parametrize("external_user", [False, True])
@pytest.mark.parametrize("include_content", [False, True])
@pytest.mark.parametrize("app_mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT])
def test_owned_message_and_late_retrieval_keep_enterprise_user_ids(
    sqlite_session: Session,
    sqlite_engine: Engine,
    capture_queue: RecordingQueue,
    monkeypatch: pytest.MonkeyPatch,
    external_user: bool,
    include_content: bool,
    app_mode: AppMode,
) -> None:
    monkeypatch.setattr(
        "factories.file_factory.builders.session_factory",
        SimpleNamespace(create_session=lambda: Session(sqlite_engine)),
    )
    owners = [
        create_app_user(sqlite_session, name=f"Owner {index}", app_mode=app_mode, external_user=external_user)
        for index in range(2)
    ]
    record_result = {
        AppMode.CHAT: record_basic_chat_result,
        AppMode.COMPLETION: record_completion_result,
        AppMode.AGENT_CHAT: record_legacy_agent_result,
    }[app_mode]
    messages: list[tuple[MessageTraceRecorder, str]] = []
    expected_users: dict[str, str] = {}
    expected_actors: dict[str, str] = {}
    file_inputs: list[dict[str, object]] = []
    for tenant, app_model, user in owners:
        upload = UploadFile(
            tenant_id=tenant.id,
            storage_type=StorageType.LOCAL,
            key=f"uploads/{tenant.id}/report.txt",
            name=f"Report for {user.id}.txt",
            size=10,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.END_USER if external_user else CreatorUserRole.ACCOUNT,
            created_by=user.id,
            created_at=datetime.now(UTC),
            used=True,
        )
        sqlite_session.add(upload)
        sqlite_session.commit()
        file_input: dict[str, object] = {
            "dify_model_identity": FILE_MODEL_IDENTITY,
            "transfer_method": FileTransferMethod.LOCAL_FILE,
            "reference": build_file_reference(record_id=upload.id),
            "type": "document",
        }
        file_inputs.append(file_input)
        actor_id = user.session_id if isinstance(user, EndUser) else user.id
        recorder = create_message_trace(
            tenant_id=tenant.id,
            app_id=app_model.id,
            user_id=actor_id,
            record_message_result=record_result,
        )
        assert recorder is not None
        entity = ChatAppGenerateEntity.model_construct(
            task_id=str(uuid4()),
            app_config=EasyUIBasedAppConfig(
                tenant_id=tenant.id,
                app_id=app_model.id,
                app_mode=app_mode,
                app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
                app_model_config_dict={},
                model=ModelConfigEntity(provider="provider", model="model", mode="chat"),
                prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
                additional_features=AppAdditionalFeatures(),
            ),
            model_conf=SimpleNamespace(provider="provider", model="model"),
            inputs={"attachment": file_input},
            query="Hello",
            files=[],
            user_id=user.id,
            stream=False,
            invoke_from=InvokeFrom.SERVICE_API if external_user else InvokeFrom.DEBUGGER,
            trace_recorder=recorder,
        )
        _, message = MessageBasedAppGenerator()._init_generate_records(entity, session=sqlite_session)
        message.answer = f"Answer for {user.id}"
        if app_mode == AppMode.AGENT_CHAT:
            sqlite_session.add(
                MessageAgentThought(
                    message_id=message.id,
                    position=1,
                    created_by_role=CreatorUserRole.END_USER if external_user else CreatorUserRole.ACCOUNT,
                    created_by=user.id,
                    message=f"Question for {user.id}",
                    answer=message.answer,
                    latency=0.5,
                    message_token=2,
                    answer_token=3,
                    tokens=5,
                )
            )
        sqlite_session.commit()
        fields = read_message_trace_fields(tenant.id, app_model.id, message.id)
        attachment = fields["original_inputs"]["attachment"]
        assert isinstance(attachment, File)
        assert attachment.filename == upload.name
        user_field = "from_end_user_id" if external_user else "from_account_id"
        assert fields["metadata"][user_field] == user.id
        assert recorder.attributes[user_field] == user.id
        messages.append((recorder, message.id))
        expected_users[tenant.id] = user.id
        expected_actors[tenant.id] = actor_id
        del recorder, entity

    other_tenant, other_app, _ = owners[1]
    with pytest.raises(ValueError, match="Trace message not found"):
        read_message_trace_fields(other_tenant.id, other_app.id, messages[0][1])
    first_message = sqlite_session.get(Message, messages[0][1])
    assert first_message is not None
    first_message.inputs = {"attachment": file_inputs[1]}
    sqlite_session.commit()
    with pytest.raises(ValueError, match="Invalid upload file"):
        read_message_trace_fields(owners[0][0].id, owners[0][1].id, first_message.id)
    first_message.inputs = {"attachment": file_inputs[0]}
    sqlite_session.commit()

    def complete_message(item: tuple[MessageTraceRecorder, str]) -> None:
        recorder, message_id = item
        now = datetime.now(UTC)
        recorder.record_operation(
            "dataset_retrieval",
            span_type="retrieval",
            inputs="first query",
            outputs={"documents": []},
            timer={"start": now, "end": now},
        )
        recorder.record_saved_message(message_id)
        recorder.record_operation(
            "dataset_retrieval",
            span_type="retrieval",
            inputs="late query",
            outputs={"documents": []},
            timer={"start": now, "end": now},
        )

    retained_attribute_bytes = capture_queue.reserved
    assert retained_attribute_bytes > 0
    with ThreadPoolExecutor(max_workers=2) as workers:
        list(workers.map(complete_message, messages))
    assert capture_queue.reserved == retained_attribute_bytes
    recorder_references = [weakref.ref(item[0]) for item in messages]
    del messages
    gc.collect()
    assert all(reference() is None for reference in recorder_references)
    assert capture_queue.reserved == 0
    assert len(capture_queue.items) == 4

    # All owner reads finished before delivery; the exporter only receives bytes.
    monkeypatch.setattr("sqlalchemy.orm.Session", Mock(side_effect=AssertionError("Export must not read records")))
    exported_events: list[tuple[str, str]] = []
    for queued_trace in capture_queue.items:
        trace = CompletedTrace.model_validate_json(queued_trace.trace_json)
        tenant_id = trace.source.tenant_id
        assert trace.source.actor_id == expected_actors[tenant_id]
        assert all(span_attributes(trace, span)["dify.user.id"] == expected_actors[tenant_id] for span in trace.spans)
        if trace.spans[0].span_type == "retrieval":
            assert trace.parent is not None
        else:
            assert trace.spans[-1].parent_span_id == trace.root_span_id
            assert sum(span.span_type == "llm" for span in trace.spans) == 1
        client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
        monkeypatch.setattr(client.otlp, "send_metrics", Mock())
        monkeypatch.setattr(client.otlp, "send_traces", Mock())
        log = Mock()
        monkeypatch.setattr(client.logger, "info", log)
        client.export_trace(trace)
        for call in log.call_args_list:
            fields = call.kwargs["extra"]
            attributes = fields["attributes"]
            event_name = attributes["dify.event.name"]
            assert event_name in {"dify.message.run", "dify.dataset.retrieval"}
            assert fields["tenant_id"] == tenant_id
            assert fields["user_id"] == expected_users[tenant_id]
            assert attributes["gen_ai.user.id"] == expected_users[tenant_id]
            exported_events.append((tenant_id, event_name))
        assert trace.source.actor_id == expected_actors[tenant_id]
    for tenant_id in expected_users:
        assert exported_events.count((tenant_id, "dify.message.run")) == 1
        assert exported_events.count((tenant_id, "dify.dataset.retrieval")) == 2


@pytest.mark.parametrize(
    "operation_type", ["workflow", "node_execution", "tool", "moderation", "suggested_question", "generate_name"]
)
def test_other_enterprise_operations_keep_the_external_actor(operation_type: str) -> None:
    trace = make_completed_trace()
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"actor_id": "alice"})})
    span = trace.spans[0].model_copy(update={"attributes": {"from_end_user_id": str(uuid4())}})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    assert client._attributes(trace, span, operation_type)["gen_ai.user.id"] == "alice"
    assert client._user_id(trace, span, operation_type) == "alice"


def run_chatflow_capture(
    *,
    entity: AdvancedChatAppGenerateEntity,
    app_model: App,
    workflow: Workflow,
    conversation: Conversation,
    message: Message,
    user: Account | EndUser,
    resumed_state: RuntimeState | None = None,
) -> tuple[WorkflowTraceRecorder, RuntimeState]:
    runner = AdvancedChatAppRunner(
        application_generate_entity=entity,
        queue_manager=MagicMock(),
        conversation=conversation,
        message=message,
        dialogue_count=1,
        variable_loader=MagicMock(),
        workflow=workflow,
        system_user_id=user.session_id if isinstance(user, EndUser) else user.id,
        app=app_model,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        workflow_tool_source_repository=MagicMock(),
        graph_runtime_state=resumed_state,
    )
    entry = MagicMock()
    with (
        patch.multiple(
            "core.app.apps.advanced_chat.app_runner",
            WorkflowEntry=entry,
            RedisChannel=MagicMock(),
            attach_stop_aware_ready_queue=Mock(),
        ),
        patch.object(runner, "_init_graph", return_value=MagicMock()),
        patch.object(runner, "_initialize_conversation_variables", return_value=[]),
        patch.object(runner, "handle_input_moderation", return_value=(False, {}, "Hello")),
        patch.object(runner, "handle_annotation_reply", return_value=None),
        patch.object(runner, "_run_workflow", return_value=iter(())),
    ):
        runner.run()
    recorder = entry.call_args.kwargs["workflow_trace"]
    state = entry.call_args.kwargs["graph_runtime_state"]
    assert isinstance(recorder, WorkflowTraceRecorder)
    assert isinstance(state, RuntimeState)
    return recorder, state


@pytest.mark.parametrize("invoke_from", [InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP, InvokeFrom.DEBUGGER])
@pytest.mark.parametrize("resume", [None, "checkpoint", "pre_upgrade"])
def test_chatflow_generator_and_runner_keep_workflow_invocation_labels(
    sqlite_session: Session,
    sqlite_engine: Engine,
    capture_queue: RecordingQueue,
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
    resume: str | None,
) -> None:
    tenant, app_model, user = create_app_user(
        sqlite_session,
        name="Chatflow owner",
        app_mode=AppMode.ADVANCED_CHAT,
        external_user=invoke_from != InvokeFrom.DEBUGGER,
    )
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app_model.id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        created_by=app_model.created_by,
        features="{}",
        graph=json.dumps({"nodes": [{"id": "start", "data": {"type": "start", "title": "Start"}}], "edges": []}),
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()
    monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.db", SimpleNamespace(engine=sqlite_engine))
    generator = AdvancedChatAppGenerator()
    generate = Mock(return_value={})
    monkeypatch.setattr(generator, "_generate", generate)
    generator.generate(
        app_model=app_model,
        workflow=workflow,
        user=user,
        args={"query": "Hello", "inputs": {}},
        invoke_from=invoke_from,
        workflow_run_id=str(uuid4()),
        streaming=False,
        session=sqlite_session,
    )
    entity = cast(AdvancedChatAppGenerateEntity, generate.call_args.kwargs["application_generate_entity"])
    conversation, message = generator._init_generate_records(entity, session=sqlite_session)
    recorder, state = run_chatflow_capture(
        entity=entity, app_model=app_model, workflow=workflow, conversation=conversation, message=message, user=user
    )
    if resume is not None:
        recorder.record_workflow_event(GraphRunPausedEvent())
        pause_state = recorder.save_pause_state()
        entity = AdvancedChatAppGenerateEntity.model_validate_json(entity.model_dump_json())
        entity.workflow_trace_state = pause_state if resume == "checkpoint" else None
        entity.extras["ops_resumed_without_state"] = resume == "pre_upgrade"
        generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            session=sqlite_session,
            application_generate_entity=entity,
            workflow_execution_repository=MagicMock(),
            workflow_node_execution_repository=MagicMock(),
            graph_runtime_state=state,
        )
        entity = cast(AdvancedChatAppGenerateEntity, generate.call_args.kwargs["application_generate_entity"])
        assert entity.trace_recorder is not None
        user_field = "from_end_user_id" if isinstance(user, EndUser) else "from_account_id"
        assert entity.trace_recorder.attributes[user_field] == user.id
        recorder, _ = run_chatflow_capture(
            entity=entity,
            app_model=app_model,
            workflow=workflow,
            conversation=conversation,
            message=message,
            user=user,
            resumed_state=state,
        )
    recorder.record_workflow_event(GraphRunSucceededEvent(outputs={"answer": "Hello"}))
    assert recorder.finish_workflow_trace()
    assert len(capture_queue.items) == 1
    trace = CompletedTrace.model_validate_json(capture_queue.items[0].trace_json)
    expected_source = (
        WorkflowRunTriggeredFrom.DEBUGGING if invoke_from == InvokeFrom.DEBUGGER else WorkflowRunTriggeredFrom.APP_RUN
    ).value
    assert trace.spans[0].attributes["triggered_from"] == expected_source
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    assert client._attributes(trace, trace.spans[0], "workflow")["dify.invoke_from"] == expected_source
    request_metric = next(
        metric for metric in client._metrics(trace, trace.spans[0], "workflow") if metric.name == "dify.requests.total"
    )
    labels = {field.key: field.value.string_value for field in request_metric.sum.data_points[0].attributes}
    assert labels["invoke_from"] == expected_source
    assert labels["tenant_id"] == tenant.id
    assert labels["app_id"] == app_model.id
