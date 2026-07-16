from __future__ import annotations

import inspect
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import uuid4

import pytest
from flask import Flask

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


def test_get_data_source_integrates_serializes_orm_binding(flask_app: Flask) -> None:
    binding = DataSourceOauthBinding(
        tenant_id="tenant-1",
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
    )
    binding.id = "binding-1"
    binding.created_at = datetime(2026, 5, 25, 1, 2, 3, tzinfo=UTC)
    binding.disabled = False

    with (
        flask_app.test_request_context("/"),
        patch.object(module.db.session, "scalars", return_value=MagicMock(all=lambda: [binding])),
    ):
        response, status = unwrap(DataSourceApi().get)(DataSourceApi(), "tenant-1")

    assert status == 200
    assert response == {
        "data": [
            {
                "id": "binding-1",
                "provider": "notion",
                "created_at": 1779670923,
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


def test_get_data_source_integrates_preserves_empty_list_when_no_binding(flask_app: Flask) -> None:
    with (
        flask_app.test_request_context("/"),
        patch.object(module.db.session, "scalars", return_value=MagicMock(all=lambda: [])),
    ):
        response, status = unwrap(DataSourceApi().get)(DataSourceApi(), "tenant-1")

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
