"""Tests for API-owned Agent LLM credential resolution and metering."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.entities.model_entities import ModelStatus
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from models.model import App, AppMode
from services.agent_llm_inner_service import AgentLLMInnerService, AgentLLMInnerServiceError, _BillingPlan
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
            prompt_messages=[UserPromptMessage(content="hello")],
        ),
    )


def _model_instance(*, status: ModelStatus = ModelStatus.ACTIVE) -> MagicMock:
    provider_model = MagicMock()
    provider_model.status = status
    configuration = MagicMock()
    configuration.get_provider_model.return_value = provider_model
    model_instance = MagicMock()
    model_instance.provider_model_bundle.configuration = configuration
    return model_instance


def _prepare_with_plan(
    service: AgentLLMInnerService,
    request: AgentLLMInvokeRequest,
    plan: _BillingPlan,
    *,
    session: Session,
    model_status: ModelStatus = ModelStatus.ACTIVE,
) -> None:
    _persist_app(session, request=request)
    manager = MagicMock()
    manager.get_model_instance.return_value = _model_instance(status=model_status)
    with (
        patch("services.agent_llm_inner_service.create_plugin_provider_manager"),
        patch("services.agent_llm_inner_service.ModelManager", return_value=manager),
        patch.object(service, "_build_billing_plan", return_value=plan),
    ):
        service.prepare(request)


def _persist_app(
    session: Session,
    *,
    request: AgentLLMInvokeRequest,
    tenant_id: str | None = None,
) -> App:
    existing = session.get(App, request.caller.app_id)
    if existing is not None:
        return existing
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


def _create_pool(session: Session, *, tenant_id: str, quota_limit: int, quota_used: int = 0) -> TenantCreditPool:
    pool = TenantCreditPool(
        tenant_id=tenant_id,
        pool_type=ProviderQuotaType.TRIAL,
        quota_limit=quota_limit,
        quota_used=quota_used,
    )
    session.add(pool)
    session.commit()
    return pool


def _get_pool(session: Session, pool_id: str) -> TenantCreditPool:
    pool = session.get(TenantCreditPool, pool_id)
    assert pool is not None
    return pool


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


def test_system_invocation_deducts_local_credit_pool(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=10)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    _prepare_with_plan(
        service,
        request,
        _BillingPlan(quota_type="trial", pool_type="trial", credits=3),
        session=sqlite_session,
    )

    sqlite_session.expire_all()
    assert _get_pool(sqlite_session, pool.id).quota_used == 3


def test_system_invocation_forwards_stable_billing_identity(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with patch("services.agent_llm_inner_service.CreditPoolService.check_and_deduct_credits", return_value=3) as deduct:
        _prepare_with_plan(
            service,
            request,
            _BillingPlan(quota_type="trial", pool_type="trial", credits=3),
            session=sqlite_session,
        )

    kwargs = deduct.call_args.kwargs
    assert kwargs["tenant_id"] == request.caller.tenant_id
    assert kwargs["credits_required"] == 3
    assert kwargs["pool_type"] == "trial"
    assert kwargs["request_id"] == request.caller.invocation_id
    assert kwargs["metadata"] == {
        "source": "agent_llm_gateway",
        "invocation_id": request.caller.invocation_id,
        "agent_run_id": request.caller.agent_run_id,
        "agent_mode": request.caller.agent_mode,
        "call_index": "1",
        "provider": request.target.provider,
        "model": request.target.model,
    }
    assert isinstance(kwargs["session"], Session)


def test_custom_credentials_do_not_deduct_credits(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with patch("services.agent_llm_inner_service.CreditPoolService.check_and_deduct_credits") as deduct:
        _prepare_with_plan(service, request, _BillingPlan(), session=sqlite_session)

    deduct.assert_not_called()


def test_insufficient_credits_reject_before_model_invocation(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_session: Session,
) -> None:
    request = _request()
    pool = _create_pool(sqlite_session, tenant_id=request.caller.tenant_id, quota_limit=2)
    service = AgentLLMInnerService(session_factory=sqlite_session_factory)

    with pytest.raises(AgentLLMInnerServiceError) as exc_info:
        _prepare_with_plan(
            service,
            request,
            _BillingPlan(quota_type="trial", pool_type="trial", credits=3),
            session=sqlite_session,
            model_status=ModelStatus.QUOTA_EXCEEDED,
        )

    assert exc_info.value.error_code == "agent_llm_quota_exceeded"
    assert exc_info.value.status_code == 429
    sqlite_session.expire_all()
    assert _get_pool(sqlite_session, pool.id).quota_used == 0
