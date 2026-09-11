from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest

from machinery.context import RequestContext
from services.data_source.oauth_service import (
    DataSourceOAuthConfigurationError,
    DataSourceOAuthError,
    DataSourceOAuthService,
    InvalidDataSourceOAuthCodeError,
)
from services.entities.data_source.oauth import (
    DataSourceOAuthAuthorization,
    DataSourceOAuthBindingRecord,
    DataSourceOAuthCallback,
)


def _authorization() -> DataSourceOAuthAuthorization:
    return DataSourceOAuthAuthorization(access_token="token", source_info={"pages": []})


@dataclass
class RecordingProviderGateway:
    authorization_url: str = "https://notion.example/authorize"
    authorization: DataSourceOAuthAuthorization = field(default_factory=_authorization)
    refreshed_source_info: Mapping[str, object] = field(default_factory=lambda: {"pages": [{"page_id": "page-1"}]})
    events: list[tuple[str, object]] = field(default_factory=list)

    def get_authorization_url(self) -> str:
        self.events.append(("get_authorization_url", ()))
        return self.authorization_url

    def authorize(self, code: str) -> DataSourceOAuthAuthorization:
        self.events.append(("authorize", code))
        return self.authorization

    def authorize_internal(self, access_token: str, workspace_id: str) -> DataSourceOAuthAuthorization:
        self.events.append(("authorize_internal", (access_token, workspace_id)))
        return self.authorization

    def refresh(self, access_token: str, source_info: Mapping[str, object]) -> Mapping[str, object]:
        self.events.append(("refresh", (access_token, source_info)))
        return self.refreshed_source_info


@dataclass
class InMemoryBindingRepository:
    binding: DataSourceOAuthBindingRecord | None = None
    update_result: bool = True
    events: list[tuple[str, object]] = field(default_factory=list)

    def upsert_authorization(
        self,
        *,
        workspace_id: str,
        provider: str,
        authorization: DataSourceOAuthAuthorization,
    ) -> None:
        self.events.append(("persist", (workspace_id, provider, authorization)))

    def get_enabled(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
    ) -> DataSourceOAuthBindingRecord | None:
        self.events.append(("read", (workspace_id, provider, binding_id)))
        return self.binding

    def update_source_info(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
        source_info: Mapping[str, object],
    ) -> bool:
        self.events.append(("update", (workspace_id, provider, binding_id, source_info)))
        return self.update_result


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def test_start_authorization_delegates_to_external_provider(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    provider = RecordingProviderGateway(events=events)
    bindings = InMemoryBindingRepository(events=events)
    service = DataSourceOAuthService(provider_name="notion", provider_gateway=provider, bindings=bindings)

    result = service.start_authorization(request_context)

    assert result == "https://notion.example/authorize"
    assert events == [("get_authorization_url", ())]


def test_start_authorization_persists_internal_authorization(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    authorization = DataSourceOAuthAuthorization(access_token="secret", source_info={"pages": []})
    provider = RecordingProviderGateway(authorization=authorization, events=events)
    bindings = InMemoryBindingRepository(events=events)
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
        is_internal_provider=True,
        internal_access_token="secret",
    )

    result = service.start_authorization(request_context)

    assert result == "internal"
    assert events == [
        ("authorize_internal", ("secret", "workspace-1")),
        ("persist", ("workspace-1", "notion", authorization)),
    ]


def test_start_authorization_rejects_missing_internal_secret(request_context: RequestContext) -> None:
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=RecordingProviderGateway(),
        bindings=InMemoryBindingRepository(),
        is_internal_provider=True,
    )

    with pytest.raises(DataSourceOAuthConfigurationError, match="Internal secret is not set"):
        service.start_authorization(request_context)


@pytest.mark.parametrize(
    ("code", "error", "expected_error"),
    [
        ("auth/code", None, None),
        (None, "access denied", "access denied"),
        (None, None, "Access denied"),
    ],
)
def test_complete_callback_returns_framework_neutral_result(
    code: str | None,
    error: str | None,
    expected_error: str | None,
) -> None:
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=RecordingProviderGateway(),
        bindings=InMemoryBindingRepository(),
    )

    assert service.complete_callback(code=code, error=error) == DataSourceOAuthCallback(
        provider="notion",
        code=code,
        error=expected_error,
    )


def test_bind_authorizes_before_persisting(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    authorization = _authorization()
    provider = RecordingProviderGateway(authorization=authorization, events=events)
    bindings = InMemoryBindingRepository(events=events)
    service = DataSourceOAuthService(provider_name="notion", provider_gateway=provider, bindings=bindings)

    service.bind(request_context, code="code-1")

    assert events == [
        ("authorize", "code-1"),
        ("persist", ("workspace-1", "notion", authorization)),
    ]


def test_bind_rejects_empty_code(request_context: RequestContext) -> None:
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=RecordingProviderGateway(),
        bindings=InMemoryBindingRepository(),
    )

    with pytest.raises(InvalidDataSourceOAuthCodeError):
        service.bind(request_context, code="")


def test_sync_reads_before_provider_io_and_persists_afterward(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    binding = DataSourceOAuthBindingRecord(id="binding-1", access_token="token", source_info={"pages": []})
    refreshed_source_info = {"pages": [{"page_id": "page-1"}]}
    bindings = InMemoryBindingRepository(binding=binding, events=events)
    provider = RecordingProviderGateway(refreshed_source_info=refreshed_source_info, events=events)
    service = DataSourceOAuthService(provider_name="notion", provider_gateway=provider, bindings=bindings)

    service.sync(request_context, binding_id="binding-1")

    assert events == [
        ("read", ("workspace-1", "notion", "binding-1")),
        ("refresh", ("token", {"pages": []})),
        ("update", ("workspace-1", "notion", "binding-1", refreshed_source_info)),
    ]


def test_sync_rejects_missing_binding_without_provider_io(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=RecordingProviderGateway(events=events),
        bindings=InMemoryBindingRepository(events=events),
    )

    with pytest.raises(DataSourceOAuthError, match="Data source binding not found"):
        service.sync(request_context, binding_id="missing")

    assert events == [("read", ("workspace-1", "notion", "missing"))]


def test_sync_rejects_binding_removed_before_update(request_context: RequestContext) -> None:
    events: list[tuple[str, object]] = []
    binding = DataSourceOAuthBindingRecord(id="binding-1", access_token="token", source_info={"pages": []})
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=RecordingProviderGateway(events=events),
        bindings=InMemoryBindingRepository(binding=binding, update_result=False, events=events),
    )

    with pytest.raises(DataSourceOAuthError, match="Data source binding not found"):
        service.sync(request_context, binding_id="binding-1")

    assert [event for event, _ in events] == ["read", "refresh", "update"]
