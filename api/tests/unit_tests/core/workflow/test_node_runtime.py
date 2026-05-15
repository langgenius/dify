from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, sentinel
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, grant_retriever_segment_access
from core.llm_generator.output_parser.errors import OutputParserError
from core.workflow import node_runtime
from core.workflow.file_reference import parse_file_reference
from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
)
from core.workflow.node_runtime import (
    DifyFileReferenceFactory,
    DifyHumanInputNodeRuntime,
    DifyPreparedLLM,
    DifyPromptMessageSerializer,
    DifyRetrieverAttachmentLoader,
    DifyToolFileManager,
    DifyToolNodeRuntime,
    apply_dify_debug_email_recipient,
    build_dify_llm_file_saver,
    resolve_dify_run_context,
)
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.nodes.human_input.entities import HumanInputNodeData
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from tests.workflow_test_utils import build_test_run_context


def _build_model_schema() -> AIModelEntity:
    return AIModelEntity(
        model="gpt-4o-mini",
        label=I18nObject(en_US="GPT-4o mini"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


def _build_run_context(*, invoke_from: InvokeFrom | str = InvokeFrom.DEBUGGER) -> dict[str, object]:
    return build_test_run_context(
        tenant_id="tenant-id",
        app_id="app-id",
        user_id="user-id",
        user_from=UserFrom.ACCOUNT,
        invoke_from=invoke_from,
    )


def _build_email_method(*, debug_mode: bool = False) -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(include_bound_group=True, items=[]),
            subject="Subject",
            body="Visit {{#url#}}",
            debug_mode=debug_mode,
        ),
    )


def test_resolve_dify_run_context_accepts_mapping_payload() -> None:
    run_context = resolve_dify_run_context(_build_run_context())

    assert run_context.tenant_id == "tenant-id"
    assert run_context.invoke_from == InvokeFrom.DEBUGGER


def test_resolve_dify_run_context_requires_reserved_key() -> None:
    with pytest.raises(ValueError, match=DIFY_RUN_CONTEXT_KEY):
        resolve_dify_run_context({})


def test_apply_dify_debug_email_recipient_rewrites_debug_target() -> None:
    method = _build_email_method(debug_mode=True)

    updated = apply_dify_debug_email_recipient(method, enabled=True, actor_id="actor-id")

    assert isinstance(updated, EmailDeliveryMethod)
    assert updated.config.recipients.include_bound_group is False
    assert len(updated.config.recipients.items) == 1
    assert updated.config.recipients.items[0].reference_id == "actor-id"


@pytest.mark.parametrize(
    ("enabled", "method"),
    [
        (False, _build_email_method(debug_mode=True)),
        (True, _build_email_method(debug_mode=False)),
        (True, WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())),
    ],
)
def test_apply_dify_debug_email_recipient_noops_when_override_is_not_needed(
    enabled: bool,
    method: object,
) -> None:
    assert apply_dify_debug_email_recipient(method, enabled=enabled, actor_id="actor-id") is method


def test_dify_file_reference_factory_passes_tenant_id(monkeypatch: pytest.MonkeyPatch) -> None:
    build_from_mapping = MagicMock(return_value=sentinel.file)
    monkeypatch.setattr(node_runtime.file_factory, "build_from_mapping", build_from_mapping)

    factory = DifyFileReferenceFactory(_build_run_context())

    result = factory.build_from_mapping(mapping={"id": "upload-file"})

    assert result is sentinel.file
    build_from_mapping.assert_called_once_with(
        mapping={"id": "upload-file"},
        tenant_id="tenant-id",
        access_controller=node_runtime._file_access_controller,
    )


def test_dify_prepared_llm_wraps_model_instance_calls() -> None:
    model_schema = _build_model_schema()
    model_type_instance = SimpleNamespace(get_model_schema=Mock(return_value=model_schema))
    model_instance = SimpleNamespace(
        provider="langgenius/openai/openai",
        model_name="gpt-4o-mini",
        parameters={"temperature": 0.2},
        stop=("stop",),
        credentials={"api_key": "secret"},
        model_type_instance=model_type_instance,
        get_llm_num_tokens=Mock(return_value=32),
        invoke_llm=Mock(return_value=sentinel.result),
    )
    prepared = DifyPreparedLLM(model_instance)

    assert prepared.provider == "langgenius/openai/openai"
    assert prepared.model_name == "gpt-4o-mini"
    assert prepared.parameters == {"temperature": 0.2}
    assert prepared.stop == ("stop",)
    assert prepared.get_model_schema() == model_schema
    assert prepared.get_llm_num_tokens([]) == 32
    assert (
        prepared.invoke_llm(
            prompt_messages=[],
            model_parameters={"temperature": 0.1},
            tools=None,
            stop=None,
            stream=False,
        )
        is sentinel.result
    )

    model_type_instance.get_model_schema.assert_called_once_with("gpt-4o-mini", {"api_key": "secret"})
    model_instance.invoke_llm.assert_called_once_with(
        prompt_messages=[],
        model_parameters={"temperature": 0.1},
        tools=[],
        stop=[],
        stream=False,
    )


def test_dify_prepared_llm_requires_model_schema() -> None:
    model_instance = SimpleNamespace(
        model_name="gpt-4o-mini",
        credentials={},
        model_type_instance=SimpleNamespace(get_model_schema=Mock(return_value=None)),
    )
    prepared = DifyPreparedLLM(model_instance)

    with pytest.raises(ValueError, match="Model schema not found"):
        prepared.get_model_schema()


def test_dify_prepared_llm_delegates_structured_output_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    model_instance = SimpleNamespace(
        provider="langgenius/openai/openai",
        model_name="gpt-4o-mini",
        credentials={"api_key": "secret"},
        model_type_instance=SimpleNamespace(get_model_schema=Mock(return_value=_build_model_schema())),
    )
    prepared = DifyPreparedLLM(model_instance)
    invoke_structured = MagicMock(return_value=sentinel.structured)
    monkeypatch.setattr(node_runtime, "invoke_llm_with_structured_output", invoke_structured)

    result = prepared.invoke_llm_with_structured_output(
        prompt_messages=[],
        json_schema={"type": "object"},
        model_parameters={"temperature": 0.2},
        stop=("done",),
        stream=True,
    )

    assert result is sentinel.structured
    invoke_structured.assert_called_once_with(
        provider="langgenius/openai/openai",
        model_schema=prepared.get_model_schema(),
        model_instance=model_instance,
        prompt_messages=[],
        json_schema={"type": "object"},
        model_parameters={"temperature": 0.2},
        stop=["done"],
        stream=True,
    )


def test_dify_prepared_llm_identifies_structured_output_errors() -> None:
    prepared = DifyPreparedLLM(SimpleNamespace())

    assert prepared.is_structured_output_parse_error(OutputParserError("bad json")) is True
    assert prepared.is_structured_output_parse_error(ValueError("other")) is False


def test_dify_prompt_message_serializer_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    serialize = MagicMock(return_value={"prompt": "value"})
    monkeypatch.setattr(node_runtime.PromptMessageUtil, "prompt_messages_to_prompt_for_saving", serialize)

    result = DifyPromptMessageSerializer().serialize(
        model_mode="chat",
        prompt_messages=[],
    )

    assert result == {"prompt": "value"}
    serialize.assert_called_once_with(
        model_mode="chat",
        prompt_messages=[],
    )


def test_dify_retriever_attachment_loader_builds_graph_files(monkeypatch: pytest.MonkeyPatch) -> None:
    upload_file = SimpleNamespace(
        id="upload-file-id",
        name="diagram.png",
        extension="png",
        mime_type="image/png",
        source_url="https://example.com/diagram.png",
        key="storage-key",
        size=128,
    )
    session = MagicMock()
    session.execute.return_value.all.return_value = [(None, upload_file)]

    class _SessionContext:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    build_from_mapping = MagicMock(return_value=sentinel.file)
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(node_runtime, "Session", MagicMock(return_value=_SessionContext()))
    loader = DifyRetrieverAttachmentLoader(
        file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping)
    )

    files = loader.load(segment_id="segment-id")

    assert files == [sentinel.file]
    build_from_mapping.assert_called_once()
    mapping = build_from_mapping.call_args.kwargs["mapping"]
    assert mapping["id"] == "upload-file-id"
    assert mapping["transfer_method"] == FileTransferMethod.LOCAL_FILE
    assert mapping["type"] == FileType.IMAGE
    assert parse_file_reference(mapping["reference"]).storage_key is None


def test_dify_retriever_attachment_loader_grants_upload_files_for_allowed_segment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from factories.file_factory import builders as file_builders

    upload_file_id = str(uuid4())
    segment_id = str(uuid4())
    upload_file = SimpleNamespace(
        id=upload_file_id,
        tenant_id="tenant-id",
        name="diagram.png",
        extension="png",
        mime_type="image/png",
        source_url="https://example.com/diagram.png",
        key="storage-key",
        size=128,
    )
    attachment_session = MagicMock()
    attachment_session.execute.return_value.all.return_value = [(None, upload_file)]

    class _AttachmentSessionContext:
        def __enter__(self):
            return attachment_session

        def __exit__(self, exc_type, exc, tb):
            return False

    upload_session = MagicMock()
    upload_session.__enter__.return_value = upload_session
    upload_session.__exit__.return_value = False
    upload_session.scalar.return_value = upload_file

    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(node_runtime, "Session", MagicMock(return_value=_AttachmentSessionContext()))
    monkeypatch.setattr(file_builders, "session_factory", SimpleNamespace(create_session=lambda: upload_session))

    loader = DifyRetrieverAttachmentLoader(file_reference_factory=DifyFileReferenceFactory(_build_run_context()))
    scope = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        grant_retriever_segment_access([segment_id])
        files = loader.load(segment_id=segment_id)

    assert files[0].related_id == upload_file_id
    stmt = upload_session.scalar.call_args.args[0]
    whereclause = str(stmt.whereclause)
    assert "upload_files.tenant_id" in whereclause
    assert "upload_files.id IN" in whereclause


def test_dify_retriever_attachment_loader_skips_ungranted_segment_for_end_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build_from_mapping = MagicMock()
    session_factory = MagicMock()
    monkeypatch.setattr(node_runtime, "Session", session_factory)
    loader = DifyRetrieverAttachmentLoader(
        file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping)
    )
    scope = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        files = loader.load(segment_id=str(uuid4()))

    assert files == []
    session_factory.assert_not_called()
    build_from_mapping.assert_not_called()


def test_dify_retriever_attachment_loader_skips_segment_rejected_by_checker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    segment_id = str(uuid4())
    build_from_mapping = MagicMock()
    session_factory = MagicMock()
    segment_access_checker = MagicMock(return_value=False)
    monkeypatch.setattr(node_runtime, "Session", session_factory)
    loader = DifyRetrieverAttachmentLoader(
        file_reference_factory=SimpleNamespace(build_from_mapping=build_from_mapping),
        segment_access_checker=segment_access_checker,
    )
    scope = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        grant_retriever_segment_access([segment_id])
        files = loader.load(segment_id=segment_id)

    assert files == []
    segment_access_checker.assert_called_once_with(segment_id)
    session_factory.assert_not_called()
    build_from_mapping.assert_not_called()


def test_dify_tool_file_manager_resolves_conversation_id_for_tool_files(monkeypatch: pytest.MonkeyPatch) -> None:
    create_file_by_raw = MagicMock(return_value=SimpleNamespace(id="tool-file-id"))
    manager_instance = SimpleNamespace(create_file_by_raw=create_file_by_raw)
    monkeypatch.setattr(node_runtime, "ToolFileManager", MagicMock(return_value=manager_instance))
    conversation_id_getter = MagicMock(return_value="conversation-id")

    manager = DifyToolFileManager(
        DifyRunContext(
            tenant_id="tenant-id",
            app_id="app-id",
            user_id="user-id",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        conversation_id_getter=conversation_id_getter,
    )

    tool_file = manager.create_file_by_raw(
        file_binary=b"file-bytes",
        mimetype="image/png",
        filename="diagram",
    )

    assert tool_file.id == "tool-file-id"
    conversation_id_getter.assert_called_once_with()
    create_file_by_raw.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_binary=b"file-bytes",
        mimetype="image/png",
        filename="diagram",
    )


def test_dify_tool_file_manager_delegates_file_generator_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    get_file_generator = MagicMock(return_value=sentinel.generator)
    monkeypatch.setattr(
        node_runtime,
        "ToolFileManager",
        MagicMock(return_value=SimpleNamespace(get_file_generator_by_tool_file_id=get_file_generator)),
    )
    manager = DifyToolFileManager(_build_run_context())

    assert manager.get_file_generator_by_tool_file_id("tool-file-id") is sentinel.generator
    get_file_generator.assert_called_once_with("tool-file-id")


def test_dify_tool_node_runtime_injects_outer_workflow_run_id_for_workflow_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
    get_runtime = MagicMock(return_value=runtime_tool)
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    monkeypatch.setattr(
        node_runtime,
        "get_system_text",
        lambda _pool, key: (
            "outer-workflow-run-id" if key == node_runtime.SystemVariableKey.WORKFLOW_EXECUTION_ID else None
        ),
    )

    runtime = node_runtime.DifyToolNodeRuntime(_build_run_context())
    node_data = ToolNodeData(
        title="Workflow Tool Node",
        desc=None,
        provider_id="workflow-provider-id",
        provider_type=ToolProviderType.WORKFLOW,
        provider_name="workflow-provider",
        tool_name="workflow-tool",
        tool_label="Workflow Tool",
        tool_configurations={},
        tool_parameters={},
    )

    handle = runtime.get_runtime(
        node_id="tool-node",
        node_data=node_data,
        variable_pool=object(),
        node_execution_id="node-execution-id",
    )

    assert handle.raw.tool is runtime_tool
    assert handle.raw.parent_trace_context.model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-id",
        "parent_node_execution_id": "node-execution-id",
    }
    assert runtime_tool.runtime.runtime_parameters == {}
    get_runtime.assert_called_once()


def test_dify_tool_node_runtime_does_not_inject_outer_workflow_run_id_for_non_workflow_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
    get_runtime = MagicMock(return_value=runtime_tool)
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    monkeypatch.setattr(node_runtime, "get_system_text", lambda _pool, _key: None)

    runtime = node_runtime.DifyToolNodeRuntime(_build_run_context())
    node_data = ToolNodeData(
        title="Builtin Tool Node",
        desc=None,
        provider_id="builtin-provider-id",
        provider_type=ToolProviderType.BUILT_IN,
        provider_name="builtin-provider",
        tool_name="builtin-tool",
        tool_label="Builtin Tool",
        tool_configurations={},
        tool_parameters={},
    )

    handle = runtime.get_runtime(
        node_id="tool-node",
        node_data=node_data,
        variable_pool=object(),
    )

    assert handle.raw.tool is runtime_tool
    assert "outer_workflow_run_id" not in runtime_tool.runtime.runtime_parameters
    get_runtime.assert_called_once()


def test_dify_human_input_runtime_builds_debug_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = MagicMock()
    repository_cls = MagicMock(return_value=repository)
    monkeypatch.setattr(node_runtime, "HumanInputFormRepositoryImpl", repository_cls)

    runtime = DifyHumanInputNodeRuntime(
        _build_run_context(),
        workflow_execution_id_getter=lambda: "workflow-execution-id",
    )

    assert runtime.build_form_repository() is repository
    repository_cls.assert_called_once_with(
        tenant_id="tenant-id",
        app_id="app-id",
        workflow_execution_id="workflow-execution-id",
        invoke_source="debugger",
        submission_actor_id="user-id",
    )


def test_dify_tool_runtime_spec_prefers_tool_parameters_for_runtime_form_values() -> None:
    node_data = ToolNodeData(
        provider_id="video-mixcut-agent",
        provider_type=ToolProviderType.PLUGIN,
        provider_name="sawyer-shi/video-mixcut-agent",
        tool_name="mixcut",
        tool_label="MixCut",
        tool_configurations={"count": 2},
        tool_parameters={
            "vision_llm_model": {
                "type": "constant",
                "value": {
                    "provider": "langgenius/tongyi/tongyi",
                    "model": "qwen3-vl-plus",
                    "model_type": "llm",
                },
            }
        },
    )

    spec = DifyToolNodeRuntime._build_tool_runtime_spec(node_data)

    assert spec.tool_configurations == {
        "count": 2,
        "vision_llm_model": {
            "type": "constant",
            "value": {
                "provider": "langgenius/tongyi/tongyi",
                "model": "qwen3-vl-plus",
                "model_type": "llm",
            },
        },
    }


def test_dify_human_input_runtime_create_form_filters_debugger_delivery_methods() -> None:
    repository = MagicMock()
    repository.create_form.return_value = sentinel.form
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[
            WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig()),
            _build_email_method(debug_mode=True),
        ],
    )
    runtime = DifyHumanInputNodeRuntime(
        _build_run_context(),
        workflow_execution_id_getter=lambda: "workflow-execution-id",
        form_repository=repository,
    )

    result = runtime.create_form(
        node_id="human-input-node",
        node_data=node_data,
        rendered_content="<p>Rendered</p>",
        resolved_default_values={"answer": "default"},
    )

    assert result is sentinel.form
    repository.create_form.assert_called_once()
    params = repository.create_form.call_args.args[0]
    assert params.node_id == "human-input-node"
    assert params.workflow_execution_id == "workflow-execution-id"
    assert params.display_in_ui is True
    assert len(params.delivery_methods) == 1
    assert params.delivery_methods[0].type == DeliveryMethodType.EMAIL
    assert params.delivery_methods[0].config.recipients.items[0].reference_id == "user-id"


def test_dify_human_input_runtime_preserves_webapp_delivery_for_web_invocations() -> None:
    repository = MagicMock()
    repository.create_form.return_value = sentinel.form
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[
            WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig()),
            _build_email_method(debug_mode=True),
        ],
    )
    runtime = DifyHumanInputNodeRuntime(
        _build_run_context(invoke_from=InvokeFrom.WEB_APP),
        form_repository=repository,
    )

    runtime.create_form(
        node_id="human-input-node",
        node_data=node_data,
        rendered_content="<p>Rendered</p>",
        resolved_default_values={},
    )

    params = repository.create_form.call_args.args[0]
    assert params.display_in_ui is True
    assert [method.type for method in params.delivery_methods] == [
        DeliveryMethodType.WEBAPP,
        DeliveryMethodType.EMAIL,
    ]
    assert params.delivery_methods[1].config.recipients.include_bound_group is True


def test_build_dify_llm_file_saver_wires_runtime_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
    file_saver_cls = MagicMock(return_value=sentinel.file_saver)
    monkeypatch.setattr("graphon.nodes.llm.file_saver.FileSaverImpl", file_saver_cls)
    http_client = MagicMock()

    saver = build_dify_llm_file_saver(
        run_context=_build_run_context(),
        http_client=http_client,
        conversation_id_getter=lambda: "conversation-id",
    )

    assert saver is sentinel.file_saver
    tool_file_manager = file_saver_cls.call_args.kwargs["tool_file_manager"]
    file_reference_factory = file_saver_cls.call_args.kwargs["file_reference_factory"]
    assert isinstance(tool_file_manager, DifyToolFileManager)
    assert isinstance(file_reference_factory, DifyFileReferenceFactory)
    assert file_saver_cls.call_args.kwargs["http_client"] is http_client
