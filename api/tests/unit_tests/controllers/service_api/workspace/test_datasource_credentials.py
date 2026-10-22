from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

from flask import Flask

from controllers.service_api.workspace import datasource_credentials as controller
from controllers.service_api.workspace.datasource_credentials import DatasourceCredentialsApi
from services.credentials.query import DatasourceCredentialListItem


def test_lists_only_datasource_credential_metadata(monkeypatch, app: Flask) -> None:
    query = Mock()
    query.list_datasources.return_value = [
        DatasourceCredentialListItem(
            id="credential-1",
            name="Workspace Notion",
            auth_type="oauth2",
            encrypted_credentials={"access_token": "must-not-be-returned"},
            avatar_url=None,
            is_default=True,
        )
    ]
    monkeypatch.setattr(
        controller,
        "application_services",
        lambda: SimpleNamespace(credential_queries=query),
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
