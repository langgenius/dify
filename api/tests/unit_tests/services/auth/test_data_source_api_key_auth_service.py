"""Unit tests for the data-source API-key auth application service and ports."""

from datetime import datetime

from machinery.context import RequestContext
from services.data_source.auth.api_key_service import (
    ApiKeyAuthCredentialEncryptor,
    ApiKeyAuthCredentialValidator,
    DataSourceApiKeyAuthBindingRepository,
    DataSourceApiKeyAuthService,
)
from services.data_source.entities.api_key_auth import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthBindingRecord,
    DataSourceApiKeyAuthCredentials,
)


class RecordingBindings(DataSourceApiKeyAuthBindingRepository):
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.records: list[DataSourceApiKeyAuthBindingRecord] = []
        self.list_calls: list[str] = []
        self.create_calls: list[tuple[str, str, str, DataSourceApiKeyAuthCredentials]] = []
        self.delete_calls: list[tuple[str, str]] = []

    def list_enabled(self, workspace_id: str) -> list[DataSourceApiKeyAuthBindingRecord]:
        self.list_calls.append(workspace_id)
        return self.records

    def create(
        self, workspace_id: str, category: str, provider: str, credentials: DataSourceApiKeyAuthCredentials
    ) -> None:
        self.events.append("create")
        self.create_calls.append((workspace_id, category, provider, credentials))

    def delete(self, workspace_id: str, binding_id: str) -> None:
        self.delete_calls.append((workspace_id, binding_id))


class RecordingValidator(ApiKeyAuthCredentialValidator):
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.accepted = True
        self.calls: list[tuple[str, DataSourceApiKeyAuthCredentials]] = []

    def validate(self, provider: str, credentials: DataSourceApiKeyAuthCredentials) -> bool:
        self.events.append("validate")
        self.calls.append((provider, credentials))
        return self.accepted


class RecordingEncryptor(ApiKeyAuthCredentialEncryptor):
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.calls: list[tuple[str, str]] = []

    def encrypt(self, workspace_id: str, token: str) -> str:
        self.events.append("encrypt")
        self.calls.append((workspace_id, token))
        return "encrypted-secret"


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _command() -> DataSourceApiKeyAuthBindingCreate:
    return DataSourceApiKeyAuthBindingCreate(
        category="search",
        provider="firecrawl",
        credentials=DataSourceApiKeyAuthCredentials(
            auth_type="bearer",
            api_key="secret",
            options={"base_url": "https://example.com"},
        ),
    )


def _service() -> tuple[DataSourceApiKeyAuthService, RecordingBindings, RecordingValidator, RecordingEncryptor]:
    events: list[str] = []
    bindings = RecordingBindings(events)
    validator = RecordingValidator(events)
    encryptor = RecordingEncryptor(events)
    return (
        DataSourceApiKeyAuthService(bindings=bindings, validator=validator, encryptor=encryptor),
        bindings,
        validator,
        encryptor,
    )


def test_list_bindings_uses_active_workspace() -> None:
    service, bindings, _validator, _encryptor = _service()
    record = DataSourceApiKeyAuthBindingRecord(
        id="binding-1",
        category="search",
        provider="firecrawl",
        disabled=False,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )
    bindings.records = [record]

    assert service.list_bindings(_context()) == (record,)
    assert bindings.list_calls == ["workspace-1"]


def test_create_binding_validates_before_encrypting_and_persisting() -> None:
    service, bindings, validator, encryptor = _service()
    command = _command()

    service.create_binding(_context(), command)

    assert validator.calls == [("firecrawl", command.credentials)]
    assert encryptor.calls == [("workspace-1", "secret")]
    assert bindings.events == ["validate", "encrypt", "create"]
    assert bindings.create_calls == [
        (
            "workspace-1",
            "search",
            "firecrawl",
            DataSourceApiKeyAuthCredentials(
                auth_type="bearer",
                api_key="encrypted-secret",
                options={"base_url": "https://example.com"},
            ),
        )
    ]
    assert command.credentials.api_key == "secret"


def test_create_binding_does_not_persist_rejected_credentials() -> None:
    service, bindings, validator, encryptor = _service()
    validator.accepted = False

    service.create_binding(_context(), _command())

    assert bindings.events == ["validate"]
    assert encryptor.calls == []
    assert bindings.create_calls == []


def test_delete_binding_scopes_to_active_workspace() -> None:
    service, bindings, _validator, _encryptor = _service()

    service.delete_binding(_context(), "binding-1")

    assert bindings.delete_calls == [("workspace-1", "binding-1")]
