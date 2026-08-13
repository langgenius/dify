"""Composition tests for the API-owned Agent LLM gateway."""

from collections.abc import Generator
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.model_manager import ModelInstance, QuotaManagedModelInstance
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from models.model import App, AppMode
from models.provider import ProviderType
from services.agent_llm_inner_service import AgentLLMInnerService, AgentLLMInnerServiceError, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeCaller, AgentLLMInvokeRequest, AgentLLMInvokeTarget


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


def _model_instance(
    *,
    status: ModelStatus = ModelStatus.ACTIVE,
) -> tuple[QuotaManagedModelInstance, MagicMock]:
    provider_model = MagicMock()
    provider_model.status = status
    configuration = MagicMock()
    configuration.get_provider_model.return_value = provider_model
    bundle = MagicMock()
    bundle.configuration = configuration

    instance = object.__new__(QuotaManagedModelInstance)
    instance.provider_model_bundle = bundle
    instance.model_name = "gpt-test"
    instance.provider = "openai"
    instance.credentials = {"api_key": "hosted"}
    instance.model_type_instance = MagicMock()
    instance.load_balancing_manager = None
    return instance, provider_model


def _persist_app(
    session: Session,
    *,
    request: AgentLLMInvokeRequest,
    tenant_id: str | None = None,
) -> App:
    app = App(
        id=request.caller.app_id,
        tenant_id=tenant_id or request.caller.tenant_id,
        name="Agent LLM gateway test app",
        description="",
        mode=AppMode.CHAT,
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
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    reservation = MagicMock(commit_before_delivery=True)
    model_instance.reserve_quota = MagicMock(return_value=reservation)
    prepared = _prepare(service, request, model_instance)
    provider_chunk = _chunk("done", usage=_usage())

    def provider_stream() -> Generator[LLMResultChunk, None, None]:
        yield provider_chunk

    with patch.object(ModelInstance, "invoke_llm", return_value=provider_stream()) as provider_invoke:
        chunks = list(service.invoke(prepared))

    assert chunks == [provider_chunk]
    model_instance.reserve_quota.assert_called_once_with(request_id=request.caller.invocation_id)
    reservation.commit.assert_called_once_with(provider_chunk.delta.usage)
    reservation.release.assert_called_once_with()
    provider_invoke.assert_called_once()


def test_gateway_forwards_prompt_messages_without_revalidation() -> None:
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
    model_instance = MagicMock(spec=ModelInstance)
    model_instance.invoke_llm.return_value = iter([])
    prepared = PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    assert list(AgentLLMInnerService().invoke(prepared)) == []
    assert model_instance.invoke_llm.call_args.kwargs["prompt_messages"] is prompt_messages


def test_retried_gateway_delivery_uses_one_effective_billing_charge(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    model_instance.provider_model_bundle.configuration.tenant_id = request.caller.tenant_id
    prepared = _prepare(service, request, model_instance)
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        get_provider_model=MagicMock(return_value=SimpleNamespace(status=ModelStatus.ACTIVE)),
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    reservations_by_request: dict[str, str] = {}
    committed_reservations: set[str] = set()
    effective_charges = 0
    reserve_request_ids: list[str] = []

    def reserve(*, request_id: str, **_: object) -> dict[str, object]:
        reserve_request_ids.append(request_id)
        reservation_id = reservations_by_request.setdefault(request_id, "reservation-1")
        return {"reservation_id": reservation_id, "available": 97, "reserved": 3}

    def commit(*, reservation_id: str, actual_amount: int, **_: object) -> dict[str, object]:
        nonlocal effective_charges
        if reservation_id not in committed_reservations:
            committed_reservations.add(reservation_id)
            effective_charges += actual_amount
        return {"available": 97, "reserved": 0, "refunded": 0}

    def provider_invoke(*_: object, **__: object) -> Generator[LLMResultChunk, None, None]:
        yield _chunk("done", usage=_usage())

    with (
        patch("core.app.llm.quota._get_provider_configuration", return_value=provider_configuration),
        patch.object(type(dify_config), "get_model_credits", return_value=3),
        patch("services.credit_pool_service.CreditPoolService._use_billing_quota", return_value=True),
        patch("services.billing_service.BillingService.quota_reserve", side_effect=reserve),
        patch("services.billing_service.BillingService.quota_commit", side_effect=commit),
        patch.object(ModelInstance, "invoke_llm", side_effect=provider_invoke),
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
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    reservation = MagicMock(commit_before_delivery=True)
    model_instance.reserve_quota = MagicMock(return_value=reservation)
    prepared = _prepare(service, request, model_instance)

    def failing_stream() -> Generator[LLMResultChunk, None, None]:
        raise RuntimeError("provider failed")
        yield

    with patch.object(ModelInstance, "invoke_llm", return_value=failing_stream()):
        with pytest.raises(RuntimeError, match="provider failed"):
            list(service.invoke(prepared))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_gateway_buffers_usage_based_quota_until_terminal_usage(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    _persist_app(sqlite_session, request=request)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)
    model_instance, _ = _model_instance()
    events: list[str] = []
    reservation = MagicMock(commit_before_delivery=False)
    reservation.commit.side_effect = lambda _usage: events.append("commit")
    model_instance.reserve_quota = MagicMock(return_value=reservation)
    prepared = _prepare(service, request, model_instance)
    terminal_usage = _usage(total_tokens=21)

    def provider_stream() -> Generator[LLMResultChunk, None, None]:
        events.append("provider:first")
        yield _chunk("first")
        events.append("provider:last")
        yield _chunk("last", usage=terminal_usage)

    with patch.object(ModelInstance, "invoke_llm", return_value=provider_stream()):
        stream = service.invoke(prepared)
        first = next(stream)
        events.append("consumer:first")
        rest = list(stream)

    assert first.delta.message.content == "first"
    assert [chunk.delta.message.content for chunk in rest] == ["last"]
    assert events == ["provider:first", "provider:last", "commit", "consumer:first"]
    reservation.commit.assert_called_once_with(terminal_usage)
    reservation.release.assert_called_once_with()
