from inspect import unwrap

import pytest
from flask import Flask

from controllers.service_api.workspace import datasource_credentials as controller
from controllers.service_api.workspace.datasource_credentials import DatasourceCredentialsApi
from services.credentials.query import DatasourceCredentialListItem
from tests.unit_tests.credential_query_fakes import CredentialServices, DatasourceCredentialQuery


def test_lists_only_datasource_credential_metadata(monkeypatch: pytest.MonkeyPatch, app: Flask) -> None:
    query = DatasourceCredentialQuery(
        credentials=[
            DatasourceCredentialListItem(
                id="credential-1",
                name="Workspace Notion",
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

    with app.test_request_context(
        "/datasource-credentials?plugin_id=langgenius/notion_datasource&provider=notion_datasource"
    ):
        response = unwrap(DatasourceCredentialsApi.get)(DatasourceCredentialsApi(), "tenant-1")

    assert response == {
        "data": [
            {
                "id": "credential-1",
                "name": "Workspace Notion",
                "type": "oauth2",
                "is_default": True,
            }
        ]
    }
    assert "access_token" not in str(response)
