from dataclasses import asdict
from typing import cast
from unittest.mock import Mock

from services.credentials.query import CredentialQuery, DatasourceCredentialListItem
from services.data_source.credential_metadata_service import DatasourceCredentialMetadataService


def _credential(*, credential_id: str, name: str, is_default: bool) -> DatasourceCredentialListItem:
    return DatasourceCredentialListItem(
        id=credential_id,
        name=name,
        auth_type="oauth2",
        encrypted_credentials={"access_token": "must-not-be-returned"},
        avatar_url=None,
        is_default=is_default,
    )


def test_lists_safe_metadata_and_resolves_the_concrete_default() -> None:
    query = Mock()
    query.list_datasources.return_value = [
        _credential(credential_id="credential-secondary", name="Secondary", is_default=False),
        _credential(credential_id="credential-default", name="Default", is_default=True),
    ]
    service = DatasourceCredentialMetadataService(credential_query=cast(CredentialQuery, query))

    credentials = service.list(tenant_id="tenant-1", plugin_id="org/plugin", provider="notion")
    default = service.resolve_default(tenant_id="tenant-1", plugin_id="org/plugin", provider="notion")

    assert [credential.id for credential in credentials] == ["credential-default", "credential-secondary"]
    assert default is not None
    assert default.id == "credential-default"
    assert asdict(default) == {
        "id": "credential-default",
        "name": "Default",
        "type": "oauth2",
        "is_default": True,
    }
    query.list_datasources.assert_called_with(
        workspace_id="tenant-1",
        plugin_id="org/plugin",
        provider="notion",
        actor_id=None,
    )


def test_resolve_default_returns_none_when_the_workspace_has_no_matching_credential() -> None:
    query = Mock()
    query.list_datasources.return_value = []
    service = DatasourceCredentialMetadataService(credential_query=cast(CredentialQuery, query))

    assert service.resolve_default(tenant_id="tenant-1", plugin_id="org/plugin", provider="notion") is None
