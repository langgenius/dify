from unittest.mock import MagicMock, call

import pytest

from machinery.context import RequestContext
from services.data_source_oauth_service import (
    DataSourceOAuthConfigurationError,
    DataSourceOAuthError,
    DataSourceOAuthService,
    InvalidDataSourceOAuthCodeError,
)
from services.entities.data_source_oauth_entities import (
    DataSourceOAuthAuthorization,
    DataSourceOAuthBindingRecord,
    DataSourceOAuthCallback,
)


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def test_start_authorization_delegates_to_external_provider(request_context: RequestContext) -> None:
    provider = MagicMock()
    provider.get_authorization_url.return_value = "https://notion.example/authorize"
    bindings = MagicMock()
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
    )

    result = service.start_authorization(request_context)

    assert result == "https://notion.example/authorize"
    provider.get_authorization_url.assert_called_once_with()
    bindings.upsert_authorization.assert_not_called()


def test_start_authorization_persists_internal_authorization(request_context: RequestContext) -> None:
    authorization = DataSourceOAuthAuthorization(access_token="secret", source_info={"pages": []})
    provider = MagicMock()
    provider.authorize_internal.return_value = authorization
    bindings = MagicMock()
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
        is_internal_provider=True,
        internal_access_token="secret",
    )

    result = service.start_authorization(request_context)

    assert result == "internal"
    provider.authorize_internal.assert_called_once_with("secret", "workspace-1")
    bindings.upsert_authorization.assert_called_once_with(
        workspace_id="workspace-1",
        provider="notion",
        authorization=authorization,
    )


def test_start_authorization_rejects_missing_internal_secret(request_context: RequestContext) -> None:
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=MagicMock(),
        bindings=MagicMock(),
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
        provider_gateway=MagicMock(),
        bindings=MagicMock(),
    )

    assert service.complete_callback(code=code, error=error) == DataSourceOAuthCallback(
        provider="notion",
        code=code,
        error=expected_error,
    )


def test_bind_authorizes_before_persisting(request_context: RequestContext) -> None:
    events = MagicMock()
    authorization = DataSourceOAuthAuthorization(access_token="token", source_info={"pages": []})
    provider = MagicMock()
    provider.authorize.side_effect = lambda code: (events.authorize(code), authorization)[1]
    bindings = MagicMock()
    bindings.upsert_authorization.side_effect = lambda **kwargs: events.persist(**kwargs)
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
    )

    service.bind(request_context, code="code-1")

    assert events.mock_calls == [
        call.authorize("code-1"),
        call.persist(workspace_id="workspace-1", provider="notion", authorization=authorization),
    ]


def test_bind_rejects_empty_code(request_context: RequestContext) -> None:
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=MagicMock(),
        bindings=MagicMock(),
    )

    with pytest.raises(InvalidDataSourceOAuthCodeError):
        service.bind(request_context, code="")


def test_sync_reads_before_provider_io_and_persists_afterward(request_context: RequestContext) -> None:
    events = MagicMock()
    binding = DataSourceOAuthBindingRecord(id="binding-1", access_token="token", source_info={"pages": []})
    refreshed_source_info = {"pages": [{"page_id": "page-1"}]}
    bindings = MagicMock()
    bindings.get_enabled.side_effect = lambda **kwargs: (events.read(**kwargs), binding)[1]
    bindings.update_source_info.side_effect = lambda **kwargs: (events.update(**kwargs), True)[1]
    provider = MagicMock()
    provider.refresh.side_effect = lambda *args: (events.refresh(*args), refreshed_source_info)[1]
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
    )

    service.sync(request_context, binding_id="binding-1")

    assert events.mock_calls == [
        call.read(workspace_id="workspace-1", provider="notion", binding_id="binding-1"),
        call.refresh("token", {"pages": []}),
        call.update(
            workspace_id="workspace-1",
            provider="notion",
            binding_id="binding-1",
            source_info=refreshed_source_info,
        ),
    ]


def test_sync_rejects_missing_binding_without_provider_io(request_context: RequestContext) -> None:
    provider = MagicMock()
    bindings = MagicMock()
    bindings.get_enabled.return_value = None
    service = DataSourceOAuthService(
        provider_name="notion",
        provider_gateway=provider,
        bindings=bindings,
    )

    with pytest.raises(DataSourceOAuthError, match="Data source binding not found"):
        service.sync(request_context, binding_id="missing")

    provider.refresh.assert_not_called()
