from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import ImportStatus


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_rejects_oversized_yaml_content_before_parsing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 3)
    service = AppDslService(session=sqlite_session)
    account = Mock(current_tenant_id="tenant-1")

    result = service.import_app(account=account, import_mode="yaml-content", yaml_content="你你")

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_rejects_oversized_yaml_url_bytes_before_decode(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 1)
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=sqlite_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_returns_decode_error_for_invalid_yaml_url_bytes(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=sqlite_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "utf-8" in result.error
    assert not sqlite_session.in_transaction()


def test_strip_tenant_file_defaults_removes_local_file_ids() -> None:
    workflow_dict = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "variables": [
                            {
                                "variable": "contract",
                                "type": "file",
                                "default": {
                                    "name": "contract.pdf",
                                    "transfer_method": "local_file",
                                    "type": "document",
                                    "upload_file_id": "source-workspace-file",
                                    "uploadedId": "source-workspace-file",
                                },
                            },
                            {
                                "variable": "attachments",
                                "type": "file-list",
                                "default": [
                                    {
                                        "name": "local.pdf",
                                        "transferMethod": "local_file",
                                        "type": "document",
                                        "uploadedId": "source-workspace-file-2",
                                    },
                                    {
                                        "name": "remote.pdf",
                                        "transfer_method": "remote_url",
                                        "url": "https://example.com/remote.pdf",
                                        "type": "document",
                                    },
                                ],
                            },
                            {
                                "variable": "notes",
                                "type": "text-input",
                                "default": {
                                    "upload_file_id": "not-a-file-variable",
                                },
                            },
                        ]
                    }
                }
            ]
        }
    }

    AppDslService._strip_tenant_file_defaults_from_workflow_dict(workflow_dict)

    variables = workflow_dict["graph"]["nodes"][0]["data"]["variables"]
    assert "default" not in variables[0]
    assert variables[1]["default"] == [
        {
            "name": "remote.pdf",
            "transfer_method": "remote_url",
            "url": "https://example.com/remote.pdf",
            "type": "document",
        }
    ]
    assert variables[2]["default"] == {"upload_file_id": "not-a-file-variable"}
