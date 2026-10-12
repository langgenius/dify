from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, Mock, sentinel
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, grant_retriever_segment_access
from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from core.dify_builder.real_call_consent import ConfirmedToolGuard
from core.llm_generator.output_parser.errors import OutputParserError
from core.model_manager import QuotaManagedModelInstance
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.exc import PluginLLMPollingUnsupportedError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.tool import PluginToolManager
from core.plugin.plugin_service import PluginService
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject as ToolI18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolParameter
from core.tools.plugin_tool.tool import PluginTool
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
    DifyPreparedPollingLLM,
    DifyPromptMessageSerializer,
    DifyRetrieverAttachmentLoader,
    DifyToolFileManager,
    DifyToolNodeRuntime,
    apply_dify_debug_email_recipient,
    build_dify_llm_file_saver,
    resolve_dify_run_context,
)
from core.workflow.nodes.human_input.entities import FileInputConfig, FileListInputConfig, HumanInputNodeData
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMPollingResult, LLMPollingStatus
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelFeature, ModelType
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.nodes.llm.runtime_protocols import LLMPollingCapableProtocol
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.base import TypeBase
from models.dataset import SegmentAttachmentBinding
from models.enums import CreatorUserRole
from models.model import StorageType, UploadFile
from models.tools import ToolFile
from tests.workflow_test_utils import build_test_run_context


@pytest.fixture
def attachment_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Provide real attachment and upload-file persistence to node runtime tests."""

    TypeBase.metadata.create_all(sqlite_engine, tables=[SegmentAttachmentBinding.__table__, UploadFile.__table__])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _persist_attachment(
    session: Session,
    *,
    segment_id: str,
    upload_file_id: str,
    upload_file_tenant_id: str = "tenant-id",
) -> UploadFile:
    """Persist an attachment binding for the test tenant and its referenced upload file."""

    upload_file = UploadFile(
        tenant_id=upload_file_tenant_id,
        storage_type=StorageType.LOCAL,
        key="storage-key",
        name="diagram.png",
        size=128,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-id",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
        source_url="https://example.com/diagram.png",
    )
    upload_file.id = upload_file_id
    session.add_all(
        [
            upload_file,
            SegmentAttachmentBinding(
                tenant_id="tenant-id",
                dataset_id="dataset-id",
                document_id="document-id",
                segment_id=segment_id,
                attachment_id=upload_file_id,
            ),
        ]
    )
    session.commit()
    return upload_file


def _build_model_schema(*, features: list[ModelFeature] | None = None) -> AIModelEntity:
    return AIModelEntity(
        model="gpt-4o-mini",
        label=I18nObject(en_US="GPT-4o mini"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        features=features,
    )


class _ModelTypeInstanceStub(LargeLanguageModel):
    def __init__(
        self,
        *,
        model_schema: AIModelEntity | None,
        model_runtime: object | None = None,
    ) -> None:
        self.model_runtime = model_runtime
        self.get_model_schema = Mock(return_value=model_schema)


class _ModelInstanceStub:
    def __init__(
        self,
        *,
        model_schema: AIModelEntity | None,
        model_runtime: object | None = None,
        invoke_llm_result: object = sentinel.result,
        get_llm_num_tokens_result: int = 32,
    ) -> None:
        self.provider = "langgenius/openai/openai"
        self.model_name = "gpt-4o-mini"
        self.parameters = {"temperature": 0.2}
        self.stop = ("stop",)
        self.credentials = {"api_key": "secret"}
        self.model_type_instance = _ModelTypeInstanceStub(
            model_schema=model_schema,
            model_runtime=model_runtime,
        )
        self.get_llm_num_tokens = Mock(return_value=get_llm_num_tokens_result)
        self.invoke_llm = Mock(return_value=invoke_llm_result)


class _QuotaManagedModelInstanceStub(_ModelInstanceStub, QuotaManagedModelInstance):
    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.reserve_quota = Mock()


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
    model_instance = _ModelInstanceStub(model_schema=model_schema)
    model_type_instance = model_instance.model_type_instance
    prepared = DifyPreparedLLM(model_instance, request_metadata={"app_id": "app-id"})

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
        request_metadata={"app_id": "app-id"},
    )


def test_dify_prepared_llm_requires_model_schema() -> None:
    model_instance = _ModelInstanceStub(model_schema=None)
    model_instance.credentials = {}
    prepared = DifyPreparedLLM(model_instance)

    with pytest.raises(ValueError, match="Model schema not found"):
        prepared.get_model_schema()


def test_dify_prepared_llm_delegates_structured_output_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    model_instance = _ModelInstanceStub(model_schema=_build_model_schema())
    prepared = DifyPreparedLLM(model_instance, request_metadata={"created_by": "workflow"})
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
        request_metadata={"created_by": "workflow"},
    )


def test_dify_prepared_llm_identifies_structured_output_errors() -> None:
    prepared = DifyPreparedLLM(SimpleNamespace())

    assert prepared.is_structured_output_parse_error(OutputParserError("bad json")) is True
    assert prepared.is_structured_output_parse_error(ValueError("other")) is False


def test_dify_prepared_polling_llm_delegates_to_plugin_runtime() -> None:
    polling_result = LLMPollingResult(
        status=LLMPollingStatus.RUNNING,
        plugin_state={"task_id": "poll-1"},
        next_check_after_seconds=2,
    )
    plugin_runtime = PluginModelRuntime(
        tenant_id="tenant-id",
        user_id="user-id",
        client=PluginModelClient(),
        plugin_service=PluginService,
    )
    plugin_runtime.start_llm_polling = Mock(return_value=polling_result)  # type: ignore[method-assign]
    plugin_runtime.check_llm_polling = Mock(return_value=polling_result)  # type: ignore[method-assign]
    model_instance = _ModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=plugin_runtime,
    )

    prepared = DifyPreparedPollingLLM(model_instance)

    assert isinstance(prepared, LLMPollingCapableProtocol)
    assert (
        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={"temperature": 0.1},
            tools=[],
            stop=("END",),
            json_schema={"type": "object"},
        )
        == polling_result
    )
    assert (
        prepared.check_llm_polling(
            plugin_state={"task_id": "poll-1"},
        )
        == polling_result
    )
    plugin_runtime.start_llm_polling.assert_called_once_with(
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
        prompt_messages=[],
        model_parameters={"temperature": 0.1},
        tools=[],
        stop=("END",),
        json_schema={"type": "object"},
    )
    plugin_runtime.check_llm_polling.assert_called_once_with(
        provider="langgenius/openai/openai",
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
        plugin_state={"task_id": "poll-1"},
    )


def test_dify_prepared_polling_llm_commits_successful_reservation() -> None:
    running_result = LLMPollingResult(
        status=LLMPollingStatus.RUNNING,
        plugin_state={"task_id": "poll-1"},
    )
    usage = node_runtime.LLMUsage.empty_usage().model_copy(update={"total_tokens": 5})
    succeeded_result = LLMPollingResult(
        status=LLMPollingStatus.SUCCEEDED,
        result=node_runtime.LLMResult(
            model="gpt-4o-mini",
            prompt_messages=[],
            message=AssistantPromptMessage(content="done"),
            usage=usage,
        ),
    )
    plugin_runtime = PluginModelRuntime(
        tenant_id="tenant-id",
        user_id="user-id",
        client=PluginModelClient(),
        plugin_service=PluginService,
    )
    plugin_runtime.start_llm_polling = Mock(return_value=running_result)  # type: ignore[method-assign]
    plugin_runtime.check_llm_polling = Mock(return_value=succeeded_result)  # type: ignore[method-assign]
    reservation = MagicMock()
    model_instance = _QuotaManagedModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=plugin_runtime,
    )
    model_instance.reserve_quota.return_value = reservation
    prepared = DifyPreparedPollingLLM(model_instance)

    prepared.start_llm_polling(
        prompt_messages=[],
        model_parameters={},
        tools=None,
        stop=None,
        json_schema=None,
    )
    prepared.check_llm_polling(plugin_state={"task_id": "poll-1"})

    reservation.commit.assert_called_once_with(usage)
    reservation.release.assert_not_called()


def test_dify_prepared_polling_llm_releases_previous_reservation_on_restart() -> None:
    running_result = LLMPollingResult(
        status=LLMPollingStatus.RUNNING,
        plugin_state={"task_id": "poll-1"},
    )
    plugin_runtime = PluginModelRuntime(
        tenant_id="tenant-id",
        user_id="user-id",
        client=PluginModelClient(),
        plugin_service=PluginService,
    )
    plugin_runtime.start_llm_polling = Mock(return_value=running_result)  # type: ignore[method-assign]
    first_reservation = MagicMock()
    second_reservation = MagicMock()
    model_instance = _QuotaManagedModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=plugin_runtime,
    )
    model_instance.reserve_quota.side_effect = [first_reservation, second_reservation]
    prepared = DifyPreparedPollingLLM(model_instance)

    for _ in range(2):
        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={},
            tools=None,
            stop=None,
            json_schema=None,
        )

    first_reservation.release.assert_called_once_with()
    second_reservation.release.assert_not_called()
    assert model_instance.reserve_quota.call_count == 2


def test_dify_prepared_polling_llm_releases_reservation_when_finalized() -> None:
    running_result = LLMPollingResult(
        status=LLMPollingStatus.RUNNING,
        plugin_state={"task_id": "poll-1"},
    )
    polling_runtime = SimpleNamespace(
        start_llm_polling=Mock(return_value=running_result),
        check_llm_polling=Mock(),
    )
    reservation = MagicMock()
    model_instance = _QuotaManagedModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=polling_runtime,
    )
    model_instance.reserve_quota.return_value = reservation
    prepared = DifyPreparedPollingLLM(model_instance)

    prepared.start_llm_polling(
        prompt_messages=[],
        model_parameters={},
        tools=None,
        stop=None,
        json_schema=None,
    )
    prepared.finalize_llm_polling()
    prepared.finalize_llm_polling()

    reservation.release.assert_called_once_with()


def test_dify_prepared_polling_llm_releases_reservation_when_check_fails() -> None:
    running_result = LLMPollingResult(
        status=LLMPollingStatus.RUNNING,
        plugin_state={"task_id": "poll-1"},
    )
    polling_runtime = SimpleNamespace(
        start_llm_polling=Mock(return_value=running_result),
        check_llm_polling=Mock(side_effect=RuntimeError("polling failed")),
    )
    reservation = MagicMock()
    model_instance = _QuotaManagedModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=polling_runtime,
    )
    model_instance.reserve_quota.return_value = reservation
    prepared = DifyPreparedPollingLLM(model_instance)

    prepared.start_llm_polling(
        prompt_messages=[],
        model_parameters={},
        tools=None,
        stop=None,
        json_schema=None,
    )

    with pytest.raises(RuntimeError, match="polling failed"):
        prepared.check_llm_polling(plugin_state={"task_id": "poll-1"})

    reservation.release.assert_called_once_with()


def test_dify_prepared_polling_llm_raise_exception_when_polling_is_unsupported() -> None:
    llm_result = node_runtime.LLMResult(
        model="gpt-4o-mini",
        prompt_messages=[],
        message=AssistantPromptMessage(content="sync-result"),
        usage=node_runtime.LLMUsage.empty_usage(),
    )
    plugin_runtime = PluginModelRuntime(
        tenant_id="tenant-id",
        user_id="user-id",
        client=Mock(),
        plugin_service=Mock(),
    )
    plugin_runtime.start_llm_polling = Mock(side_effect=PluginLLMPollingUnsupportedError("Polling unsupported"))  # type: ignore[method-assign]
    model_instance = _ModelInstanceStub(
        model_schema=_build_model_schema(features=[ModelFeature.POLLING]),
        model_runtime=plugin_runtime,
        invoke_llm_result=llm_result,
    )

    prepared = DifyPreparedPollingLLM(model_instance)

    with pytest.raises(PluginLLMPollingUnsupportedError):
        prepared.start_llm_polling(
            prompt_messages=[],
            model_parameters={"temperature": 0.1},
            tools=None,
            stop=None,
            json_schema=None,
        )


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


def test_dify_retriever_attachment_loader_builds_graph_files(
    monkeypatch: pytest.MonkeyPatch, attachment_session: Session
) -> None:
    _persist_attachment(attachment_session, segment_id="segment-id", upload_file_id="upload-file-id")
    build_from_mapping = MagicMock(return_value=sentinel.file)
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=attachment_session.get_bind()))
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
    attachment_session: Session,
) -> None:
    from factories.file_factory import builders as file_builders

    upload_file_id = str(uuid4())
    segment_id = str(uuid4())
    _persist_attachment(attachment_session, segment_id=segment_id, upload_file_id=upload_file_id)
    engine = attachment_session.get_bind()
    assert engine is not None
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
    session_maker = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(file_builders.session_factory, "create_session", session_maker)

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
    assert files[0].filename == "diagram.png"


def test_dify_retriever_attachment_loader_rejects_granted_upload_file_from_another_tenant(
    monkeypatch: pytest.MonkeyPatch,
    attachment_session: Session,
) -> None:
    from factories.file_factory import builders as file_builders

    upload_file_id = str(uuid4())
    segment_id = str(uuid4())
    _persist_attachment(
        attachment_session,
        segment_id=segment_id,
        upload_file_id=upload_file_id,
        upload_file_tenant_id="other-tenant-id",
    )
    engine = attachment_session.get_bind()
    assert engine is not None
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
    monkeypatch.setattr(file_builders.session_factory, "create_session", sessionmaker(engine, expire_on_commit=False))

    loader = DifyRetrieverAttachmentLoader(file_reference_factory=DifyFileReferenceFactory(_build_run_context()))
    scope = FileAccessScope(
        tenant_id="tenant-id",
        user_id="end-user-id",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )

    with bind_file_access_scope(scope):
        grant_retriever_segment_access([segment_id])
        with pytest.raises(ValueError, match="Invalid upload file"):
            loader.load(segment_id=segment_id)


def test_dify_retriever_attachment_loader_skips_ungranted_segment_for_end_user(
    monkeypatch: pytest.MonkeyPatch,
    attachment_session: Session,
) -> None:
    build_from_mapping = MagicMock()
    engine = attachment_session.get_bind()
    assert engine is not None
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
    statement_count = 0

    def count_statements(*_args, **_kwargs) -> None:
        nonlocal statement_count
        statement_count += 1

    event.listen(engine, "before_cursor_execute", count_statements)
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

    try:
        assert files == []
        assert statement_count == 0
        build_from_mapping.assert_not_called()
    finally:
        event.remove(engine, "before_cursor_execute", count_statements)


def test_dify_retriever_attachment_loader_skips_segment_rejected_by_checker(
    monkeypatch: pytest.MonkeyPatch,
    attachment_session: Session,
) -> None:
    segment_id = str(uuid4())
    build_from_mapping = MagicMock()
    segment_access_checker = MagicMock(return_value=False)
    engine = attachment_session.get_bind()
    assert engine is not None
    monkeypatch.setattr(node_runtime, "db", SimpleNamespace(engine=engine))
    statement_count = 0

    def count_statements(*_args, **_kwargs) -> None:
        nonlocal statement_count
        statement_count += 1

    event.listen(engine, "before_cursor_execute", count_statements)
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

    try:
        assert files == []
        segment_access_checker.assert_called_once_with(segment_id)
        assert statement_count == 0
        build_from_mapping.assert_not_called()
    finally:
        event.remove(engine, "before_cursor_execute", count_statements)


def test_dify_tool_file_manager_resolves_conversation_id_for_tool_files(monkeypatch: pytest.MonkeyPatch) -> None:
    tool_file = ToolFile(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_key="tools/tenant-id/tool-file-id.png",
        mimetype="image/png",
        name="diagram.png",
        size=len(b"file-bytes"),
    )
    tool_file.id = "tool-file-id"
    create_file_by_raw = MagicMock(return_value=tool_file)
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


def test_dify_tool_node_runtime_stores_trace_session_id_for_workflow_tools(
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

    run_context = _build_run_context()
    run_context[DIFY_RUN_CONTEXT_KEY].trace_session_id = "session-1"
    runtime = node_runtime.DifyToolNodeRuntime(run_context)
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

    assert handle.raw.trace_session_id == "session-1"
    assert runtime_tool.runtime.runtime_parameters == {}


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
    # No conversation_id_getter wired -> a pure workflow run leaves it None.
    assert params.conversation_id is None
    assert params.display_in_ui is True
    assert len(params.delivery_methods) == 1
    assert params.delivery_methods[0].type == DeliveryMethodType.EMAIL
    assert params.delivery_methods[0].config.recipients.items[0].reference_id == "user-id"


def test_dify_human_input_runtime_create_form_tags_conversation_id_for_chatflow() -> None:
    # ENG-635 (review): a chatflow (advanced-chat) run carries a conversation, so its
    # Human Input form is tagged with BOTH its workflow run and its conversation —
    # making the form queryable per conversation without changing resume routing.
    repository = MagicMock()
    repository.create_form.return_value = sentinel.form
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())],
    )
    runtime = DifyHumanInputNodeRuntime(
        _build_run_context(),
        workflow_execution_id_getter=lambda: "workflow-execution-id",
        conversation_id_getter=lambda: "conversation-id",
        form_repository=repository,
    )

    runtime.create_form(
        node_id="human-input-node",
        node_data=node_data,
        rendered_content="<p>Rendered</p>",
        resolved_default_values={},
    )

    params = repository.create_form.call_args.args[0]
    assert params.workflow_execution_id == "workflow-execution-id"
    assert params.conversation_id == "conversation-id"


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


def test_dify_human_input_runtime_restore_submitted_data_rehydrates_files() -> None:
    runtime = DifyHumanInputNodeRuntime(_build_run_context())
    file_value = File(
        file_id="file-1",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="upload-1",
        filename="resume.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=128,
    )
    file_list_value = [
        File(
            file_id="file-2",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="upload-2",
            filename="first.pdf",
            extension=".pdf",
            mime_type="application/pdf",
            size=64,
        ),
        File(
            file_id="file-3",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/second.pdf",
            filename="second.pdf",
            extension=".pdf",
            mime_type="application/pdf",
            size=96,
        ),
    ]
    runtime._file_reference_factory.build_from_mapping = MagicMock(side_effect=[file_value, *file_list_value])  # type: ignore[method-assign]
    node_data = HumanInputNodeData(
        title="Human Input",
        inputs=[
            FileInputConfig(output_variable_name="attachment"),
            FileListInputConfig(output_variable_name="attachments", number_limits=2),
        ],
    )

    restored = runtime.restore_submitted_data(
        node_data=node_data,
        submitted_data={
            "attachment": {"upload_file_id": "upload-1", "type": "document", "transfer_method": "local_file"},
            "attachments": [
                {"upload_file_id": "upload-2", "type": "document", "transfer_method": "local_file"},
                {
                    "url": "https://example.com/second.pdf",
                    "type": "document",
                    "transfer_method": "remote_url",
                },
            ],
        },
    )

    assert restored["attachment"] is file_value
    assert restored["attachments"] == file_list_value
    assert isinstance(FileSegment(value=restored["attachment"]), FileSegment)
    assert isinstance(ArrayFileSegment(value=restored["attachments"]), ArrayFileSegment)


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


# --- confirmed Builder Tool node (one consented native call) ---------------------------------
#
# The native ToolEngine, PluginTool conversion and adapter run unmodified; only the plugin
# daemon transport and the consent callbacks are spies. Header values are SYNTHETIC.

_CONFIRMED_PARAMETERS = {"message_id": "18cab_1", "include_body": False, "include_attachments": False}


def _confirmed_guard(*, node_id: str = "tool-node", node_execution_id: str = "node-execution-id") -> Mock:
    guard = Mock()
    guard.binding = SimpleNamespace(
        node_id=node_id,
        native_node_execution_id=node_execution_id,
        context=SimpleNamespace(tenant_id="tenant-id", app_id="app-id"),
    )
    guard.dispatch_headers.return_value = {
        "X-Dify-Expected-Plugin-Identifier": "langgenius/dify-gmail:9.9.9@" + "f" * 64,
        "X-Dify-Expected-Installation-ID": "synthetic-installation",
        "X-Dify-Confirmed-Dispatch": "v1",
    }
    return guard


def _builtin_node_data(**changes: object) -> ToolNodeData:
    values: dict[str, object] = {
        "title": "Get message",
        "desc": None,
        "provider_id": "langgenius/dify-gmail/dify-gmail",
        "provider_type": ToolProviderType.BUILT_IN,
        "provider_name": "langgenius/dify-gmail/dify-gmail",
        "tool_name": "get_message",
        "tool_label": "Get message",
        "tool_configurations": {},
        "tool_parameters": {
            name: {"type": "constant", "value": value} for name, value in _CONFIRMED_PARAMETERS.items()
        },
        **changes,
    }
    return ToolNodeData.model_validate(values)


def test_confirmed_tool_runtime_is_resolved_with_the_guard_for_its_bound_node(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime_tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))
    get_runtime = MagicMock(return_value=runtime_tool)
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    monkeypatch.setattr(node_runtime, "get_system_text", lambda _pool, _key: None)
    guard = _confirmed_guard()

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard=guard)
    handle = runtime.get_runtime(
        node_id="tool-node",
        node_data=_builtin_node_data(),
        variable_pool=None,
        node_execution_id="node-execution-id",
    )

    assert DifyToolNodeRuntime._tool_from_handle(handle) is runtime_tool
    get_runtime.assert_called_once()
    assert get_runtime.call_args.kwargs["confirmed_guard"] is guard


@pytest.mark.parametrize(
    ("node_id", "node_execution_id", "changes", "context"),
    [
        ("other-node", "node-execution-id", {}, {}),
        ("tool-node", "other-execution", {}, {}),
        ("tool-node", None, {}, {}),
        ("tool-node", "node-execution-id", {"tool_configurations": {"secret": "x"}}, {}),
        ("tool-node", "node-execution-id", {}, {"tenant_id": "other-tenant"}),
        ("tool-node", "node-execution-id", {}, {"app_id": "other-app"}),
    ],
)
def test_confirmed_tool_runtime_refuses_anything_but_its_exact_bound_node(
    monkeypatch: pytest.MonkeyPatch,
    node_id: str,
    node_execution_id: str | None,
    changes: dict[str, object],
    context: dict[str, str],
) -> None:
    get_runtime = MagicMock()
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    guard = _confirmed_guard()
    guard.binding.context = SimpleNamespace(**{"tenant_id": "tenant-id", "app_id": "app-id", **context})

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard=guard)
    with pytest.raises(node_runtime.ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id=node_id,
            node_data=_builtin_node_data(**changes),
            variable_pool=None,
            node_execution_id=node_execution_id,
        )
    get_runtime.assert_not_called()


def _confirmed_plugin_tool(guard: Mock) -> PluginTool:
    entity = ToolEntity(
        identity=ToolIdentity(
            author="langgenius",
            name="get_message",
            label=ToolI18nObject(en_US="Get message"),
            provider="langgenius/dify-gmail/dify-gmail",
        ),
        parameters=[
            ToolParameter.get_simple_instance(name=name, llm_description=name, typ=typ, required=True)
            for name, typ in [
                ("message_id", ToolParameter.ToolParameterType.STRING),
                ("include_body", ToolParameter.ToolParameterType.BOOLEAN),
                ("include_attachments", ToolParameter.ToolParameterType.BOOLEAN),
            ]
        ],
    )
    runtime = ToolRuntime(
        tenant_id="tenant-id", credential_type=CredentialType.OAUTH2, credentials={"access_token": "unit-token"}
    )
    return PluginTool(
        entity=entity,
        runtime=runtime,
        tenant_id="tenant-id",
        icon="",
        plugin_unique_identifier="unit-artifact",
        confirmed_guard=guard,
    )


class _ConfirmedTransport:
    """Plugin daemon stream spy recording the caller's session state at every callback."""

    def __init__(self, sessions: list[Session], *, fail_after: int | None = None) -> None:
        self.sessions = sessions
        self.fail_after = fail_after
        self.observed: list[bool] = []
        self.calls = 0

    def __call__(self, *_args: object, **_kwargs: object) -> Generator[ToolInvokeMessage, None, None]:
        self.calls += 1
        self.observed.append(self.sessions[-1].in_transaction())

        def stream() -> Generator[ToolInvokeMessage, None, None]:
            messages = [
                ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="ok")
                ),
                ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.JSON,
                    message=ToolInvokeMessage.JsonMessage(
                        json_object={"message": {"id": "18cab_1"}, "message_id": "18cab_1"}
                    ),
                ),
            ]
            for index, message in enumerate(messages):
                self.observed.append(self.sessions[-1].in_transaction())
                if self.fail_after == index:
                    raise RuntimeError("native daemon failure")
                yield message

        return stream()


def _recording_session_maker(engine: Engine) -> tuple[Mock, list[Session]]:
    factory = sessionmaker(engine, expire_on_commit=False)
    sessions: list[Session] = []

    def open_session() -> Session:
        session = factory()
        sessions.append(session)
        return session

    @contextmanager
    def begin() -> Generator[Session, None, None]:
        with factory.begin() as session:
            sessions.append(session)
            yield session

    maker = Mock(side_effect=open_session)
    maker.begin = Mock(side_effect=begin)
    return maker, sessions


def _confirmed_invoke(runtime: DifyToolNodeRuntime, guard: Mock) -> Generator[ToolRuntimeMessage, None, None]:
    return runtime.invoke(
        tool_runtime=ToolRuntimeHandle(raw=_confirmed_plugin_tool(guard)),
        tool_parameters=dict(_CONFIRMED_PARAMETERS),
        workflow_call_depth=0,
        provider_name="langgenius/dify-gmail/dify-gmail",
    )


def test_confirmed_invoke_consumes_with_a_closed_session_not_the_ordinary_begin(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    maker, sessions = _recording_session_maker(sqlite_engine)
    transport = _ConfirmedTransport(sessions)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    guard = _confirmed_guard()
    guard.before_invoke.side_effect = lambda _parameters: transport.observed.append(sessions[-1].in_transaction())

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard=guard)
    messages = list(_confirmed_invoke(runtime, guard))

    assert [message.type.value for message in messages] == ["text", "json"]
    maker.assert_called_once_with()
    maker.begin.assert_not_called()
    assert transport.calls == 1
    assert transport.observed
    assert not any(transport.observed)
    guard.before_invoke.assert_called_once_with(_CONFIRMED_PARAMETERS)
    guard.finish_stream.assert_called_once_with(complete=True, declared_failure=False)


def test_confirmed_invoke_refuses_a_session_already_in_transaction(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    factory = sessionmaker(sqlite_engine, expire_on_commit=False)

    def open_session() -> Session:
        session = factory()
        session.begin()
        return session

    maker = Mock(side_effect=open_session)
    transport = Mock()
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    guard = _confirmed_guard()

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard=guard)
    with pytest.raises(node_runtime.ToolRuntimeInvocationError):
        list(_confirmed_invoke(runtime, guard))
    guard.before_invoke.assert_not_called()
    transport.assert_not_called()


def test_confirmed_invoke_cancellation_finishes_unknown_exactly_once(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    maker, sessions = _recording_session_maker(sqlite_engine)
    transport = _ConfirmedTransport(sessions)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    guard = _confirmed_guard()

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard=guard)
    stream = _confirmed_invoke(runtime, guard)
    assert next(stream).type.value == "text"
    stream.close()

    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)
    assert transport.calls == 1


def test_confirmed_native_exception_stays_unknown_not_declared_failure(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    maker, sessions = _recording_session_maker(sqlite_engine)
    transport = _ConfirmedTransport(sessions, fail_after=1)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    guard = _confirmed_guard()

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard=guard)
    with pytest.raises(node_runtime.ToolRuntimeInvocationError):
        list(_confirmed_invoke(runtime, guard))

    # Graphon reports a native failure; the consent outcome input stays unknown (incomplete).
    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)


def test_ordinary_tool_invoke_keeps_its_begin_transaction(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    maker, _sessions = _recording_session_maker(sqlite_engine)
    sessions_in_transaction: list[bool] = []

    def generic_invoke(**kwargs: object) -> Iterator[ToolInvokeMessage]:
        session = kwargs["session"]
        assert isinstance(session, Session)
        sessions_in_transaction.append(session.in_transaction())
        return iter(())

    monkeypatch.setattr(node_runtime.ToolEngine, "generic_invoke", generic_invoke)
    tool = SimpleNamespace(runtime=SimpleNamespace(runtime_parameters={}))

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker)
    list(
        runtime.invoke(
            tool_runtime=ToolRuntimeHandle(raw=tool),
            tool_parameters={},
            workflow_call_depth=0,
            provider_name="provider",
        )
    )

    maker.begin.assert_called_once_with()
    maker.assert_not_called()
    assert sessions_in_transaction == [True]


# --- confirmed guard factory: lazy claim at Graphon's actual node-execution-ID callback --------


class _GuardFactory:
    """Server-owned factory stand-in; records the actual callback order and arguments."""

    def __init__(self, events: list[str], *, result: Mock | None | Exception = None) -> None:
        self.events = events
        self.result = result
        self.calls: list[tuple[str, str]] = []

    def __call__(self, node_id: str, node_execution_id: str) -> ConfirmedToolGuard:
        self.events.append("factory")
        self.calls.append((node_id, node_execution_id))
        if isinstance(self.result, Exception):
            raise self.result
        if self.result is None:
            return _confirmed_guard(node_id=node_id, node_execution_id=node_execution_id)
        return self.result


def _recording_tool_manager(monkeypatch: pytest.MonkeyPatch, events: list[str]) -> MagicMock:
    def resolve(*_args: object, **kwargs: object) -> PluginTool:
        events.append("tool_manager")
        guard = kwargs["confirmed_guard"]
        assert isinstance(guard, Mock)
        return _confirmed_plugin_tool(guard)

    get_runtime = MagicMock(side_effect=resolve)
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    return get_runtime


def test_guard_factory_claims_at_the_actual_execution_id_before_resolution(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    events: list[str] = []
    get_runtime = _recording_tool_manager(monkeypatch, events)
    factory = _GuardFactory(events)
    maker, sessions = _recording_session_maker(sqlite_engine)
    transport = _ConfirmedTransport(sessions)
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard_factory=factory)
    handle = runtime.get_runtime(
        node_id="tool-node", node_data=_builtin_node_data(), variable_pool=None, node_execution_id="actual-exec-7"
    )

    assert events == ["factory", "tool_manager"]
    assert factory.calls == [("tool-node", "actual-exec-7")]
    guard = get_runtime.call_args.kwargs["confirmed_guard"]
    assert guard.binding.native_node_execution_id == "actual-exec-7"
    messages = list(
        runtime.invoke(
            tool_runtime=handle,
            tool_parameters=dict(_CONFIRMED_PARAMETERS),
            workflow_call_depth=0,
            provider_name="langgenius/dify-gmail/dify-gmail",
        )
    )
    assert [message.type.value for message in messages] == ["text", "json"]
    maker.begin.assert_not_called()
    assert not any(transport.observed)
    guard.finish_stream.assert_called_once_with(complete=True, declared_failure=False)


@pytest.mark.parametrize("node_execution_id", [None, ""])
def test_guard_factory_requires_a_real_execution_id(
    monkeypatch: pytest.MonkeyPatch, node_execution_id: str | None
) -> None:
    events: list[str] = []
    get_runtime = _recording_tool_manager(monkeypatch, events)
    factory = _GuardFactory(events)

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=factory)
    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="execution_launch_mismatch"):
        runtime.get_runtime(
            node_id="tool-node",
            node_data=_builtin_node_data(),
            variable_pool=None,
            node_execution_id=node_execution_id,
        )
    assert factory.calls == []
    get_runtime.assert_not_called()


_FACTORY_SECRET = "factory-secret-sentinel-5d1"


def _other_tenant_guard() -> Mock:
    guard = _confirmed_guard(node_id="tool-node", node_execution_id="actual-exec-7")
    guard.binding.context = SimpleNamespace(tenant_id="other-tenant", app_id="app-id")
    return guard


@pytest.mark.parametrize(
    ("result", "reason"),
    [
        (RuntimeError(f"claim failed {_FACTORY_SECRET}"), "confirmed_guard_unavailable"),
        (BuilderExecutionPolicyError("consent_expired"), "consent_expired"),
        (_confirmed_guard(node_id="other-node", node_execution_id="actual-exec-7"), "execution_launch_mismatch"),
        (_confirmed_guard(node_id="tool-node", node_execution_id="other-exec"), "execution_launch_mismatch"),
        (_other_tenant_guard(), "execution_launch_mismatch"),
    ],
    ids=["factory-raises", "factory-refuses", "wrong-node", "wrong-execution", "wrong-tenant"],
)
def test_failing_or_mismatched_factory_never_falls_through_to_ordinary_resolution(
    monkeypatch: pytest.MonkeyPatch, result: Mock | Exception, reason: str
) -> None:
    events: list[str] = []
    get_runtime = _recording_tool_manager(monkeypatch, events)
    factory = _GuardFactory(events, result=result)

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=factory)
    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match=reason) as raised:
        runtime.get_runtime(
            node_id="tool-node", node_data=_builtin_node_data(), variable_pool=None, node_execution_id="actual-exec-7"
        )
    assert _FACTORY_SECRET not in str(raised.value)
    assert factory.calls == [("tool-node", "actual-exec-7")]
    get_runtime.assert_not_called()


def test_factory_returning_no_guard_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    get_runtime = MagicMock()
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)

    def factory(_node_id: str, _node_execution_id: str) -> ConfirmedToolGuard:
        return cast(ConfirmedToolGuard, None)

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=factory)
    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="confirmed_guard_unavailable"):
        runtime.get_runtime(
            node_id="tool-node", node_data=_builtin_node_data(), variable_pool=None, node_execution_id="actual-exec-7"
        )
    get_runtime.assert_not_called()


@pytest.mark.parametrize(
    ("node_id", "node_execution_id"),
    [("tool-node", "actual-exec-7"), ("tool-node", "actual-exec-8"), ("other-node", "actual-exec-9")],
)
def test_bound_factory_guard_is_never_rebuilt_on_replay(
    monkeypatch: pytest.MonkeyPatch, node_id: str, node_execution_id: str
) -> None:
    events: list[str] = []
    get_runtime = _recording_tool_manager(monkeypatch, events)
    factory = _GuardFactory(events)

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=factory)
    runtime.get_runtime(
        node_id="tool-node", node_data=_builtin_node_data(), variable_pool=None, node_execution_id="actual-exec-7"
    )
    with pytest.raises(node_runtime.ToolRuntimeResolutionError):
        runtime.get_runtime(
            node_id=node_id, node_data=_builtin_node_data(), variable_pool=None, node_execution_id=node_execution_id
        )
    assert factory.calls == [("tool-node", "actual-exec-7")]
    assert get_runtime.call_count == 1


def test_configured_but_unbound_factory_refuses_direct_invoke(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    factory = _GuardFactory(events)
    transport = Mock()
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    guard = _confirmed_guard()
    maker = Mock()

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard_factory=factory)
    with pytest.raises(node_runtime.ToolRuntimeInvocationError, match="confirmed_guard_unavailable"):
        list(_confirmed_invoke(runtime, guard))
    assert factory.calls == []
    maker.assert_not_called()
    maker.begin.assert_not_called()
    guard.before_invoke.assert_not_called()
    transport.assert_not_called()


def test_bound_guard_refuses_a_handle_for_another_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = Mock()
    monkeypatch.setattr(PluginToolManager, "_request_with_plugin_daemon_response_stream", transport)
    bound = _confirmed_guard()
    maker = Mock()

    runtime = DifyToolNodeRuntime(_build_run_context(), session_maker=maker, confirmed_guard=bound)
    with pytest.raises(node_runtime.ToolRuntimeInvocationError, match="execution_launch_mismatch"):
        list(_confirmed_invoke(runtime, _confirmed_guard()))
    maker.assert_not_called()
    transport.assert_not_called()


def test_configured_node_is_refused_before_the_factory_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    get_runtime = _recording_tool_manager(monkeypatch, events)
    factory = _GuardFactory(events)

    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=factory)
    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="unsupported_tool_configuration"):
        runtime.get_runtime(
            node_id="tool-node",
            node_data=_builtin_node_data(tool_configurations={"secret": "x"}),
            variable_pool=None,
            node_execution_id="actual-exec-7",
        )
    assert factory.calls == []
    get_runtime.assert_not_called()


_RESOLUTION_SECRET = "resolution-secret-sentinel-8e2"


@pytest.mark.parametrize("use_factory", [False, True], ids=["ready-guard", "factory-guard"])
@pytest.mark.parametrize(
    "error",
    [
        RuntimeError(f"daemon said {_RESOLUTION_SECRET}"),
        ValueError(f"credential row {_RESOLUTION_SECRET}"),
        node_runtime.ToolRuntimeResolutionError(f"native {_RESOLUTION_SECRET}"),
    ],
    ids=["runtime-error", "value-error", "tool-node-error"],
)
def test_unexpected_confirmed_resolution_error_is_sanitized(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, error: Exception, use_factory: bool
) -> None:
    get_runtime = MagicMock(side_effect=error)
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    if use_factory:
        runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard_factory=_GuardFactory([]))
    else:
        runtime = DifyToolNodeRuntime(
            _build_run_context(), confirmed_guard=_confirmed_guard(node_execution_id="actual-exec-7")
        )

    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="confirmed_tool_resolution_failed") as raised:
        runtime.get_runtime(
            node_id="tool-node", node_data=_builtin_node_data(), variable_pool=None, node_execution_id="actual-exec-7"
        )

    assert _RESOLUTION_SECRET not in str(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    assert _RESOLUTION_SECRET not in caplog.text
    get_runtime.assert_called_once()


def test_declared_confirmed_policy_refusal_keeps_its_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    get_runtime = MagicMock(side_effect=BuilderExecutionPolicyError("credential_cache_unavailable"))
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    runtime = DifyToolNodeRuntime(_build_run_context(), confirmed_guard=_confirmed_guard())

    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="credential_cache_unavailable") as raised:
        runtime.get_runtime(
            node_id="tool-node",
            node_data=_builtin_node_data(),
            variable_pool=None,
            node_execution_id="node-execution-id",
        )
    assert "confirmed_tool_resolution_failed" not in str(raised.value)


def test_ordinary_resolution_error_keeps_native_text(monkeypatch: pytest.MonkeyPatch) -> None:
    get_runtime = MagicMock(side_effect=RuntimeError("ordinary provider detail"))
    monkeypatch.setattr(node_runtime.ToolManager, "get_workflow_tool_runtime", get_runtime)
    runtime = DifyToolNodeRuntime(_build_run_context())

    with pytest.raises(node_runtime.ToolRuntimeResolutionError, match="ordinary provider detail") as raised:
        runtime.get_runtime(
            node_id="tool-node",
            node_data=_builtin_node_data(),
            variable_pool=None,
            node_execution_id="node-execution-id",
        )
    assert isinstance(raised.value.__cause__, RuntimeError)


def test_guard_and_factory_together_are_refused() -> None:
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_confirmed_configuration"):
        DifyToolNodeRuntime(
            _build_run_context(), confirmed_guard=_confirmed_guard(), confirmed_guard_factory=_GuardFactory([])
        )
