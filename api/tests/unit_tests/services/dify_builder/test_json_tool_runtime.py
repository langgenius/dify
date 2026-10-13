"""Guarded JSON Tool with real native casting, FORM conversion and message adaptation."""

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.tools import tool_manager as manager_module
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.plugin_tool import tool as plugin_tool_module
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.plugin_tool.tool import PluginTool
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.human_input_adapter import adapt_node_data_for_graph
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.exc import ToolRuntimeInvocationError, ToolRuntimeResolutionError
from graphon.runtime import VariablePool
from services.dify_builder import json_tool_metadata as metadata
from services.dify_builder.execution_contracts import (
    AdmittedNodeBinding,
    JsonToolExecutionContext,
    QualifiedJsonToolBinding,
    canonical_digest,
    context_digest,
)
from services.dify_builder.json_tool_metadata import InstalledJsonParse
from services.dify_builder.json_tool_runtime import (
    JsonRuntimeBinding,
    QualifiedJsonToolNodeRuntime,
    _GuardedJsonPluginTool,
)
from tests.unit_tests.services.dify_builder.test_json_tool_metadata import TENANT, _provider
from tests.workflow_test_utils import build_test_run_context

GRAPH = Path(__file__).resolve().parents[3] / "fixtures/workflow/builder_restricted/json_parse_owned_graph.json"
EXPECTED = {"content": '{"name":"你好"}', "json_filter": "$.name", "ensure_ascii": False}


def _installation() -> InstalledJsonParse:
    return InstalledJsonParse(
        tenant_id=TENANT,
        installation_id="installation-1",
        plugin_id=metadata.PLUGIN_ID,
        provider_id=metadata.PROVIDER_ID,
        tool_name=metadata.TOOL_NAME,
        unique_identifier=metadata.UNIQUE_IDENTIFIER,
        version=metadata.VERSION,
        checksum=metadata.CHECKSUM,
        provider_schema_digest=metadata.PROVIDER_SCHEMA_DIGEST,
        tool_schema_digest=metadata.TOOL_SCHEMA_DIGEST,
        runtime_type="local",
        qualification_digest=metadata.QUALIFICATION_DIGEST,
    )


def _context(installation: InstalledJsonParse, expected: dict[str, str | bool]) -> JsonToolExecutionContext:
    nodes = tuple(
        AdmittedNodeBinding(
            node_id=node_id,
            implementation=implementation,
            node_version="1",
            normalized_config_digest="e" * 64,
        )
        for node_id, implementation in (
            ("node1", "graphon.nodes.start.start_node.StartNode"),
            ("node2", "graphon.nodes.tool.tool_node.ToolNode"),
            ("node3", "graphon.nodes.end.end_node.EndNode"),
        )
    )
    qualified = QualifiedJsonToolBinding(
        node_id="node2",
        **{field: getattr(installation, field) for field in installation.__dataclass_fields__},
        final_parameters_digest=canonical_digest(expected),
    )
    initial = JsonToolExecutionContext(
        policy_version="builder-json-parse-v1",
        request_id="request",
        tenant_id=TENANT,
        app_id="app",
        workflow_id="workflow",
        actor_id="actor",
        session_id="session",
        test_input_id="input",
        execution_revision="a" * 64,
        graph_revision="b" * 64,
        submitted_inputs_digest="c" * 64,
        effective_inputs_digest="d" * 64,
        context_digest="0" * 64,
        mode="restricted",
        sandbox_profile="disabled",
        admitted_nodes=nodes,
        qualified_tool=qualified,
    )
    return initial.model_copy(update={"context_digest": context_digest(initial)})


class Recorder:
    healthy = True

    def __init__(self):
        self.receipts = []
        self.fail = False

    def record(self, observation):
        if self.fail:
            raise RuntimeError("private recorder error")
        self.receipts.append(observation)


def _node_data(*, ascii_value: bool, wrapped: bool) -> ToolNodeData:
    graph = json.loads(GRAPH.read_text())
    data = deepcopy(graph["nodes"][1]["data"])
    data["tool_configurations"]["ensure_ascii"] = {"type": "constant", "value": ascii_value} if wrapped else ascii_value
    return ToolNodeData.model_validate(adapt_node_data_for_graph(data))


def _native() -> PluginTool:
    provider = _provider()
    return PluginTool(
        entity=provider.declaration.tools[0],
        runtime=ToolRuntime(tenant_id=TENANT, user_id="user", credentials={}),
        tenant_id=TENANT,
        icon=provider.declaration.identity.icon,
        plugin_unique_identifier=metadata.UNIQUE_IDENTIFIER,
    )


def _message(text: str) -> ToolInvokeMessage:
    return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text=text))


@pytest.mark.parametrize("ascii_value", [True, False], ids=["true", "false"])
def test_native_plugin_casts_final_boolean_and_preserves_unicode(monkeypatch, sqlite_engine, ascii_value):
    expected = {**EXPECTED, "ensure_ascii": ascii_value}
    seen = []

    class Manager:
        def invoke(self, **kwargs):
            seen.append(kwargs["tool_parameters"])
            yield _message("你好")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    guarded = _GuardedJsonPluginTool(_native(), expected)
    with Session(sqlite_engine) as session:
        messages = list(guarded.invoke(session, "user", dict(expected)))
    assert [message.message.text for message in messages] == ["你好"]
    assert seen == [expected]
    assert guarded.complete
    assert guarded.text_bytes == len("你好".encode())


@pytest.mark.parametrize("text", ["", "你好", "error: invalid JSON", "[1, 2]"])
def test_exact_native_text_is_data_not_status(monkeypatch, sqlite_engine, text):
    class Manager:
        def invoke(self, **_kwargs):
            yield _message(text)

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    guarded = _GuardedJsonPluginTool(_native(), EXPECTED)
    with Session(sqlite_engine) as session:
        assert [item.message.text for item in guarded.invoke(session, "user", dict(EXPECTED))] == [text]
    assert guarded.text_output == text


def test_forbidden_message_closes_transport_before_file_transform(monkeypatch, sqlite_engine):
    closed = []

    class Manager:
        def invoke(self, **_kwargs):
            try:
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.JSON,
                    message=ToolInvokeMessage.JsonMessage(json_object={"secret": "data"}),
                )
            finally:
                closed.append(True)

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    guarded = _GuardedJsonPluginTool(_native(), EXPECTED)
    with Session(sqlite_engine) as session, pytest.raises(Exception, match="unsupported_json_tool_output"):
        list(guarded.invoke(session, "user", dict(EXPECTED)))
    assert closed == [True]


@pytest.mark.parametrize("texts", [["a" * 65537], ["x"] * 9])
def test_text_byte_and_count_limits_close_transport(monkeypatch, sqlite_engine, texts):
    closed = []

    class Manager:
        def invoke(self, **_kwargs):
            try:
                for text in texts:
                    yield _message(text)
            finally:
                closed.append(True)

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    guarded = _GuardedJsonPluginTool(_native(), EXPECTED)
    with Session(sqlite_engine) as session, pytest.raises(Exception, match="json_execution_limit"):
        list(guarded.invoke(session, "user", dict(EXPECTED)))
    assert closed == [True]
    assert not guarded.complete


def test_final_envelope_mismatch_prevents_native_dispatch(monkeypatch, sqlite_engine):
    class Manager:
        def invoke(self, **_kwargs):
            pytest.fail("native transport reached")
            yield _message("never")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    guarded = _GuardedJsonPluginTool(_native(), EXPECTED)
    with Session(sqlite_engine) as session, pytest.raises(Exception, match="json_tool_parameters_changed"):
        list(guarded.invoke(session, "user", {**EXPECTED, "ensure_ascii": True}))


def _runtime(
    monkeypatch, sqlite_engine, *, expected=None, metadata_reader=None, recorder=None, controller=None, maker=None
):
    expected = dict(EXPECTED if expected is None else expected)
    installed = _installation()
    recorder = recorder or Recorder()
    binding = JsonRuntimeBinding(
        context=_context(installed, expected),
        native_run_id="run",
        native_task_id="task",
        native_node_execution_id="node-execution",
        expected_parameters=expected,
        recorder=recorder,
        metadata_reader=metadata_reader or (lambda _tenant: installed),
    )
    issuer = SimpleNamespace(json_runtime_binding=lambda **_kwargs: binding)
    controller = controller or PluginToolProviderController(
        entity=_provider().declaration,
        plugin_id=metadata.PLUGIN_ID,
        plugin_unique_identifier=metadata.UNIQUE_IDENTIFIER,
        tenant_id=TENANT,
    )
    monkeypatch.setattr(ToolManager, "get_builtin_provider", classmethod(lambda _cls, _provider, _tenant: controller))
    runtime = QualifiedJsonToolNodeRuntime(
        build_test_run_context(tenant_id=TENANT, app_id="app", user_id="actor"),
        native_run_id="run",
        native_task_id="task",
        issuer=issuer,
        session_maker=maker or sessionmaker(sqlite_engine),
    )
    return runtime, recorder


@pytest.mark.parametrize("ascii_value", [True, False], ids=["true", "false"])
@pytest.mark.parametrize("wrapped", [True, False], ids=["wrapped", "raw"])
def test_native_form_conversion_keeps_explicit_boolean(monkeypatch, sqlite_engine, ascii_value, wrapped):
    expected = {**EXPECTED, "ensure_ascii": ascii_value}
    runtime, _ = _runtime(monkeypatch, sqlite_engine, expected=expected)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=ascii_value, wrapped=wrapped),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    tool = runtime._tool_from_handle(handle)
    assert tool.runtime.runtime_parameters == {"ensure_ascii": ascii_value}
    assert type(tool.runtime.runtime_parameters["ensure_ascii"]) is bool
    with pytest.raises(ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id="node2",
            node_data=_node_data(ascii_value=ascii_value, wrapped=wrapped),
            variable_pool=VariablePool(),
            node_execution_id="node-execution",
        )


def test_actual_controller_drift_refuses_before_credentials(monkeypatch, sqlite_engine):
    controller = PluginToolProviderController(
        entity=_provider().declaration,
        plugin_id=metadata.PLUGIN_ID,
        plugin_unique_identifier="different-installation",
        tenant_id=TENANT,
    )
    runtime, _ = _runtime(monkeypatch, sqlite_engine, controller=controller)
    monkeypatch.setattr(
        PluginToolProviderController,
        "_validate_credentials",
        lambda *_args, **_kwargs: pytest.fail("credential validation reached"),
    )
    monkeypatch.setattr(
        ToolParameterConfigurationManager,
        "decrypt_tool_parameters",
        lambda *_args, **_kwargs: pytest.fail("configuration decryption reached"),
    )
    with pytest.raises(ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id="node2",
            node_data=_node_data(ascii_value=False, wrapped=False),
            variable_pool=VariablePool(),
            node_execution_id="node-execution",
        )


def test_actual_parse_schema_drift_refuses_before_dynamic_fetch(monkeypatch, sqlite_engine):
    provider = _provider().declaration
    provider.tools[0].has_runtime_parameters = True
    controller = PluginToolProviderController(
        entity=provider,
        plugin_id=metadata.PLUGIN_ID,
        plugin_unique_identifier=metadata.UNIQUE_IDENTIFIER,
        tenant_id=TENANT,
    )
    monkeypatch.setattr(
        plugin_tool_module.PluginToolManager,
        "get_runtime_parameters",
        lambda *_args, **_kwargs: pytest.fail("dynamic parameter fetch reached"),
    )
    runtime, _ = _runtime(monkeypatch, sqlite_engine, controller=controller)
    with pytest.raises(ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id="node2",
            node_data=_node_data(ascii_value=False, wrapped=False),
            variable_pool=VariablePool(),
            node_execution_id="node-execution",
        )


def test_hardcoded_fallback_refuses_before_credential_branch(monkeypatch, sqlite_engine):
    fallback = SimpleNamespace(get_tool=lambda _name: _native())
    runtime, _ = _runtime(monkeypatch, sqlite_engine, controller=fallback)
    with pytest.raises(ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id="node2",
            node_data=_node_data(ascii_value=False, wrapped=False),
            variable_pool=VariablePool(),
            node_execution_id="node-execution",
        )


def test_static_resolution_never_reads_dynamic_or_decrypts(monkeypatch, sqlite_engine):
    monkeypatch.setattr(
        plugin_tool_module.PluginToolManager,
        "get_runtime_parameters",
        lambda *_args, **_kwargs: pytest.fail("dynamic parameter fetch reached"),
    )
    monkeypatch.setattr(
        ToolParameterConfigurationManager,
        "decrypt_tool_parameters",
        lambda *_args, **_kwargs: pytest.fail("configuration decryption reached"),
    )
    monkeypatch.setattr(
        PluginToolProviderController,
        "_validate_credentials",
        lambda *_args, **_kwargs: pytest.fail("credential validation reached"),
    )
    monkeypatch.setattr(
        manager_module,
        "create_provider_encrypter",
        lambda *_args, **_kwargs: pytest.fail("credential decryption setup reached"),
    )
    runtime, _ = _runtime(monkeypatch, sqlite_engine)
    runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )


@pytest.mark.parametrize(
    "incompatible",
    [
        {"credential_id": "selected"},
        {"draft_tool_workflow_id": "draft"},
        {"draft_tool_app_id": "app"},
        {"confirmed_guard": object()},
    ],
)
def test_json_native_getter_rejects_incompatible_guard_arguments(monkeypatch, incompatible):
    monkeypatch.setattr(
        ToolManager,
        "get_builtin_provider",
        classmethod(lambda *_args: pytest.fail("provider resolution reached")),
    )
    with pytest.raises(Exception, match="invalid_json_tool_configuration"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id=metadata.PROVIDER_ID,
            tool_name=metadata.TOOL_NAME,
            tenant_id=TENANT,
            json_provider_validator=lambda _controller, _tool: None,
            **incompatible,
        )


def test_full_native_text_path_receipt_and_replay(monkeypatch, sqlite_engine):
    calls = []

    class Manager:
        def invoke(self, **kwargs):
            calls.append(kwargs)
            yield _message("你好")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    runtime, recorder = _runtime(monkeypatch, sqlite_engine)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    messages = list(
        runtime.invoke(
            tool_runtime=handle,
            tool_parameters=dict(EXPECTED),
            workflow_call_depth=0,
            provider_name=metadata.PROVIDER_ID,
        )
    )
    assert [message.message.text for message in messages] == ["你好"]
    assert len(calls) == len(recorder.receipts) == 1
    receipt = recorder.receipts[0]
    assert receipt.text_bytes == 6
    assert receipt.text_messages == 1
    assert receipt.native_text_output_digest == canonical_digest("你好")
    with pytest.raises(ToolRuntimeInvocationError):
        list(
            runtime.invoke(
                tool_runtime=handle,
                tool_parameters=dict(EXPECTED),
                workflow_call_depth=0,
                provider_name=metadata.PROVIDER_ID,
            )
        )


def test_prior_handle_and_recorder_failure_never_emit_receipt(monkeypatch, sqlite_engine):
    runtime, recorder = _runtime(monkeypatch, sqlite_engine)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    other, _ = _runtime(monkeypatch, sqlite_engine)
    with pytest.raises(ToolRuntimeInvocationError):
        list(other.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json"))
    recorder.fail = True

    class Manager:
        def invoke(self, **_kwargs):
            yield _message("ok")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    with pytest.raises(ToolRuntimeInvocationError):
        list(runtime.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json"))
    assert recorder.receipts == []
    assert not runtime._healthy


def test_post_dispatch_metadata_change_prevents_receipt(monkeypatch, sqlite_engine):
    reads = []
    installed = _installation()

    def metadata_reader(_tenant):
        reads.append(True)
        if len(reads) == 1:
            return installed
        return InstalledJsonParse(
            **{field: getattr(installed, field) for field in installed.__dataclass_fields__ if field != "checksum"},
            checksum="f" * 64,
        )

    class Manager:
        def invoke(self, **_kwargs):
            yield _message("native text")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    runtime, recorder = _runtime(monkeypatch, sqlite_engine, metadata_reader=metadata_reader)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    with pytest.raises(ToolRuntimeInvocationError):
        list(runtime.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json"))
    assert len(reads) == 2
    assert recorder.receipts == []


def test_interrupted_stream_closes_native_generator_without_receipt(monkeypatch, sqlite_engine):
    closed = []

    class Manager:
        def invoke(self, **_kwargs):
            try:
                yield _message("first")
                yield _message("second")
            finally:
                closed.append(True)

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    runtime, recorder = _runtime(monkeypatch, sqlite_engine)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    stream = runtime.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json")
    assert next(stream).message.text == "first"
    stream.close()
    assert closed == [True]
    assert recorder.receipts == []
    assert not runtime._healthy


def test_non_text_is_refused_before_native_file_transform(monkeypatch, sqlite_engine):
    from core.tools.tool_file_manager import ToolFileManager

    monkeypatch.setattr(
        ToolFileManager,
        "create_file_by_url",
        lambda *_args, **_kwargs: pytest.fail("file download reached"),
    )
    original = ToolFileMessageTransformer.transform_tool_invoke_messages
    transformed = []

    def observing_transform(*args, **kwargs):
        for message in original(*args, **kwargs):
            transformed.append(message)
            yield message

    monkeypatch.setattr(ToolFileMessageTransformer, "transform_tool_invoke_messages", observing_transform)

    class Manager:
        def invoke(self, **_kwargs):
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.JSON,
                message=ToolInvokeMessage.JsonMessage(json_object={"private": "data"}),
            )

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    runtime, recorder = _runtime(monkeypatch, sqlite_engine)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    with pytest.raises(ToolRuntimeInvocationError):
        list(runtime.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json"))
    assert transformed == []
    assert recorder.receipts == []


def test_metadata_and_native_dispatch_have_no_active_own_transaction(monkeypatch, sqlite_engine):
    sessions = []

    class TrackedSession(Session):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            sessions.append(self)

    maker = sessionmaker(sqlite_engine, class_=TrackedSession)
    transaction_states = []

    def metadata_reader(_tenant):
        transaction_states.append(sessions[-1].in_transaction())
        return _installation()

    class Manager:
        def invoke(self, **_kwargs):
            transaction_states.append(sessions[-1].in_transaction())
            yield _message("ok")

    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    runtime, recorder = _runtime(monkeypatch, sqlite_engine, metadata_reader=metadata_reader, maker=maker)
    handle = runtime.get_runtime(
        node_id="node2",
        node_data=_node_data(ascii_value=False, wrapped=False),
        variable_pool=VariablePool(),
        node_execution_id="node-execution",
    )
    list(runtime.invoke(tool_runtime=handle, tool_parameters=EXPECTED, workflow_call_depth=0, provider_name="json"))
    assert transaction_states == [False, False, False]
    assert len(recorder.receipts) == 1
