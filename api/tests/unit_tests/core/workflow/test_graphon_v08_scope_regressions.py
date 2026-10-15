"""Production boundary regressions; an outer None defeats the legacy autouse adapter."""

import contextvars
import socket
from unittest.mock import Mock

import pytest
from flask import Flask

from context.execution_context import ExecutionContext
from context.flask_app_context import FlaskExecutionContext
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    connect = Mock(side_effect=AssertionError("unexpected network"))
    monkeypatch.setattr(socket.socket, "connect", connect)
    yield
    connect.assert_not_called()


@pytest.mark.parametrize("flask", [False, True])
@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("direct", [False, True])
def test_capture_restores_worker_context_and_adapter(flask, failure, direct):
    marker = contextvars.ContextVar("segment_marker", default="worker")
    captured = contextvars.Context()
    captured.run(marker.set, "host")
    host_adapter = DifyWorkflowFileRuntime(file_access_controller=Mock())
    with use_workflow_file_runtime(host_adapter):
        captured = contextvars.copy_context()
    captured.run(marker.set, "host")
    capture = FlaskExecutionContext(Flask(__name__), captured) if flask else ExecutionContext(context_vars=captured)

    def run_segment():
        with capture if direct else capture.enter():
            assert marker.get() == "host"
            assert peek_workflow_file_runtime() is host_adapter
            if failure:
                raise ValueError("segment failed")

    with use_workflow_file_runtime(None):
        for _ in range(2):
            if failure:
                with pytest.raises(ValueError, match="segment failed"):
                    run_segment()
            else:
                run_segment()
            assert marker.get() == "worker"
            assert peek_workflow_file_runtime() is None


@pytest.mark.parametrize("flask", [False, True])
def test_actual_single_worker_keeps_engine_adapter_for_second_node(monkeypatch, flask):
    from core.workflow.node_factory import DifyNodeFactory
    from graphon.engine import Engine
    from graphon.engine.layer import Layer
    from graphon.engine_events import GraphRunSucceededEvent
    from graphon.graph import Graph
    from graphon.runtime import RuntimeState, VariablePool
    from services.workflow.execution_lifecycle import WorkflowExecutionContextLayer
    from tests.workflow_test_utils import build_test_graph_init_params

    host = DifyWorkflowFileRuntime(file_access_controller=Mock())
    adapter = DifyWorkflowFileRuntime(file_access_controller=Mock())
    with use_workflow_file_runtime(host):
        captured = contextvars.copy_context()
    capture = FlaskExecutionContext(Flask(__name__), captured) if flask else ExecutionContext(context_vars=captured)
    monkeypatch.setattr("services.workflow.execution_lifecycle.capture_current_context", lambda: capture)
    config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {"id": "end", "data": {"type": "end", "outputs": []}},
        ],
        "edges": [{"id": "start-end", "source": "start", "target": "end"}],
    }
    state = RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id="wf")
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(workflow_id="wf", graph_config=config), runtime_state=state
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    seen = []

    class Observe(Layer):
        def on_node_run_start(self, node):
            seen.append((node.id, peek_workflow_file_runtime() is adapter))

    engine = Engine(graph=graph, runtime_state=state, workers=1, file_runtime=adapter)
    engine.add_layer(WorkflowExecutionContextLayer())
    engine.add_layer(Observe())
    with use_workflow_file_runtime(None):
        events = list(engine.run())
        assert peek_workflow_file_runtime() is None
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert seen == [("start", True), ("end", True)]


@pytest.mark.parametrize("kind", ["file", "image"])
def test_public_preview_checks_real_signature_without_ambient_adapter(kind):
    from services.upload_file_delivery_service import UploadFileDeliveryNotFoundError, UploadFileDeliveryService

    files, storage = Mock(), Mock()
    service = UploadFileDeliveryService(files=files, storage=storage)
    with use_workflow_file_runtime(None):
        with pytest.raises(UploadFileDeliveryNotFoundError):
            getattr(service, f"get_signed_{kind}_preview")(file_id="file", timestamp="1", nonce="n", sign="invalid")
        assert peek_workflow_file_runtime() is None
    files.get_by_id.assert_not_called()
    storage.load_stream.assert_not_called()


@pytest.mark.parametrize("failure", [False, True])
def test_dify_application_context_binds_rendering_for_request_and_background(failure):
    from dify_app import DifyApp
    from graphon.file import File, FileTransferMethod, FileType

    app = DifyApp(__name__)
    remote = File(
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.invalid/f.png",
        extension=".png",
        mime_type="image/png",
    )

    def render():
        with app.app_context():
            assert remote.to_dict()["url"] == remote.remote_url
            if failure:
                raise ValueError("render failed")

    with use_workflow_file_runtime(None):
        if failure:
            with pytest.raises(ValueError, match="render failed"):
                render()
        else:
            render()
        assert peek_workflow_file_runtime() is None


@pytest.mark.parametrize("ending", ["exhaust", "close", "error"])
def test_lazy_file_response_keeps_owner_until_iteration_and_cleanup(ending):
    from core.app.apps.base_app_generator import BaseAppGenerator
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.app.file_access import get_current_file_access_scope
    from graphon.file import File, FileTransferMethod, FileType
    from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
    from models import Account

    remote = File(
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.invalid/f.png",
        extension=".png",
        mime_type="image/png",
    )
    user = Account(name="Scope", email="scope@example.invalid")
    user.id = "account"
    observed = []
    thread = Mock()
    thread.is_alive.return_value = False

    def response():
        try:
            observed.append(get_current_file_access_scope())
            yield WorkflowRuntimeTypeConverter().to_json_encodable(remote)
            if ending == "error":
                raise ValueError("response failed")
            yield WorkflowRuntimeTypeConverter().to_json_encodable(remote)
        finally:
            observed.append(get_current_file_access_scope())
            assert remote.to_dict()["url"] == remote.remote_url

    with use_workflow_file_runtime(None):
        with BaseAppGenerator._bind_file_access_scope(tenant_id="tenant", user=user, invoke_from=InvokeFrom.DEBUGGER):
            owner = get_current_file_access_scope()
            stream = BaseAppGenerator._wrap_stream_with_worker_thread_join(response(), thread)
        assert peek_workflow_file_runtime() is None
        assert next(stream)["url"] == remote.remote_url
        if ending == "close":
            stream.close()
        elif ending == "error":
            with pytest.raises(ValueError, match="response failed"):
                next(stream)
        else:
            assert len(list(stream)) == 1
        assert peek_workflow_file_runtime() is None
        assert get_current_file_access_scope() is None
    assert observed == [owner, owner]
    thread.join.assert_called_once()


@pytest.mark.parametrize("wrapped", [False, True])
def test_json_prevalidation_compares_original_binding_before_dto_adaptation(wrapped):
    import json
    from copy import deepcopy
    from types import SimpleNamespace

    from core.workflow.node_factory import DifyNodeFactory
    from services.dify_builder.json_tool_execution import admit_json_workflow
    from tests.unit_tests.services.dify_builder.test_json_tool_execution import snapshot_for
    from tests.unit_tests.services.dify_builder.test_json_tool_runtime import EXPECTED, GRAPH, _context, _installation

    graph = json.loads(GRAPH.read_text())
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": True} if wrapped else True
    )
    context = _context(_installation(), EXPECTED).model_copy(
        update={"admitted_nodes": admit_json_workflow(snapshot_for(graph)).nodes}
    )
    factory = object.__new__(DifyNodeFactory)
    factory._dify_context = SimpleNamespace(builder_execution=context)
    factory._admitted_graph_config = deepcopy(graph)
    for node in graph["nodes"]:
        candidate = deepcopy(node)
        candidate["data"]["container_id"] = ""
        factory.validate_node(candidate)


@pytest.mark.parametrize("kind", ["file", "image"])
def test_valid_public_preview_retains_normal_delivery_without_ambient_adapter(kind):
    from services.upload_file_delivery_service import UploadFileDeliveryRecord, UploadFileDeliveryService

    files, storage = Mock(), Mock()
    files.get_by_id.return_value = UploadFileDeliveryRecord("key", "file.png", 4, "png", "image/png")
    storage.load_stream.return_value = iter([b"data"])
    service = UploadFileDeliveryService(files=files, storage=storage)
    signature = DifyWorkflowFileRuntime(file_access_controller=Mock())._sign_query(payload=f"{kind}-preview|file")
    with use_workflow_file_runtime(None):
        result = getattr(service, f"get_signed_{kind}_preview")(file_id="file", **signature)
        assert b"".join(result.content) == b"data"
        assert peek_workflow_file_runtime() is None
    files.get_by_id.assert_called_once_with(file_id="file")


@pytest.mark.parametrize("boundary", ["icon", "avatar", "avatar_gateway", "file_service"])
def test_direct_host_signing_boundary_needs_no_ambient_runtime(boundary, monkeypatch):
    from unittest.mock import MagicMock

    from libs.helper import build_avatar_url, build_icon_url
    from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
    from services.file_service import FileService

    sessions = MagicMock()
    sessions.return_value.__enter__.return_value.scalar.return_value = "file"
    with use_workflow_file_runtime(None):
        if boundary == "icon":
            url = build_icon_url("image", "file")
        elif boundary == "avatar":
            url = build_avatar_url("file")
        elif boundary == "avatar_gateway":
            url = SQLAlchemyAccountAvatarFileGateway(session_factory=sessions).get_owned_signed_url(
                account_id="actor", upload_file_id="file"
            )
        else:
            service = object.__new__(FileService)
            service._session_maker = sessions
            monkeypatch.setattr(service, "get_upload_file_by_id", lambda *_a, **_k: Mock())
            url = service.get_icon_url("file", "tenant")
        assert "/files/file/file-preview?" in url
        assert peek_workflow_file_runtime() is None


def test_request_rendering_and_teardown_restore_none_even_on_failure():
    from dify_app import DifyApp
    from graphon.file import File, FileTransferMethod, FileType
    from libs.helper import build_icon_url

    app = DifyApp(__name__)
    remote = File(
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.invalid/f.png",
        extension=".png",
        mime_type="image/png",
    )
    seen = []

    @app.get("/render")
    def render():
        return {"file": remote.to_dict(), "icon": build_icon_url("image", "file")}

    @app.get("/fail")
    def fail():
        raise ValueError("request failed")

    @app.teardown_appcontext
    def teardown(_error):
        seen.append(remote.to_dict()["url"])

    with use_workflow_file_runtime(None):
        response = app.test_client().get("/render")
        assert response.status_code == 200
        assert response.json["file"]["url"] == remote.remote_url
        assert peek_workflow_file_runtime() is None
        assert app.test_client().get("/fail").status_code == 500
        assert peek_workflow_file_runtime() is None
    assert seen == [remote.remote_url, remote.remote_url]


def test_background_summary_keeps_real_image_conversion_without_ambient_runtime(monkeypatch):
    from configs import dify_config
    from core.rag.index_processor.processor import paragraph_index_processor as module
    from graphon.file import File, FileTransferMethod, FileType
    from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
    from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, ImagePromptMessageContent
    from graphon.model_runtime.entities.model_entities import ModelFeature

    model = Mock()
    model.model_type_instance.get_model_schema.return_value.features = [ModelFeature.VISION]
    model.invoke_llm.return_value = LLMResult(
        model="test",
        prompt_messages=[],
        message=AssistantPromptMessage(content="summary"),
        usage=LLMUsage.empty_usage(),
    )
    manager = Mock()
    manager.get_model_instance.return_value = model
    monkeypatch.setattr(module.ModelManager, "for_tenant", lambda **_kwargs: manager)
    monkeypatch.setattr(dify_config, "MULTIMODAL_SEND_FORMAT", "url")
    remote = File(
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.invalid/f.png",
        extension=".png",
        mime_type="image/png",
    )
    with use_workflow_file_runtime(None):
        summary, _ = module.ParagraphIndexProcessor.generate_summary_from_inputs(
            tenant_id="tenant",
            text="text",
            summary_index_setting={"enable": True, "model_name": "test", "model_provider_name": "test"},
            document_language=None,
            image_loader=lambda: [remote],
        )
        assert summary == "summary"
        assert peek_workflow_file_runtime() is None
    content = model.invoke_llm.call_args.kwargs["prompt_messages"][0].content
    assert isinstance(content, list)
    assert isinstance(content[0], ImagePromptMessageContent)
    assert content[0].url == remote.remote_url


@pytest.mark.parametrize("case", ["root", "container"])
@pytest.mark.parametrize("resume_owner", ["entry", "runner"])
def test_actual_dify_v07_envelope_resumes_exact_graph_through_entry(case, resume_owner, monkeypatch):
    import hashlib
    import json
    from pathlib import Path

    from core.app.entities.app_invoke_entities import UserFrom
    from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.workflow_entry import WorkflowEntry
    from graphon.engine.layer import Layer
    from graphon.engine_events import GraphRunSucceededEvent, NodeRunStreamChunkEvent, NodeRunSucceededEvent
    from graphon.graph import Graph
    from graphon.nodes.human_input.entities import Completed
    from graphon.runtime import RuntimeState
    from tests.workflow_test_utils import build_test_graph_init_params

    directory = Path(__file__).with_name("fixtures") / "dify_v07_history"
    provenance = json.loads((directory / "PROVENANCE.json").read_text())
    for name, digest in provenance["files"].items():
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest
    context = WorkflowResumptionContext.loads((directory / f"{case}.envelope.json").read_text())
    entity = context.get_generate_entity()
    graph_config = json.loads((directory / f"{case}.graph.json").read_text())
    state = RuntimeState.from_snapshot(context.serialized_graph_runtime_state)
    response_filter = context.get_response_stream_filter()
    completed = []

    def complete(ctx):
        completed.append(ctx.node_id)
        from core.workflow.nodes.human_input.constants import (
            OUTPUT_FIELD_ACTION_ID,
            OUTPUT_FIELD_ACTION_VALUE,
            OUTPUT_FIELD_RENDERED_CONTENT,
        )
        from graphon.variables import build_segment

        return Completed(
            selected_handle="source",
            inputs={},
            outputs={
                key: build_segment(value)
                for key, value in [
                    (OUTPUT_FIELD_ACTION_ID, "source"),
                    (OUTPUT_FIELD_ACTION_VALUE, "Approved"),
                    (OUTPUT_FIELD_RENDERED_CONTENT, "Form"),
                ]
            },
        )

    monkeypatch.setattr(DifyNodeFactory, "_build_human_input_callback", lambda *_a, **_k: complete)
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(
            workflow_id="workflow", graph_config=graph_config, tenant_id="tenant", app_id="app", user_id="user"
        ),
        runtime_state=state,
    )
    graph = Graph.init(graph_config=graph_config, node_factory=factory, root_node_id="captured-start")
    if resume_owner == "runner":
        from unittest.mock import MagicMock

        from core.app.apps.workflow import app_runner as runner_module
        from graphon.variable_loader import DUMMY_VARIABLE_LOADER
        from tests.unit_tests.model_factories import make_workflow

        redis = MagicMock()
        redis.pipeline.return_value.__enter__.return_value.execute.return_value = [[], 0]
        monkeypatch.setattr(runner_module, "redis_client", redis)
        monkeypatch.setattr("core.app.apps.workflow.command_channels.is_app_task_stop_flag_set", lambda _task: False)
        monkeypatch.setattr(
            "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set", lambda _task: False
        )
        monkeypatch.setattr("core.app.workflow.layers.persistence._inspector_publish_node_changed", Mock())
        monkeypatch.setattr("core.app.workflow.layers.persistence._inspector_publish_workflow_completed", Mock())
        nodes = Mock()
        nodes.get_by_workflow_execution.return_value = []
        workflow = make_workflow(
            workflow_id="workflow", tenant_id="tenant", app_id="app", graph=graph_config, created_by="user"
        )
        runner = runner_module.WorkflowAppRunner(
            application_generate_entity=entity,
            queue_manager=Mock(),
            variable_loader=DUMMY_VARIABLE_LOADER,
            workflow=workflow,
            system_user_id="user",
            workflow_execution_repository=Mock(),
            workflow_node_execution_repository=nodes,
            runtime_state=state,
            response_stream_filter=response_filter,
        )
        events, seen = [], []
        original_handle = runner._handle_event

        def observe(entry, event):
            events.append(event)
            seen.append(isinstance(entry.graph_engine.file_runtime, DifyWorkflowFileRuntime))
            return original_handle(entry, event)

        monkeypatch.setattr(runner, "_handle_event", observe)
        with use_workflow_file_runtime(None):
            runner.run()
            assert peek_workflow_file_runtime() is None
    else:
        with use_workflow_file_runtime(None):
            entry = WorkflowEntry(
                tenant_id="tenant",
                app_id="app",
                workflow_id="workflow",
                graph_config=graph_config,
                graph=graph,
                user_id="user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=entity.invoke_from,
                call_depth=0,
                variable_pool=state.variable_pool,
                runtime_state=state,
                response_stream_filter=response_filter,
            )
            seen = []

            class Observe(Layer):
                def on_node_run_start(self, _node):
                    seen.append(peek_workflow_file_runtime() is entry.graph_engine.file_runtime)

            entry.add_layer(Observe())
            events = list(entry.run())
            assert peek_workflow_file_runtime() is None
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert seen
    assert all(seen)
    assert completed == ["captured-human"] * (2 if case == "container" else 1)
    succeeded = [event for event in events if isinstance(event, NodeRunSucceededEvent)]
    assert not any(event.node_id in {"captured-start", "captured-preface"} for event in succeeded)
    assert len({event.id for event in succeeded}) == len(succeeded)
    if case == "root":
        assert not any(event.node_id == "captured-answer" for event in succeeded)
    assert not any(
        isinstance(event, NodeRunStreamChunkEvent) and event.chunk in {"before-pause", "container-before-pause"}
        for event in events
    )


@pytest.mark.parametrize("flask_capture", [False, True])
def test_captured_otel_context_is_reversible_on_exception(flask_capture):
    from opentelemetry import context as otel_context

    key = otel_context.create_key("nw3-segment")
    host_token = otel_context.attach(otel_context.set_value(key, "host"))
    try:
        captured = contextvars.copy_context()
    finally:
        otel_context.detach(host_token)
    capture = (
        FlaskExecutionContext(Flask(__name__), captured) if flask_capture else ExecutionContext(context_vars=captured)
    )

    def run_segment():
        with capture:
            assert otel_context.get_value(key) == "host"
            raise ValueError("segment failed")

    worker_token = otel_context.attach(otel_context.set_value(key, "worker"))
    try:
        with use_workflow_file_runtime(None):
            with pytest.raises(ValueError, match="segment failed"):
                run_segment()
            assert otel_context.get_value(key) == "worker"
            assert peek_workflow_file_runtime() is None
    finally:
        otel_context.detach(worker_token)


def test_lazy_response_retains_ownership_grants_between_steps_without_leaking():
    from core.app.apps.base_app_generator import BaseAppGenerator
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
    from core.app.file_access import (
        FileAccessScope,
        bind_file_access_scope,
        get_current_file_access_scope,
        grant_upload_file_access,
    )
    from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime

    owner = FileAccessScope(
        tenant_id="tenant", user_id="user", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.WEB_APP
    )
    thread = Mock()
    thread.is_alive.return_value = False

    def response():
        grant_upload_file_access(["owned-result"])
        yield "first"
        assert get_current_file_access_scope().granted_upload_file_ids == frozenset({"owned-result"})
        yield "second"

    with use_workflow_file_runtime(None), bind_file_access_scope(None):
        with bind_dify_workflow_file_runtime(), bind_file_access_scope(owner):
            stream = BaseAppGenerator._wrap_stream_with_worker_thread_join(response(), thread)
        assert next(stream) == "first"
        assert peek_workflow_file_runtime() is None
        assert get_current_file_access_scope() is None
        assert list(stream) == ["second"]
        assert get_current_file_access_scope() is None
    thread.join.assert_called_once()
