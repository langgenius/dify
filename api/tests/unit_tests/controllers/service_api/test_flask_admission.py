"""Public adapter tests for Service API dataset admission."""

from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, ServiceUnavailable

from controllers.service_api import flask_admission
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from machinery.context import RequestContext
from services.auth.resource_access_token_contracts import ResourceAccessTokenDatasetGrant
from services.knowledge.admission.application import DatasetAdmissionPolicy, DatasetAdmissionScopeError
from services.knowledge.admission.limits import KnowledgeApiVectorSpaceUnavailableError


@dataclass(frozen=True, slots=True)
class _ApiKey:
    id: str
    tenant_id: str


@dataclass(frozen=True, slots=True)
class _Account:
    id: str
    has_edit_permission: bool = True


class _RecordingAdmission:
    def __init__(self, result: RequestContext, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, object]] = []

    def admit(self, **kwargs: object) -> RequestContext:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.result


class _RecordingTokenValidator:
    def __init__(self, result: _ApiKey) -> None:
        self.result = result
        self.scopes: list[str | None] = []

    def __call__(self, scope: str | None = None) -> _ApiKey:
        self.scopes.append(scope)
        return self.result


class _RecordingResourceTokens:
    def __init__(self, workspace_id: str) -> None:
        self.workspace_id = workspace_id
        self.calls: list[tuple[str, str | None]] = []

    def resolve_datasets_for_service_api(
        self, *, token: str, dataset_id: str | None
    ) -> ResourceAccessTokenDatasetGrant:
        self.calls.append((token, dataset_id))
        dataset_ids = frozenset({dataset_id}) if dataset_id is not None else frozenset({"bound-dataset"})
        return ResourceAccessTokenDatasetGrant("token-id", self.workspace_id, dataset_ids)


class _RecordingIdentity:
    def __init__(self, account: _Account | None) -> None:
        self.account = account
        self.calls: list[tuple[str, str]] = []

    def get_account_for_workspace(self, account_id: str, workspace_id: str) -> _Account | None:
        self.calls.append((account_id, workspace_id))
        return self.account


@dataclass(frozen=True, slots=True)
class _KnowledgeServices:
    admission: _RecordingAdmission


@dataclass(frozen=True, slots=True)
class _AccountServices:
    identity: _RecordingIdentity


@dataclass(frozen=True, slots=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices
    accounts: _AccountServices
    resource_access_tokens: _RecordingResourceTokens


@dataclass(slots=True)
class _RecordingLoginManager:
    users: list[_Account] = field(default_factory=list)

    def _update_request_context_with_user(self, user: _Account) -> None:
        self.users.append(user)


@dataclass(slots=True)
class _RecordingSignal:
    calls: list[tuple[object, _Account]] = field(default_factory=list)

    def send(self, sender: object, *, user: _Account) -> None:
        self.calls.append((sender, user))


@pytest.fixture
def app() -> Flask:
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.login_manager = _RecordingLoginManager()  # type: ignore[attr-defined]
    return application


def _context(*, workspace_id: str, account_id: str) -> RequestContext:
    return RequestContext(
        request_id="request-id",
        trace_id="trace-id",
        account_id=account_id,
        active_workspace_id=workspace_id,
        remote_ip="127.0.0.1",
    )


def _install_services(
    monkeypatch: pytest.MonkeyPatch,
    *,
    admission: _RecordingAdmission,
    identity: _RecordingIdentity,
    resource_tokens: _RecordingResourceTokens,
    account: _Account,
) -> _RecordingSignal:
    services = _ApplicationServices(
        knowledge=_KnowledgeServices(admission),
        accounts=_AccountServices(identity),
        resource_access_tokens=resource_tokens,
    )
    signal = _RecordingSignal()
    monkeypatch.setattr(flask_admission, "application_services", lambda: services)
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request-id")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: "")
    monkeypatch.setattr(flask_admission, "current_user", account)
    monkeypatch.setattr(flask_admission, "user_logged_in", signal)
    return signal


def test_resource_injects_request_context_and_binds_owner_account(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    context = _context(workspace_id=workspace_id, account_id=account.id)
    admission = _RecordingAdmission(context)
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    signal = _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    validator = _RecordingTokenValidator(_ApiKey(id="key-id", tenant_id=workspace_id))
    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", validator)
    dataset_id = uuid4()

    @dataset_admission(rate_limit=True, billing_resources=("documents",), require_edit_permission=True)
    def endpoint(request_context: RequestContext, *, dataset_id: UUID) -> tuple[RequestContext, UUID]:
        return request_context, dataset_id

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    with app.test_request_context(
        "/datasets",
        headers={"Authorization": "Bearer dataset-key", "X-Trace-Id": "external-trace"},
        environ_base={"REMOTE_ADDR": "192.0.2.10"},
    ):
        injected_context, injected_dataset_id = admitted_endpoint(dataset_id=dataset_id)

    assert injected_context is context
    assert injected_dataset_id == dataset_id
    assert validator.scopes == ["dataset"]
    assert admission.calls == [
        {
            "workspace_id": workspace_id,
            "api_key_id": "key-id",
            "resource_dataset_ids": None,
            "dataset_id": str(dataset_id),
            "request_id": "request-id",
            "trace_id": "external-trace",
            "remote_ip": "192.0.2.10",
            "policy": DatasetAdmissionPolicy(
                rate_limit=True,
                billing_resources=("documents",),
                require_edit_permission=True,
            ),
        }
    ]
    assert identity.calls == [(account.id, workspace_id)]
    assert app.login_manager.users == [account]  # type: ignore[attr-defined]
    assert signal.calls == [(app, account)]


def test_resource_access_token_is_resolved_once_without_api_key_validation(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    context = _context(workspace_id=workspace_id, account_id=account.id)
    admission = _RecordingAdmission(context)
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    validator = _RecordingTokenValidator(_ApiKey(id="unused", tenant_id="unused"))
    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", validator)
    dataset_id = uuid4()

    def endpoint(request_context: RequestContext, *, dataset_id: UUID) -> RequestContext:
        assert dataset_id.version == 4
        return request_context

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    token = "sk-00000000-0000-0000-0000-000000000000"
    with app.test_request_context("/datasets", headers={"Authorization": f"Bearer {token}"}):
        assert admitted_endpoint(dataset_id=dataset_id) is context

    assert validator.scopes == []
    assert resources.calls == [(token, str(dataset_id))]
    assert admission.calls[0]["api_key_id"] is None
    assert admission.calls[0]["resource_dataset_ids"] == frozenset({str(dataset_id)})
    assert len(admission.calls) == 1


def test_positional_string_dataset_id_keeps_resource_token_scope(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    context = _context(workspace_id=workspace_id, account_id=account.id)
    admission = _RecordingAdmission(context)
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    validator = _RecordingTokenValidator(_ApiKey(id="unused", tenant_id="unused"))
    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", validator)
    dataset_id = str(uuid4())

    def endpoint(request_context: RequestContext, routed_dataset_id: str) -> RequestContext:
        assert routed_dataset_id == dataset_id
        return request_context

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    token = "sk-00000000-0000-0000-0000-000000000000"
    with app.test_request_context("/datasets", headers={"Authorization": f"Bearer {token}"}):
        assert admitted_endpoint(dataset_id) is context

    assert validator.scopes == []
    assert resources.calls == [(token, dataset_id)]
    assert admission.calls[0]["dataset_id"] == dataset_id
    assert admission.calls[0]["resource_dataset_ids"] == frozenset({dataset_id})


def test_resource_access_token_collection_read_retains_bound_dataset_scope(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    context = _context(workspace_id=workspace_id, account_id=account.id)
    admission = _RecordingAdmission(context)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=_RecordingIdentity(account),
        resource_tokens=resources,
        account=account,
    )

    def endpoint(request_context: RequestContext) -> RequestContext:
        return request_context

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    token = "sk-00000000-0000-0000-0000-000000000000"
    with app.test_request_context("/datasets", headers={"Authorization": f"Bearer {token}"}):
        assert admitted_endpoint() is context

    assert admission.calls[0]["dataset_id"] is None
    assert admission.calls[0]["resource_dataset_ids"] == frozenset({"bound-dataset"})


def test_resource_access_token_cannot_write_a_dataset_collection(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    admission = _RecordingAdmission(_context(workspace_id=workspace_id, account_id=account.id))
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    called = False

    def endpoint(request_context: RequestContext) -> None:
        nonlocal called
        del request_context
        called = True

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    token = "sk-00000000-0000-0000-0000-000000000000"
    with (
        app.test_request_context("/datasets", method="POST", headers={"Authorization": f"Bearer {token}"}),
        pytest.raises(Forbidden, match="not allowed to modify knowledge base collections"),
    ):
        admitted_endpoint()

    assert resources.calls == [(token, None)]
    assert admission.calls == []
    assert identity.calls == []
    assert not called


def test_resource_access_token_can_upload_to_its_scoped_pipeline_route(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    context = _context(workspace_id=workspace_id, account_id=account.id)
    admission = _RecordingAdmission(context)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=_RecordingIdentity(account),
        resource_tokens=resources,
        account=account,
    )
    dataset_id = uuid4()

    def endpoint(request_context: RequestContext, *, dataset_id: UUID) -> RequestContext:
        assert dataset_id.version == 4
        return request_context

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    token = "sk-00000000-0000-0000-0000-000000000000"
    with app.test_request_context(
        f"/datasets/{dataset_id}/pipeline/file-upload",
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
    ):
        assert admitted_endpoint(dataset_id=dataset_id) is context

    assert resources.calls == [(token, str(dataset_id))]
    assert admission.calls[0]["dataset_id"] == str(dataset_id)
    assert admission.calls[0]["resource_dataset_ids"] == frozenset({str(dataset_id)})


def test_vector_space_policy_preserves_docs_and_declares_temporary_unavailability() -> None:
    def endpoint(request_context: RequestContext) -> RequestContext:
        return request_context

    endpoint.__apidoc__ = {"responses": {400: "Bad request"}, "operationId": "test"}  # type: ignore[attr-defined]

    documented = dataset_admission(billing_resources=("vector_space",))(endpoint)

    assert documented.__apidoc__ == {  # type: ignore[attr-defined]
        "responses": {
            400: "Bad request",
            503: (
                "`service_unavailable` : Vector space usage could not be verified. "
                "Returned on the Dify Cloud Sandbox plan only; retry the request later."
            ),
        },
        "operationId": "test",
    }


def test_vector_space_unavailability_is_translated_to_service_unavailable(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    admission = _RecordingAdmission(
        _context(workspace_id=workspace_id, account_id=account.id),
        KnowledgeApiVectorSpaceUnavailableError(),
    )
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    monkeypatch.setattr(
        flask_admission,
        "validate_and_get_api_token",
        _RecordingTokenValidator(_ApiKey(id="key-id", tenant_id=workspace_id)),
    )

    def endpoint(request_context: RequestContext) -> RequestContext:
        return request_context

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    with (
        app.test_request_context("/datasets", headers={"Authorization": "Bearer dataset-key"}),
        pytest.raises(ServiceUnavailable, match="Please try again later"),
    ):
        admitted_endpoint()

    assert identity.calls == []


def test_scoped_api_key_rejection_is_translated_before_account_binding(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = str(uuid4())
    account = _Account(id=str(uuid4()))
    admission = _RecordingAdmission(
        _context(workspace_id=workspace_id, account_id=account.id),
        DatasetAdmissionScopeError("The API key is not authorized to access this knowledge base."),
    )
    identity = _RecordingIdentity(account)
    resources = _RecordingResourceTokens(workspace_id)
    _install_services(
        monkeypatch,
        admission=admission,
        identity=identity,
        resource_tokens=resources,
        account=account,
    )
    validator = _RecordingTokenValidator(_ApiKey(id="scoped-key", tenant_id=workspace_id))
    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", validator)
    called = False

    def endpoint(request_context: RequestContext, *, dataset_id: UUID) -> None:
        nonlocal called
        del request_context, dataset_id
        called = True

    admitted_endpoint = DatasetApiResource.method_decorators[0](endpoint)
    with (
        app.test_request_context("/datasets", headers={"Authorization": "Bearer dataset-key"}),
        pytest.raises(Forbidden, match="not authorized"),
    ):
        admitted_endpoint(dataset_id=uuid4())

    assert validator.scopes == ["dataset"]
    assert len(admission.calls) == 1
    assert identity.calls == []
    assert app.login_manager.users == []  # type: ignore[attr-defined]
    assert not called
