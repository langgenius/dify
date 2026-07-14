from __future__ import annotations

import inspect
from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.datasets import data_source as module
from controllers.console.datasets.data_source import DataSourceApi, DataSourceNotionListApi
from models import Account, DataSourceOauthBinding

ControllerMethod = Callable[..., tuple[dict[str, object], int]]


def unwrap(func: object) -> ControllerMethod:
    return cast(ControllerMethod, inspect.unwrap(cast(Callable[..., object], func)))


@pytest.fixture
def flask_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def current_user() -> Account:
    account = Account(name="Test User", email="user-1@example.com")
    account.id = "user-1"
    return account


TENANT_ID = "11111111-1111-1111-1111-111111111111"
BINDING_ID = "22222222-2222-2222-2222-222222222222"


def _route_database_to_sqlite(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session) -> None:
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine, session=sqlite_session))


def _add_binding(sqlite_session: Session, *, disabled: bool) -> DataSourceOauthBinding:
    binding = DataSourceOauthBinding(
        tenant_id=TENANT_ID,
        access_token="token",
        provider="notion",
        source_info={
            "workspace_name": "Workspace",
            "workspace_id": "workspace-1",
            "workspace_icon": None,
            "total": 1,
            "pages": [
                {
                    "page_id": "page-1",
                    "page_name": "Page",
                    "page_icon": {"type": "emoji", "emoji": "P", "url": None},
                    "parent_id": "parent-1",
                    "type": "page",
                }
            ],
        },
        disabled=disabled,
    )
    binding.id = BINDING_ID
    binding.created_at = datetime(2026, 5, 25, 1, 2, 3, tzinfo=UTC)
    sqlite_session.add(binding)
    sqlite_session.commit()
    return binding


@pytest.mark.parametrize("sqlite_session", [(DataSourceOauthBinding,)], indirect=True)
def test_get_data_source_integrates_serializes_orm_binding(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    _route_database_to_sqlite(monkeypatch, sqlite_engine, sqlite_session)
    binding = _add_binding(sqlite_session, disabled=False)
    expected_created_at = int(binding.created_at.timestamp())

    with flask_app.test_request_context("/"):
        response, status = unwrap(DataSourceApi().get)(DataSourceApi(), TENANT_ID)

    assert status == 200
    assert response == {
        "data": [
            {
                "id": BINDING_ID,
                "provider": "notion",
                "created_at": expected_created_at,
                "is_bound": True,
                "disabled": False,
                "source_info": {
                    "workspace_name": "Workspace",
                    "workspace_id": "workspace-1",
                    "workspace_icon": None,
                    "pages": [
                        {
                            "page_name": "Page",
                            "page_id": "page-1",
                            "page_icon": {"type": "emoji", "url": None, "emoji": "P"},
                            "parent_id": "parent-1",
                            "type": "page",
                        }
                    ],
                    "total": 1,
                },
                "link": "http://localhost/console/api/oauth/data-source/notion",
            }
        ]
    }


@pytest.mark.parametrize("sqlite_session", [(DataSourceOauthBinding,)], indirect=True)
def test_get_data_source_integrates_preserves_empty_list_when_no_binding(
    flask_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    _route_database_to_sqlite(monkeypatch, sqlite_engine, sqlite_session)

    with flask_app.test_request_context("/"):
        response, status = unwrap(DataSourceApi().get)(DataSourceApi(), TENANT_ID)

    assert status == 200
    assert response == {"data": []}


def test_patch_data_source_binding_uses_injected_session(flask_app: Flask) -> None:
    binding = MagicMock(disabled=True)
    session = MagicMock()
    session.scalar.return_value = binding

    with flask_app.test_request_context("/"):
        response, status = unwrap(DataSourceApi().patch)(DataSourceApi(), session, "tenant-1", uuid4(), "enable")

    assert status == 200
    assert response == {"result": "success"}
    assert binding.disabled is False
    session.scalar.assert_called_once()
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_notion_pre_import_pages_serializes_frontend_list_shape(flask_app: Flask, current_user: Account) -> None:
    page = MagicMock(
        page_id="page-1",
        page_name="Page",
        type="page",
        parent_id="parent-1",
        page_icon={"type": "emoji", "emoji": "P", "url": None},
    )
    online_document_message = MagicMock(
        result=[
            MagicMock(
                workspace_id="workspace-1",
                workspace_name="Workspace",
                workspace_icon=None,
                pages=[page],
            )
        ]
    )
    runtime = MagicMock(
        get_online_document_pages=MagicMock(return_value=iter([online_document_message])),
        datasource_provider_type=MagicMock(return_value="online_document"),
    )
    session = MagicMock()

    with (
        flask_app.test_request_context("/?credential_id=credential-1"),
        patch.object(
            module.DatasourceProviderService,
            "get_datasource_credentials",
            return_value={"token": "token"},
        ),
        patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=MagicMock()),
        patch("core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime", return_value=runtime),
    ):
        response, status = unwrap(DataSourceNotionListApi().get)(
            DataSourceNotionListApi(), session, "tenant-1", current_user
        )

    assert status == 200
    assert response == {
        "notion_info": [
            {
                "workspace_name": "Workspace",
                "workspace_id": "workspace-1",
                "workspace_icon": None,
                "pages": [
                    {
                        "page_name": "Page",
                        "page_id": "page-1",
                        "page_icon": {"type": "emoji", "url": None, "emoji": "P"},
                        "parent_id": "parent-1",
                        "type": "page",
                        "is_bound": False,
                    }
                ],
            }
        ]
    }
    runtime.get_online_document_pages.assert_called_once()
    assert runtime.get_online_document_pages.call_args.kwargs["datasource_parameters"] == {}


def test_notion_pre_import_pages_rejects_missing_credential(flask_app: Flask, current_user: Account) -> None:
    session = MagicMock()

    with (
        flask_app.test_request_context("/?credential_id=credential-1"),
        patch.object(module.DatasourceProviderService, "get_datasource_credentials", return_value=None),
        pytest.raises(NotFound, match="Credential not found"),
    ):
        unwrap(DataSourceNotionListApi().get)(DataSourceNotionListApi(), session, TENANT_ID, current_user)


def test_notion_pre_import_pages_rejects_non_notion_dataset(flask_app: Flask, current_user: Account) -> None:
    dataset = MagicMock(data_source_type="other_type")
    session = MagicMock()

    with (
        flask_app.test_request_context("/?credential_id=credential-1&dataset_id=dataset-1"),
        patch.object(
            module.DatasourceProviderService,
            "get_datasource_credentials",
            return_value={"token": "token"},
        ),
        patch.object(module.DatasetService, "get_dataset", return_value=dataset),
        pytest.raises(ValueError, match="Dataset is not notion type"),
    ):
        unwrap(DataSourceNotionListApi().get)(DataSourceNotionListApi(), session, TENANT_ID, current_user)
