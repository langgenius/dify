from inspect import unwrap

from controllers.inner_api import datasource_credentials as controller
from controllers.inner_api.datasource_credentials import (
    InnerDatasourceDefaultCredentialApi,
    InnerDatasourceDefaultCredentialPayload,
)
from services.credentials.query import DatasourceCredentialListItem
from tests.unit_tests.credential_query_fakes import CredentialServices, DatasourceCredentialQuery


def test_resolves_default_datasource_credential_metadata(monkeypatch) -> None:
    query = DatasourceCredentialQuery(
        credentials=[
            DatasourceCredentialListItem(
                id="credential-default",
                name="Workspace default",
                auth_type="oauth2",
                encrypted_credentials={"access_token": "must-not-be-returned"},
                avatar_url=None,
                is_default=True,
            )
        ]
    )
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: CredentialServices(credential_queries=query),
    )
    payload = InnerDatasourceDefaultCredentialPayload(
        tenant_id="tenant-1",
        plugin_id="langgenius/notion_datasource",
        provider="notion_datasource",
    )

    response = unwrap(InnerDatasourceDefaultCredentialApi.post)(InnerDatasourceDefaultCredentialApi(), payload)

    assert response == {
        "credential": {
            "id": "credential-default",
            "name": "Workspace default",
            "type": "oauth2",
            "is_default": True,
        }
    }
    assert "access_token" not in str(response)


def test_returns_a_null_credential_when_no_default_is_available(monkeypatch) -> None:
    query = DatasourceCredentialQuery(credentials=[])
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: CredentialServices(credential_queries=query),
    )
    payload = InnerDatasourceDefaultCredentialPayload(
        tenant_id="tenant-1",
        plugin_id="langgenius/notion_datasource",
        provider="notion_datasource",
    )

    response = unwrap(InnerDatasourceDefaultCredentialApi.post)(InnerDatasourceDefaultCredentialApi(), payload)

    assert response == {"credential": None}
