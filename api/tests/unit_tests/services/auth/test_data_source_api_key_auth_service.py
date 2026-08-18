"""Unit tests for the data-source API-key auth application service and ports."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthBindingRecord,
    DataSourceApiKeyAuthCredentials,
)


def _context(workspace_id: str | None = "workspace-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id=workspace_id,
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


def _service() -> tuple[DataSourceApiKeyAuthService, MagicMock, MagicMock, MagicMock]:
    bindings = MagicMock()
    validator = MagicMock()
    encryptor = MagicMock()
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
    bindings.list_enabled.return_value = [record]

    assert service.list_bindings(_context()) == (record,)
    bindings.list_enabled.assert_called_once_with("workspace-1")


def test_create_binding_validates_before_encrypting_and_persisting() -> None:
    service, bindings, validator, encryptor = _service()
    command = _command()
    validator.validate.return_value = True
    encryptor.encrypt.return_value = "encrypted-secret"

    service.create_binding(_context(), command)

    validator.validate.assert_called_once_with("firecrawl", command.credentials)
    encryptor.encrypt.assert_called_once_with("workspace-1", "secret")
    bindings.create.assert_called_once_with(
        "workspace-1",
        "search",
        "firecrawl",
        DataSourceApiKeyAuthCredentials(
            auth_type="bearer",
            api_key="encrypted-secret",
            options={"base_url": "https://example.com"},
        ),
    )
    assert command.credentials.api_key == "secret"


def test_create_binding_does_not_persist_rejected_credentials() -> None:
    service, bindings, validator, encryptor = _service()
    validator.validate.return_value = False

    service.create_binding(_context(), _command())

    encryptor.encrypt.assert_not_called()
    bindings.create.assert_not_called()


def test_delete_binding_scopes_to_active_workspace() -> None:
    service, bindings, _validator, _encryptor = _service()

    service.delete_binding(_context(), "binding-1")

    bindings.delete.assert_called_once_with("workspace-1", "binding-1")


def test_use_cases_require_active_workspace() -> None:
    service, _bindings, _validator, _encryptor = _service()

    with pytest.raises(ActiveWorkspaceRequiredError, match="active workspace"):
        service.list_bindings(_context(None))
