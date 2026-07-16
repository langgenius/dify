from __future__ import annotations

import inspect
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Literal, cast
from unittest.mock import MagicMock, PropertyMock, patch
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.datasets import data_source as module
from controllers.console.datasets.data_source import DataSourceApi, DataSourceNotionListApi
from models import Account, DataSourceOauthBinding
from models.engine import db

ControllerMethod = Callable[..., tuple[dict[str, object], int]]


def unwrap(func: object) -> ControllerMethod:
    return cast(ControllerMethod, inspect.unwrap(cast(Callable[..., object], func)))


@pytest.fixture
def flask_app() -> Iterator[Flask]:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)

    with app.app_context():
        DataSourceOauthBinding.__table__.create(db.engine)
        yield app


@pytest.fixture
def current_user() -> Account:
    account = Account(name="Test User", email="user-1@example.com")
    account.id = "user-1"
    return account


TENANT_ID = "11111111-1111-1111-1111-111111111111"
BINDING_ID = "22222222-2222-2222-2222-222222222222"


def _add_binding(session: Session, *, disabled: bool) -> DataSourceOauthBinding:
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
    session.add(binding)
    session.commit()
    return binding


def test_get_data_source_integrates_serializes_orm_binding(
    flask_app: Flask,
) -> None:
    binding = _add_binding(db.session, disabled=False)
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


def test_get_data_source_integrates_preserves_empty_list_when_no_binding(
    flask_app: Flask,
) -> None:
    with flask_app.test_request_context("/"):
        response, status = unwrap(DataSourceApi().get)(DataSourceApi(), TENANT_ID)

    assert status == 200
    assert response == {"data": []}


@pytest.mark.parametrize(
    ("disabled", "action", "expected_disabled"),
    [(True, "enable", False), (False, "disable", True)],
)
def test_patch_data_source_binding_updates_state(
    flask_app: Flask,
    disabled: bool,
    action: str,
    expected_disabled: bool,
) -> None:
    _add_binding(db.session, disabled=disabled)
    db.session.expunge_all()

    with flask_app.test_request_context("/"):
        response, status = unwrap(DataSourceApi().patch)(
            DataSourceApi(),
            db.session,
            TENANT_ID,
            UUID(BINDING_ID),
            cast(Literal["enable", "disable"], action),
        )

    db.session.flush()
    db.session.expire_all()
    binding = db.session.scalar(select(DataSourceOauthBinding).where(DataSourceOauthBinding.id == BINDING_ID))
    assert status == 200
    assert response == {"result": "success"}
    assert binding is not None
    assert binding.disabled is expected_disabled


def test_patch_data_source_binding_rejects_unknown_binding(
    flask_app: Flask,
) -> None:
    with flask_app.test_request_context("/"), pytest.raises(NotFound, match="Data source binding not found"):
        unwrap(DataSourceApi().patch)(DataSourceApi(), db.session, TENANT_ID, UUID(BINDING_ID), "enable")


@pytest.mark.parametrize(("disabled", "action"), [(False, "enable"), (True, "disable")])
def test_patch_data_source_binding_rejects_current_state(
    flask_app: Flask,
    disabled: bool,
    action: str,
) -> None:
    _add_binding(db.session, disabled=disabled)
    db.session.expunge_all()

    with flask_app.test_request_context("/"), pytest.raises(ValueError):
        unwrap(DataSourceApi().patch)(
            DataSourceApi(),
            db.session,
            TENANT_ID,
            UUID(BINDING_ID),
            cast(Literal["enable", "disable"], action),
        )


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
    with (
        flask_app.test_request_context("/?credential_id=credential-1"),
        patch.object(module.DatasourceProviderService, "get_datasource_credentials", return_value=None),
        pytest.raises(NotFound, match="Credential not found"),
    ):
        unwrap(DataSourceNotionListApi().get)(DataSourceNotionListApi(), MagicMock(), TENANT_ID, current_user)


def test_notion_pre_import_pages_rejects_non_notion_dataset(flask_app: Flask, current_user: Account) -> None:
    dataset = MagicMock(data_source_type="other_type")

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
        unwrap(DataSourceNotionListApi().get)(DataSourceNotionListApi(), MagicMock(), TENANT_ID, current_user)
