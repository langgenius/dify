"""Composition tests for the API-owned Agent LLM gateway."""

from collections.abc import Callable, Generator
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from pydantic import JsonValue
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_entities import (
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    SystemConfiguration,
)
from core.model_manager import ModelInstance, ModelManager, QuotaManagedModelInstance
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    UserPromptMessage,
    VideoPromptMessageContent,
)
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelType
from models.model import App, AppMode
from models.provider import ProviderType
from services.agent_llm_inner_service import (
    AgentLLMInnerService,
    AgentLLMInnerServiceError,
    PreparedAgentLLMInvocation,
)
from services.billing_client import billing
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance


def _request() -> AgentLLMInvokeRequest:
    return AgentLLMInvokeRequest(
        caller=AgentLLMInvokeCaller(
            invocation_id=str(uuid4()),
            agent_run_id=str(uuid4()),
            call_index=1,
            tenant_id=str(uuid4()),
            user_id=str(uuid4()),
            user_from="account",
            app_id=str(uuid4()),
            invoke_from="debugger",
            agent_mode="workflow_run",
            agent_config_version_kind="draft",
            trace_id="trace-1",
        ),
        target=AgentLLMInvokeTarget(
            provider="openai",
            model="gpt-test",
            prompt_messages=[UserPromptMessage(content="hello").model_dump(mode="json")],
        ),
    )


@pytest.fixture
def media_gateway(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> tuple[AgentLLMInnerService, MagicMock]:
    """Keep real model/config objects and replace provider lookup and invocation I/O."""
    instance = make_model_instance(provider="openai", model="gpt-test")
    configuration = instance.provider_model_bundle.configuration
    provider_model = ModelWithProviderEntity(
        model="gpt-test",
        label=configuration.provider.label,
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        status=ModelStatus.ACTIVE,
        provider=SimpleModelProviderEntity(configuration.provider),
    )
    mocker.patch.object(ModelManager, "get_model_instance", return_value=instance)
    mocker.patch.object(type(configuration), "get_provider_model", return_value=provider_model)
    invoke = mocker.patch.object(instance, "invoke_llm", return_value=iter([]))
    return AgentLLMInnerService(session_factory=sqlite_session_factory), invoke


@pytest.mark.parametrize("filename", ["chart.png", "chart.pdf"])
@pytest.mark.parametrize("transfer_method", ["tool_file", "local_file", "datasource_file"])
@pytest.mark.parametrize("authoritative_mime", ["image/png", "application/octet-stream", "image/jpg"])
def test_managed_media_resolution_uses_authorized_records_and_preserves_wire_request(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    filename: str,
    transfer_method: str,
    authoritative_mime: str,
) -> None:
    from datetime import datetime

    from core.workflow.file_reference import build_file_reference
    from extensions.storage.storage_type import StorageType
    from models import ToolFile, UploadFile
    from models.enums import CreatorUserRole

    config_overrides(MULTIMODAL_SEND_FORMAT="url", FILES_URL="https://files.example.com")
    request = _request()
    _persist_app(sqlite_session, request=request)
    requested_mime = "image/jpeg" if authoritative_mime == "image/jpg" else "image/png"
    requested_format = "jpeg" if requested_mime == "image/jpeg" else "png"
    if transfer_method == "tool_file":
        record = ToolFile(
            tenant_id=request.caller.tenant_id,
            user_id=request.caller.user_id,
            conversation_id=None,
            file_key=f"tools/{filename}",
            name=filename,
            mimetype=authoritative_mime,
            size=25,
        )
    else:
        record = UploadFile(
            tenant_id=request.caller.tenant_id,
            created_by=request.caller.user_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            storage_type=StorageType.OPENDAL,
            key=f"uploads/{filename}",
            name=filename,
            size=25,
            extension=filename.rsplit(".", 1)[1],
            mime_type=authoritative_mime,
            created_at=datetime.now(),
            used=False,
        )
    sqlite_session.add(record)
    sqlite_session.commit()
    reference = build_file_reference(record_id=record.id)
    original_url = f"dify-file://{transfer_method}/{reference}"
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(
                    url=original_url,
                    mime_type=requested_mime,
                    format=requested_format,
                    detail=ImagePromptMessageContent.DETAIL.HIGH,
                )
            ]
        ).model_dump(mode="json")
    ]
    original_request = request.model_dump(mode="json")
    service, invoke = media_gateway
    prepared = service.prepare(request)
    assert list(service.invoke(prepared)) == []
    invoke.assert_called_once()
    resolved = invoke.call_args.kwargs["prompt_messages"]
    message = UserPromptMessage.model_validate(resolved[0])
    assert isinstance(message.content, list)
    content = message.content[0]
    assert isinstance(content, ImagePromptMessageContent)
    assert content.detail == ImagePromptMessageContent.DETAIL.HIGH
    assert content.mime_type == requested_mime
    assert content.format == requested_format
    assert content.base64_data == ""
    assert content.url.startswith("https://files.example.com/files/")
    expected_path = (
        f"/files/tools/{record.id}.{requested_format}"
        if transfer_method == "tool_file"
        else f"/files/{record.id}/file-preview"
    )
    assert urlsplit(content.url).path == expected_path
    assert "dify-file://" not in content.url
    assert request.model_dump(mode="json") == original_request


@pytest.mark.parametrize("send_format", ["url", "base64"])
def test_datasource_media_uses_upload_file_preview_and_storage(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    send_format: str,
) -> None:
    """Given an authorized datasource file, rendering uses its signed UploadFile preview or stored bytes."""
    import base64

    from core.workflow.file_reference import build_file_reference
    from extensions.ext_storage import storage
    from extensions.storage.opendal_storage import OpenDALStorage
    from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
    from services.upload_file_delivery_service import UploadFileDeliveryService
    from tests.helpers.unit.model_factories import make_upload_file

    config_overrides(MULTIMODAL_SEND_FORMAT=send_format, FILES_URL="https://files.example.com")
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False)
    request = _request()
    _persist_app(sqlite_session, request=request)
    payload = b"stored datasource image"
    record = make_upload_file(
        tenant_id=request.caller.tenant_id,
        created_by=request.caller.user_id,
        key="uploads/chart.png",
        name="chart.png",
        extension="png",
        mime_type="image/png",
        size=len(payload),
    )
    sqlite_session.add(record)
    sqlite_session.commit()
    storage.save(record.key, payload)
    reference = build_file_reference(record_id=record.id)
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(
                    url=f"dify-file://datasource_file/{reference}", mime_type="image/png", format="png"
                )
            ]
        ).model_dump(mode="json")
    ]
    original_request = request.model_dump(mode="json")
    service, invoke = media_gateway
    assert list(service.invoke(service.prepare(request))) == []
    message = UserPromptMessage.model_validate(invoke.call_args.kwargs["prompt_messages"][0])
    assert isinstance(message.content, list)
    content = message.content[0]
    assert isinstance(content, ImagePromptMessageContent)
    if send_format == "url":
        parsed = urlsplit(content.url)
        assert parsed.path == f"/files/{record.id}/file-preview"
        query = parse_qs(parsed.query)
        delivery = UploadFileDeliveryService(
            files=UploadFileDeliveryQueryRepository(session_factory=sqlite_session_factory), storage=storage
        ).get_signed_file_preview(
            file_id=record.id, timestamp=query["timestamp"][0], nonce=query["nonce"][0], sign=query["sign"][0]
        )
        assert not isinstance(delivery.content, bytes)
        assert b"".join(delivery.content) == payload
        assert content.base64_data == ""
    else:
        assert base64.b64decode(content.base64_data) == payload
        assert content.url == ""
    assert request.model_dump(mode="json") == original_request


@pytest.mark.parametrize(
    ("content_type", "mime_type", "media_format"),
    [
        (AudioPromptMessageContent, "audio/wav", "wav"),
        (VideoPromptMessageContent, "video/mp4", "mp4"),
        (DocumentPromptMessageContent, "application/pdf", "pdf"),
    ],
)
def test_managed_non_image_media_reaches_model_with_its_original_modality(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    content_type: type[AudioPromptMessageContent | VideoPromptMessageContent | DocumentPromptMessageContent],
    mime_type: str,
    media_format: str,
) -> None:
    from core.workflow.file_reference import build_file_reference
    from models import ToolFile

    config_overrides(MULTIMODAL_SEND_FORMAT="url", FILES_URL="https://files.example.com")
    request = _request()
    _persist_app(sqlite_session, request=request)
    filename = f"media.{media_format}"
    record = ToolFile(
        tenant_id=request.caller.tenant_id,
        user_id=request.caller.user_id,
        conversation_id=None,
        file_key=f"tools/{filename}",
        name=filename,
        mimetype=mime_type,
        size=25,
    )
    sqlite_session.add(record)
    sqlite_session.commit()
    reference = build_file_reference(record_id=record.id)
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[content_type(url=f"dify-file://tool_file/{reference}", mime_type=mime_type, format=media_format)]
        ).model_dump(mode="json")
    ]
    original_request = request.model_dump(mode="json")
    service, invoke = media_gateway
    prepared = service.prepare(request)
    assert list(service.invoke(prepared)) == []
    invoke.assert_called_once()
    message = UserPromptMessage.model_validate(invoke.call_args.kwargs["prompt_messages"][0])
    assert isinstance(message.content, list)
    content = message.content[0]
    assert isinstance(content, content_type)
    assert content.mime_type == mime_type
    assert content.format == media_format
    assert content.filename == filename
    assert content.base64_data == ""
    assert content.url.startswith(f"https://files.example.com/files/tools/{record.id}.{media_format}?")
    assert "sign=" in content.url
    assert "dify-file://" not in content.url
    assert request.model_dump(mode="json") == original_request


@pytest.mark.parametrize("failure", ["tenant", "owner", "deleted"])
def test_managed_media_resolution_rechecks_scope(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    failure: str,
) -> None:
    from core.app.file_access import get_current_file_access_scope
    from core.workflow.file_reference import build_file_reference
    from models import ToolFile

    config_overrides(MULTIMODAL_SEND_FORMAT="url")
    request = _request()
    _persist_app(sqlite_session, request=request)
    request.caller.user_from = "end-user"
    record = ToolFile(
        tenant_id=str(uuid4()) if failure == "tenant" else request.caller.tenant_id,
        user_id=str(uuid4()) if failure == "owner" else request.caller.user_id,
        conversation_id=None,
        file_key="tools/chart.png",
        name="chart.png",
        mimetype="image/png",
        size=25,
    )
    sqlite_session.add(record)
    sqlite_session.commit()
    record_id = str(uuid4()) if failure == "deleted" else record.id
    reference = build_file_reference(record_id=record_id)
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(
                    url=f"dify-file://tool_file/{reference}",
                    mime_type="image/png",
                    format="png",
                )
            ]
        ).model_dump(mode="json")
    ]
    original_scope = get_current_file_access_scope()
    service, invoke = media_gateway
    with pytest.raises(ValueError, match=f"^ToolFile {record_id} not found$"):
        service.prepare(request)
    invoke.assert_not_called()
    assert get_current_file_access_scope() is original_scope


@pytest.mark.parametrize(
    ("content", "match"),
    [
        (
            ImagePromptMessageContent(
                url="dify-file://tool_file/not-a-canonical-reference", mime_type="image/png", format="png"
            ).model_dump(mode="json"),
            "^Invalid managed media reference$",
        ),
        (
            ImagePromptMessageContent(
                url="dify-file://remote_url/dify-file-ref:eyJyZWNvcmRfaWQiOiJmaWxlIn0=",
                mime_type="image/png",
                format="png",
            ).model_dump(mode="json"),
            "^Invalid managed media reference$",
        ),
        (
            {
                "type": "text",
                "data": "hello",
                "url": "dify-file://tool_file/dify-file-ref:eyJyZWNvcmRfaWQiOiJmaWxlIn0=",
            },
            "^Managed media reference requires a multimodal content block$",
        ),
    ],
)
def test_managed_media_rejects_invalid_content_before_record_lookup(
    sqlite_session: Session,
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    content: dict[str, JsonValue],
    match: str,
) -> None:
    """Given managed wire content, prepare rejects invalid locators or text blocks before model invocation."""
    request = _request()
    _persist_app(sqlite_session, request=request)
    # Preserve raw wire content: constructing a typed text block would discard its forged URL.
    request.target.prompt_messages = [{"role": "user", "content": [content]}]
    service, invoke = media_gateway
    with pytest.raises(ValueError, match=match):
        service.prepare(request)
    invoke.assert_not_called()


@pytest.mark.parametrize("authoritative_mime", ["application/pdf", "image/jpeg"])
def test_managed_media_rejects_authoritative_mime_conflicts(
    sqlite_session: Session,
    media_gateway: tuple[AgentLLMInnerService, MagicMock],
    authoritative_mime: str,
) -> None:
    from core.workflow.file_reference import build_file_reference
    from models import ToolFile

    request = _request()
    _persist_app(sqlite_session, request=request)
    record = ToolFile(
        tenant_id=request.caller.tenant_id,
        user_id=request.caller.user_id,
        conversation_id=None,
        file_key="tools/chart.png",
        name="chart.png",
        mimetype=authoritative_mime,
        size=25,
    )
    sqlite_session.add(record)
    sqlite_session.commit()
    reference = build_file_reference(record_id=record.id)
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(url=f"dify-file://tool_file/{reference}", mime_type="image/png", format="png")
            ]
        ).model_dump(mode="json")
    ]
    service, invoke = media_gateway
    with pytest.raises(ValueError, match="^Managed media MIME does not match the requested content type$"):
        service.prepare(request)
    invoke.assert_not_called()


def test_remote_media_url_is_not_resolved_or_rewritten(
    sqlite_session: Session, media_gateway: tuple[AgentLLMInnerService, MagicMock]
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    request.target.prompt_messages = [
        UserPromptMessage(
            content=[
                ImagePromptMessageContent(
                    url="https://example.com/original.png?key=1",
                    mime_type="image/png",
                    format="png",
                )
            ]
        ).model_dump(mode="json")
    ]
    original_request = request.model_dump(mode="json")
    service, invoke = media_gateway
    assert list(service.invoke(service.prepare(request))) == []
    assert invoke.call_args.kwargs["prompt_messages"] is request.target.prompt_messages
    assert request.model_dump(mode="json") == original_request


def _model_instance(
    *,
    status: ModelStatus = ModelStatus.ACTIVE,
) -> tuple[QuotaManagedModelInstance, MagicMock]:
    provider_model = MagicMock()
    provider_model.status = status
    configuration = MagicMock()
    configuration.get_provider_model.return_value = provider_model
    configuration.provider.provider = "openai"
    configuration.model_settings = list[ModelSettings]()
    bundle = MagicMock()
    bundle.configuration = configuration
    bundle.model_type_instance = make_model_instance(provider="openai", model="gpt-test").model_type_instance

    instance = QuotaManagedModelInstance(
        provider_model_bundle=bundle, model="gpt-test", credentials={"api_key": "hosted"}
    )
    return instance, provider_model


def _persist_app(
    session: Session,
    *,
    request: AgentLLMInvokeRequest,
    tenant_id: str | None = None,
    mode: AppMode = AppMode.CHAT,
) -> App:
    app = App(
        id=request.caller.app_id,
        tenant_id=tenant_id or request.caller.tenant_id,
        name="Agent LLM gateway test app",
        description="",
        mode=mode,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
    )
    session.add(app)
    session.commit()
    return app


def _prepare(
    service: AgentLLMInnerService,
    request: AgentLLMInvokeRequest,
    model_instance: QuotaManagedModelInstance,
) -> PreparedAgentLLMInvocation:
    manager = MagicMock()
    manager.get_model_instance.return_value = model_instance
    with (
        patch("services.agent_llm_inner_service.create_plugin_provider_manager"),
        patch("services.agent_llm_inner_service.ModelManager", return_value=manager),
    ):
        return service.prepare(request)


def _usage(*, total_tokens: int = 8) -> LLMUsage:
    return LLMUsage(
        prompt_tokens=3,
        prompt_unit_price=Decimal(0),
        prompt_price_unit=Decimal(0),
        prompt_price=Decimal(0),
        completion_tokens=total_tokens - 3,
        completion_unit_price=Decimal(0),
        completion_price_unit=Decimal(0),
        completion_price=Decimal(0),
        total_tokens=total_tokens,
        total_price=Decimal(0),
        currency="USD",
        latency=0.1,
    )


def _chunk(text: str, *, usage: LLMUsage | None = None) -> LLMResultChunk:
    return LLMResultChunk(
        model="gpt-test",
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content=text, tool_calls=[]),
            usage=usage,
        ),
    )


def test_prepare_rejects_missing_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        service.prepare(request)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404


def test_prepare_rejects_cross_tenant_app(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request, tenant_id=str(uuid4()))
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        service.prepare(request)

    assert exc_info.value.error_code == "app_tenant_mismatch"
    assert exc_info.value.status_code == 403


def test_prepare_defers_cached_quota_status_to_authoritative_reservation(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, provider_model = _model_instance(status=ModelStatus.QUOTA_EXCEEDED)

    prepared = _prepare(service, request, model_instance)

    assert prepared.model_instance is model_instance
    provider_model.raise_for_status.assert_not_called()


def test_gateway_uses_quota_managed_instance_as_single_credit_owner(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request, mode=AppMode.WORKFLOW)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    reservation = MagicMock(commit_before_delivery=True)
    mock_reserve_quota = mocker.patch.object(model_instance, "reserve_quota", return_value=reservation)
    prepared = _prepare(service, request, model_instance)
    provider_chunk = _chunk("done", usage=_usage())

    def provider_stream() -> Generator[LLMResultChunk]:
        yield provider_chunk

    with patch.object(ModelInstance, "_invoke_llm", return_value=provider_stream()) as provider_invoke:
        chunks = list(service.invoke(prepared))

    assert chunks == [provider_chunk]
    mock_reserve_quota.assert_called_once_with(
        request_id=request.caller.invocation_id,
        app_type=CreditUsageAppType.WORKFLOW,
        created_by=CreditUsageCreatedBy.AGENT_NODE,
    )
    assert provider_invoke.call_args.kwargs["request_metadata"]["agent_config_version_kind"] == "draft"
    reservation.commit.assert_called_once_with(provider_chunk.delta.usage)
    reservation.release.assert_called_once_with()
    provider_invoke.assert_called_once()


def test_gateway_forwards_prompt_messages_without_revalidation(mocker: MockerFixture) -> None:
    request = _request()
    prompt_messages: list[dict[str, JsonValue]] = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "search", "arguments": '{"query":"Dify"}'},
                }
            ],
            "provider_extension": {"thought_signature": "opaque"},
        },
        {
            "role": "tool",
            "content": "result",
            "name": "search",
            "tool_call_id": "call-1",
        },
    ]
    request.target.prompt_messages = prompt_messages
    model_instance = make_model_instance(provider=request.target.provider, model=request.target.model)
    invoke = mocker.patch.object(model_instance, "invoke_llm", return_value=iter([]))
    prepared = PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    assert list(AgentLLMInnerService().invoke(prepared)) == []
    assert invoke.call_args.kwargs["prompt_messages"] is prompt_messages


def test_standalone_agent_app_gateway_is_attributed_to_app(mocker: MockerFixture) -> None:
    request = _request()
    model_instance = make_model_instance(provider=request.target.provider, model=request.target.model)
    invoke = mocker.patch.object(model_instance, "invoke_llm", return_value=iter([]))
    prepared = PreparedAgentLLMInvocation(
        request=request,
        model_instance=model_instance,
        app_type=CreditUsageAppType.AGENT_V2,
    )

    assert list(AgentLLMInnerService().invoke(prepared)) == []
    request_metadata = invoke.call_args.kwargs["request_metadata"]
    assert request_metadata["created_by"] is CreditUsageCreatedBy.APP
    assert request_metadata["agent_config_version_kind"] == "draft"


def test_agent_build_draft_gateway_is_attributed_to_build_draft(mocker: MockerFixture) -> None:
    request = _request()
    request.caller.agent_config_version_kind = "build_draft"
    model_instance = make_model_instance(provider=request.target.provider, model=request.target.model)
    invoke = mocker.patch.object(model_instance, "invoke_llm", return_value=iter([]))
    prepared = PreparedAgentLLMInvocation(
        request=request,
        model_instance=model_instance,
        app_type=CreditUsageAppType.AGENT_V2,
    )

    assert list(AgentLLMInnerService().invoke(prepared)) == []
    request_metadata = invoke.call_args.kwargs["request_metadata"]
    assert request_metadata["created_by"] is CreditUsageCreatedBy.BUILD_DRAFT
    assert request_metadata["agent_config_version_kind"] == "build_draft"


def test_retried_gateway_delivery_uses_one_effective_billing_charge(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model = make_model_config(provider=request.target.provider, model=request.target.model, mode="chat")
    bundle = model.provider_model_bundle
    provider_configuration = bundle.configuration
    provider_configuration.tenant_id = request.caller.tenant_id
    provider_configuration.provider.models = [model.model_schema]
    provider_configuration.using_provider_type = ProviderType.SYSTEM
    provider_configuration.system_configuration = SystemConfiguration(
        enabled=True,
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.CREDITS,
                quota_limit=100,
                quota_used=0,
                is_valid=True,
            )
        ],
    )
    model_instance = QuotaManagedModelInstance(bundle, model.model, credentials={"api_key": "hosted"})
    prepared = _prepare(service, request, model_instance)
    reservations_by_request: dict[str, str] = {}
    committed_reservations: set[str] = set()
    effective_charges = 0
    reserve_request_ids: list[str] = []

    def reserve(*, request_id: str, **_: object) -> billing.QuotaReserveReply:
        reserve_request_ids.append(request_id)
        reservation_id = reservations_by_request.setdefault(request_id, "reservation-1")
        return billing.QuotaReserveReply(reservation_id=reservation_id, available=97, reserved=3)

    def commit(*, reservation_id: str, actual_amount: int, **_: object) -> billing.QuotaCommitReply:
        nonlocal effective_charges
        if reservation_id not in committed_reservations:
            committed_reservations.add(reservation_id)
            effective_charges += actual_amount
        return billing.QuotaCommitReply(available=97, reserved=0, refunded=0)

    def provider_invoke(*_: object, **__: object) -> Generator[LLMResultChunk]:
        yield _chunk("done", usage=_usage())

    with (
        patch("core.app.llm.quota._get_provider_configuration", return_value=provider_configuration),
        patch.object(type(dify_config), "get_model_credits", return_value=3),
        patch("services.billing_service.BillingService.quota_reserve", side_effect=reserve),
        patch("services.billing_service.BillingService.quota_commit", side_effect=commit),
        patch.object(ModelInstance, "_invoke_llm", side_effect=provider_invoke),
    ):
        first = list(service.invoke(prepared))
        second = list(service.invoke(prepared))

    assert first[0].delta.message.content == "done"
    assert second[0].delta.message.content == "done"
    assert reserve_request_ids == [request.caller.invocation_id, request.caller.invocation_id]
    assert reservations_by_request == {request.caller.invocation_id: "reservation-1"}
    assert committed_reservations == {"reservation-1"}
    assert effective_charges == 3


def test_gateway_releases_reservation_when_provider_fails_before_delivery(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    reservation = MagicMock(commit_before_delivery=True)
    mocker.patch.object(model_instance, "reserve_quota", return_value=reservation)
    prepared = _prepare(service, request, model_instance)

    def failing_stream() -> Generator[LLMResultChunk]:
        raise RuntimeError("provider failed")
        yield

    with patch.object(ModelInstance, "_invoke_llm", return_value=failing_stream()):
        with pytest.raises(RuntimeError, match="provider failed"):
            list(service.invoke(prepared))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_gateway_buffers_usage_based_quota_until_terminal_usage(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    events: list[str] = []
    reservation = MagicMock(commit_before_delivery=False)
    reservation.commit.side_effect = lambda _usage: events.append("commit")
    mocker.patch.object(model_instance, "reserve_quota", return_value=reservation)
    prepared = _prepare(service, request, model_instance)
    terminal_usage = _usage(total_tokens=21)

    def provider_stream() -> Generator[LLMResultChunk]:
        events.append("provider:first")
        yield _chunk("first")
        events.append("provider:last")
        yield _chunk("last", usage=terminal_usage)

    with patch.object(ModelInstance, "_invoke_llm", return_value=provider_stream()):
        stream = service.invoke(prepared)
        first = next(stream)
        events.append("consumer:first")
        rest = list(stream)

    assert first.delta.message.content == "first"
    assert [chunk.delta.message.content for chunk in rest] == ["last"]
    assert events == ["provider:first", "provider:last", "commit", "consumer:first"]
    reservation.commit.assert_called_once_with(terminal_usage)
    reservation.release.assert_called_once_with()
