from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn
from unittest.mock import MagicMock

import pytest
from flask import Flask
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import Engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.local import LocalProxy

from configs import dify_config
from controllers.console import bp as console_bp
from controllers.console.human_input_v2 import channel as channel_controller
from controllers.console.human_input_v2.config_version import (
    encode_email_config_version,
    encode_im_config_version,
)
from controllers.console.wraps import _is_setup_completed
from core.helper import encrypter
from core.human_input_v2.email_channel import (
    EmailChannelConfiguration,
    ResendCandidate,
)
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMControlPlaneRepository,
    IMIntegration,
    IMProviderCredentials,
    IMProviderTestResult,
    ProviderTenantIdentity,
)
from core.human_input_v2.shared import (
    AccountId,
    DirectoryScope,
    EmailProviderId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from libs.login import AccountWithTenant
from models.account import Account, AccountStatus, Tenant, TenantAccountRole
from models.human_input_v2 import (
    HumanInputEmailProvider,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
)
from repositories.human_input_v2.email_channel import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService

_BASE_PATH = "/console/api/workspace/current/human-input/v2"
_SUBMITTED_SECRETS = (
    "client-secret-security-value",
    "preserve_original_value",
    "xoxb-security-secret",
    "xapp-security-secret",
)
_RAW_PROVIDER_FAILURE = f"raw provider payload with {_SUBMITTED_SECRETS[2]}"
_INVALID_SLACK_TOKENS = (
    "invalid-slack-bot-token-security-value",
    "invalid-slack-app-token-security-value",
)
_PERSISTENCE_CREDENTIAL_MARKER = "persistence-credential-security-value"
_CHANNEL_ID = IntegrationId("00000000-0000-0000-0000-000000000001")
_REPLACEMENT_CHANNEL_ID = "00000000-0000-0000-0000-000000000002"
_EMAIL_CHANNEL_ID = EmailProviderId("00000000-0000-0000-0000-000000000003")
_NOW = datetime(2026, 8, 20, 8)


class _ExplodingProviderPort:
    def __init__(self) -> None:
        self.test_calls = 0

    def available_providers(self) -> tuple[IMProvider, ...]:
        return (IMProvider.SLACK,)

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> NoReturn:
        del scope, credentials
        raise RuntimeError(_RAW_PROVIDER_FAILURE)

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> NoReturn:
        del scope, credentials
        self.test_calls += 1
        raise RuntimeError(_RAW_PROVIDER_FAILURE)


class _PersistenceProviderPort:
    def available_providers(self) -> tuple[IMProvider, ...]:
        return (IMProvider.SLACK,)

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        del scope
        return ConfirmedIMConfiguration(
            provider=credentials.provider,
            provider_tenant_id="provider-tenant-1",
            encrypted_credentials=_slack_encrypted_credentials(_PERSISTENCE_CREDENTIAL_MARKER),
            callback_url=None,
            provider_tenant_display=None,
        )

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> IMProviderTestResult:
        del scope
        return IMProviderTestResult(credentials.provider, "provider-tenant-1")


class _PersistenceEmailProviderGateway:
    def validate(self, candidate: ResendCandidate) -> None:
        del candidate

    def send_test(self, candidate: ResendCandidate, recipient: NormalizedEmail) -> None:
        del candidate, recipient


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self) -> _OwnedWriteLock:
        self.held = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("write lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


class _WriteUnitOfWorkFactory:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def __call__(self, _scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        return SQLAlchemyOrganizationIMWriteUnitOfWork(self._session_maker, _OwnedWriteLock())


def _slack_encrypted_credentials(encrypted_secret: str) -> EncryptedCredentials:
    return EncryptedCredentials.from_mapping(
        {
            "client_id": "client-id",
            "encrypted_client_secret": encrypted_secret,
            "encrypted_signing_secret": encrypted_secret,
            "encrypted_bot_token": encrypted_secret,
            "encrypted_app_token": encrypted_secret,
        }
    )


def _current_integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=_CHANNEL_ID,
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-tenant-1"),
        encrypted_credentials=_slack_encrypted_credentials("existing-ciphertext"),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )


@dataclass(frozen=True)
class _InstrumentedChannelApp:
    application: Flask
    provider_port: _ExplodingProviderPort
    span_exporter: InMemorySpanExporter
    metric_reader: InMemoryMetricReader


@dataclass(frozen=True)
class _InstrumentedPersistenceApp:
    application: Flask
    email_repository: SQLAlchemyEmailChannelRepository
    email_owner: HumanInputEmailChannelManagementService
    repository: SQLAlchemyIMControlPlaneRepository
    im_owner: HumanInputIMIntegrationManagementService
    span_exporter: InMemorySpanExporter
    metric_reader: InMemoryMetricReader


@pytest.fixture
def instrumented_channel_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[_InstrumentedChannelApp]:
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    _is_setup_completed.mark_success()

    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr("libs.login.current_user", LocalProxy(lambda: account))
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="workspace-1"),
    )

    provider_port = _ExplodingProviderPort()
    im_owner = HumanInputIMIntegrationManagementService(
        MagicMock(spec=IMControlPlaneRepository),
        provider_port,
    )
    email_owner = MagicMock(spec=HumanInputEmailChannelManagementService)
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        lambda: email_owner,
    )
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_im_integration_management_service",
        lambda: im_owner,
    )

    application = Flask(__name__)
    application.config["TESTING"] = False
    application.config["RESTX_ERROR_404_HELP"] = False
    application.register_blueprint(console_bp)

    span_exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    metric_reader = InMemoryMetricReader()
    meter_provider = MeterProvider(metric_readers=[metric_reader])
    instrumentor = FlaskInstrumentor()
    instrumentor.instrument_app(
        application,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
    )

    yield _InstrumentedChannelApp(
        application=application,
        provider_port=provider_port,
        span_exporter=span_exporter,
        metric_reader=metric_reader,
    )

    instrumentor.uninstrument_app(application)
    tracer_provider.shutdown()
    meter_provider.shutdown()


@pytest.fixture
def instrumented_persistence_app(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> Iterator[_InstrumentedPersistenceApp]:
    HumanInputIMIntegration.metadata.create_all(
        sqlite_engine,
        tables=[
            Tenant.__table__,
            HumanInputEmailProvider.__table__,
            HumanInputIMIntegration.__table__,
            HumanInputIMIdentity.__table__,
            HumanInputIMBinding.__table__,
        ],
    )
    operation_sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with operation_sessions.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = "workspace-1"
        session.add(tenant)
    email_repository = SQLAlchemyEmailChannelRepository(operation_sessions)
    monkeypatch.setattr(
        encrypter,
        "encrypt_token",
        lambda _tenant_id, _api_key: _PERSISTENCE_CREDENTIAL_MARKER,
    )
    email_owner = HumanInputEmailChannelManagementService(
        email_repository,
        _PersistenceEmailProviderGateway(),
        clock=lambda: _NOW,
        id_factory=lambda: str(_EMAIL_CHANNEL_ID),
    )
    repository = SQLAlchemyIMControlPlaneRepository(
        operation_sessions,
        _WriteUnitOfWorkFactory(operation_sessions),
    )
    im_owner = HumanInputIMIntegrationManagementService(
        repository,
        _PersistenceProviderPort(),
        clock=lambda: _NOW,
        id_factory=lambda: _REPLACEMENT_CHANNEL_ID,
    )

    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    _is_setup_completed.mark_success()
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr("libs.login.current_user", LocalProxy(lambda: account))
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="workspace-1"),
    )
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        lambda: email_owner,
    )
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_im_integration_management_service",
        lambda: im_owner,
    )

    application = Flask(__name__)
    application.config["TESTING"] = False
    application.config["RESTX_ERROR_404_HELP"] = False
    application.register_blueprint(console_bp)

    span_exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    metric_reader = InMemoryMetricReader()
    meter_provider = MeterProvider(metric_readers=[metric_reader])
    instrumentor = FlaskInstrumentor()
    instrumentor.instrument_app(
        application,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
    )

    yield _InstrumentedPersistenceApp(
        application=application,
        email_repository=email_repository,
        email_owner=email_owner,
        repository=repository,
        im_owner=im_owner,
        span_exporter=span_exporter,
        metric_reader=metric_reader,
    )

    instrumentor.uninstrument_app(application)
    tracer_provider.shutdown()
    meter_provider.shutdown()


def test_unexpected_provider_failure_is_absent_from_http_observability(
    instrumented_channel_app: _InstrumentedChannelApp,
    caplog: pytest.LogCaptureFixture,
) -> None:
    credentials = {
        "provider": "slack",
        "client_id": "client-id",
        "client_secret": _SUBMITTED_SECRETS[0],
        "signing_secret": _SUBMITTED_SECRETS[1],
        "bot_token": _SUBMITTED_SECRETS[2],
        "app_token": _SUBMITTED_SECRETS[3],
    }

    with caplog.at_level(logging.DEBUG):
        response = instrumented_channel_app.application.test_client().post(
            f"{_BASE_PATH}/channels/im/test",
            json={"credentials": credentials},
        )

    finished_spans = instrumented_channel_app.span_exporter.get_finished_spans()
    metrics_data = instrumented_channel_app.metric_reader.get_metrics_data()
    assert metrics_data is not None
    observed = "\n".join(
        (
            response.get_data(as_text=True),
            caplog.text,
            repr(finished_spans),
            repr(metrics_data),
        )
    )

    assert response.status_code == 500
    assert instrumented_channel_app.provider_port.test_calls == 1
    assert finished_spans
    assert metrics_data.resource_metrics
    assert _RAW_PROVIDER_FAILURE not in observed
    assert "raw provider payload" not in observed
    assert all(secret not in observed for secret in _SUBMITTED_SECRETS)


def test_invalid_slack_token_format_is_absent_from_http_observability(
    instrumented_channel_app: _InstrumentedChannelApp,
    caplog: pytest.LogCaptureFixture,
) -> None:
    credentials = {
        "provider": "slack",
        "client_id": "client-id",
        "client_secret": "client-secret",
        "signing_secret": "signing-secret",
        "bot_token": _INVALID_SLACK_TOKENS[0],
        "app_token": _INVALID_SLACK_TOKENS[1],
    }

    with caplog.at_level(logging.DEBUG):
        response = instrumented_channel_app.application.test_client().post(
            f"{_BASE_PATH}/channels/im/test",
            json={"credentials": credentials},
        )

    finished_spans = instrumented_channel_app.span_exporter.get_finished_spans()
    metrics_data = instrumented_channel_app.metric_reader.get_metrics_data()
    assert metrics_data is not None
    observed_surfaces = {
        "response": response.get_data(as_text=True),
        "logs": caplog.text,
        "spans": repr(finished_spans),
        "metrics": repr(metrics_data),
    }
    leaked_tokens = {
        surface: tuple(token for token in _INVALID_SLACK_TOKENS if token in observed)
        for surface, observed in observed_surfaces.items()
    }

    assert response.status_code == 400
    assert instrumented_channel_app.provider_port.test_calls == 0
    assert leaked_tokens == dict.fromkeys(observed_surfaces, ())


@pytest.mark.parametrize("operation", ["create", "update", "replacement"])
def test_im_persistence_failure_bubbles_to_logs_without_reaching_http_telemetry_and_rolls_back(
    instrumented_persistence_app: _InstrumentedPersistenceApp,
    sqlite_engine: Engine,
    caplog: pytest.LogCaptureFixture,
    operation: str,
) -> None:
    scope = WorkspaceScope(id=TenantId("workspace-1"))
    before = None
    expected_config_version = None
    if operation != "create":
        before = instrumented_persistence_app.repository.create_integration(
            _current_integration(),
            organization_scope=scope,
        )
        expected_config_version = encode_im_config_version(
            instrumented_persistence_app.im_owner.get(scope, _CHANNEL_ID).revision
        )

    target_statement = "UPDATE" if operation == "update" else "INSERT"

    def fail_persistence(
        _connection,
        _cursor,
        statement: str,
        parameters: object,
        _context,
        _executemany,
    ) -> None:
        normalized_statement = statement.lstrip().upper()
        if normalized_statement.startswith(f"{target_statement} INTO HUMAN_INPUT_IM_INTEGRATIONS"):
            raise OperationalError(statement, parameters, RuntimeError("injected database write failure"))
        if target_statement == "UPDATE" and normalized_statement.startswith("UPDATE HUMAN_INPUT_IM_INTEGRATIONS"):
            raise OperationalError(statement, parameters, RuntimeError("injected database write failure"))

    credentials = {
        "provider": "slack",
        "client_id": "client-id",
        "client_secret": _PERSISTENCE_CREDENTIAL_MARKER,
        "signing_secret": "signing-secret",
        "bot_token": "xoxb-bot-token",
        "app_token": "xapp-app-token",
    }
    client = instrumented_persistence_app.application.test_client()
    event.listen(sqlite_engine, "before_cursor_execute", fail_persistence)
    try:
        with caplog.at_level(logging.DEBUG):
            if operation == "create":
                response = client.post(f"{_BASE_PATH}/channels/im", json={"credentials": credentials})
            elif operation == "update":
                response = client.put(
                    f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}",
                    json={"credentials": credentials, "expected_config_version": expected_config_version},
                )
            else:
                response = client.post(
                    f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}/replacement",
                    json={"credentials": credentials, "expected_config_version": expected_config_version},
                )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_persistence)

    after = instrumented_persistence_app.repository.load_current_integration(scope.id)
    metrics_data = instrumented_persistence_app.metric_reader.get_metrics_data()
    assert metrics_data is not None
    http_telemetry_surfaces = {
        "response": response.get_data(as_text=True),
        "spans": repr(instrumented_persistence_app.span_exporter.get_finished_spans()),
        "metrics": repr(metrics_data),
    }
    marker_presence = {
        surface: _PERSISTENCE_CREDENTIAL_MARKER in observed for surface, observed in http_telemetry_surfaces.items()
    }

    assert response.status_code == 500
    assert after == before
    assert marker_presence == dict.fromkeys(http_telemetry_surfaces, False)
    assert "sqlalchemy.exc.OperationalError" in caplog.text
    assert "IMControlPlanePersistenceError" in caplog.text


@pytest.mark.parametrize("operation", ["create", "update"])
def test_email_persistence_failure_bubbles_to_logs_without_reaching_http_telemetry_and_rolls_back(
    instrumented_persistence_app: _InstrumentedPersistenceApp,
    sqlite_engine: Engine,
    caplog: pytest.LogCaptureFixture,
    operation: str,
) -> None:
    scope = WorkspaceScope(id=TenantId("workspace-1"))
    before = None
    expected_config_version = None
    if operation == "update":
        create_result = instrumented_persistence_app.email_repository.create(
            EmailChannelConfiguration(
                id=_EMAIL_CHANNEL_ID,
                tenant_id=scope.id,
                sender_email=NormalizedEmail("sender@example.com"),
                sender_name="Sender",
                protected_api_key="existing-ciphertext",
                configured_by_account_id=AccountId("account-1"),
                created_at=_NOW,
                updated_at=_NOW,
            )
        )
        before = create_result.configuration
        assert before is not None
        expected_config_version = encode_email_config_version(
            instrumented_persistence_app.email_owner.get(
                scope,
                _EMAIL_CHANNEL_ID,
            ).revision
        )

    target_statement = "UPDATE" if operation == "update" else "INSERT"

    def fail_persistence(
        _connection,
        _cursor,
        statement: str,
        parameters: object,
        _context,
        _executemany,
    ) -> None:
        normalized_statement = statement.lstrip().upper()
        expected_prefix = (
            "UPDATE HUMAN_INPUT_EMAIL_PROVIDERS"
            if target_statement == "UPDATE"
            else "INSERT INTO HUMAN_INPUT_EMAIL_PROVIDERS"
        )
        if normalized_statement.startswith(expected_prefix):
            raise OperationalError(statement, parameters, RuntimeError("injected database write failure"))

    credentials = {
        "provider": "resend",
        "sender_email": "sender@example.com",
        "sender_name": "Sender",
        "api_key": _PERSISTENCE_CREDENTIAL_MARKER,
    }
    client = instrumented_persistence_app.application.test_client()
    event.listen(sqlite_engine, "before_cursor_execute", fail_persistence)
    try:
        with caplog.at_level(logging.DEBUG):
            if operation == "create":
                response = client.post(f"{_BASE_PATH}/channels/email", json={"credentials": credentials})
            else:
                response = client.put(
                    f"{_BASE_PATH}/channels/email/{_EMAIL_CHANNEL_ID}",
                    json={"credentials": credentials, "expected_config_version": expected_config_version},
                )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_persistence)

    after = instrumented_persistence_app.email_repository.load(scope.id)
    metrics_data = instrumented_persistence_app.metric_reader.get_metrics_data()
    assert metrics_data is not None
    http_telemetry_surfaces = {
        "response": response.get_data(as_text=True),
        "spans": repr(instrumented_persistence_app.span_exporter.get_finished_spans()),
        "metrics": repr(metrics_data),
    }
    marker_presence = {
        surface: _PERSISTENCE_CREDENTIAL_MARKER in observed for surface, observed in http_telemetry_surfaces.items()
    }

    assert response.status_code == 500
    assert after == before
    assert marker_presence == dict.fromkeys(http_telemetry_surfaces, False)
    assert "sqlalchemy.exc.OperationalError" in caplog.text
    assert "EmailChannelPersistenceError" in caplog.text
