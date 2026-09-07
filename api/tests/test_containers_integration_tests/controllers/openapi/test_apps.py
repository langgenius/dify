from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.openapi._models import AppDescribeQuery, AppListQuery
from controllers.openapi.apps import AppDescribeApi, AppListApi
from models import Account, App
from services.app_service import AppService, CreateAppParams
from tests.test_containers_integration_tests.controllers.openapi.conftest import auth_for


def _create_app(
    db_session: Session,
    account: Account,
    *,
    name: str,
    enable_api: bool = True,
) -> App:
    """Create a workflow app in the account's owner tenant.

    Workflow mode is used because its template seeds no ``model_config``, so
    ``AppService.create_app`` never reaches ``ModelManager`` — keeping the
    fixture free of model-runtime patching.
    """
    tenant = account.current_tenant
    assert tenant is not None
    params = CreateAppParams(
        name=name,
        description="",
        mode="workflow",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FF6B6B",
    )
    app_model = AppService().create_app(tenant.id, params, account, session=db_session)
    # The openapi surface gate keys off ``enable_api``; flip it explicitly so
    # the test states the visibility precondition rather than relying on the
    # template default.
    app_model.enable_api = enable_api
    db_session.add(app_model)
    db_session.commit()
    return app_model


class TestAppList:
    def test_lists_only_api_enabled_apps_in_workspace(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None
        visible = _create_app(db_session_with_containers, account, name="Visible", enable_api=True)
        _create_app(db_session_with_containers, account, name="Hidden", enable_api=False)

        api = AppListApi()
        with app.test_request_context(f"/openapi/v1/apps?workspace_id={tenant.id}"):
            result = unwrap(api.get)(
                api,
                db_session_with_containers,
                auth_data=auth_for(account),
                query=AppListQuery(workspace_id=str(tenant.id)),
            )

        # The api-disabled app is gated out, so it counts neither in `data`
        # nor in `total` (the gate is pushed into the query for stable paging).
        assert result.total == 1
        assert [row.id for row in result.data] == [visible.id]
        assert result.has_more is False

    def test_uuid_name_filter_returns_matching_app(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None
        target = _create_app(db_session_with_containers, account, name="Target", enable_api=True)

        api = AppListApi()
        with app.test_request_context(f"/openapi/v1/apps?workspace_id={tenant.id}&name={target.id}"):
            result = unwrap(api.get)(
                api,
                db_session_with_containers,
                auth_data=auth_for(account),
                query=AppListQuery(workspace_id=str(tenant.id), name=str(target.id)),
            )

        assert result.total == 1
        assert result.data[0].id == target.id
        assert result.data[0].workspace_id == str(tenant.id)

    def test_uuid_name_filter_for_foreign_app_returns_empty(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """A UUID that resolves to an app in another workspace must not leak
        across tenants — the list returns empty rather than the foreign app."""
        owner = make_account()
        outsider = make_account()
        foreign_app = _create_app(db_session_with_containers, owner, name="Foreign", enable_api=True)
        outsider_tenant = outsider.current_tenant
        assert outsider_tenant is not None

        api = AppListApi()
        with app.test_request_context(f"/openapi/v1/apps?workspace_id={outsider_tenant.id}&name={foreign_app.id}"):
            result = unwrap(api.get)(
                api,
                db_session_with_containers,
                auth_data=auth_for(outsider),
                query=AppListQuery(workspace_id=str(outsider_tenant.id), name=str(foreign_app.id)),
            )

        assert result.total == 0
        assert result.data == []


class TestAppDescribe:
    def test_describe_info_returns_metadata(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        app_model = _create_app(db_session_with_containers, account, name="Describe Me", enable_api=True)

        api = AppDescribeApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_model.id}?fields=info"):
            result = unwrap(api.get)(
                api,
                db_session_with_containers,
                app_id=app_model.id,
                auth_data=auth_for(account),
                query=AppDescribeQuery(fields="info"),
            )

        assert result.info is not None
        assert result.info.id == app_model.id
        assert result.info.name == "Describe Me"
        assert result.info.service_api_enabled is True
        # Only the requested block is materialized.
        assert result.parameters is None
        assert result.input_schema is None

    def test_describe_unknown_app_is_404(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        missing_id = str(uuid4())

        api = AppDescribeApi()
        with app.test_request_context(f"/openapi/v1/apps/{missing_id}"):
            with pytest.raises(NotFound):
                unwrap(api.get)(
                    api,
                    db_session_with_containers,
                    app_id=missing_id,
                    auth_data=auth_for(account),
                    query=AppDescribeQuery(),
                )

    def test_describe_api_disabled_app_is_404(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """An api-disabled app fails the openapi visibility gate, so describe
        must behave as if it doesn't exist (404), not expose it."""
        account = make_account()
        hidden = _create_app(db_session_with_containers, account, name="Hidden", enable_api=False)

        api = AppDescribeApi()
        with app.test_request_context(f"/openapi/v1/apps/{hidden.id}"):
            with pytest.raises(NotFound):
                unwrap(api.get)(
                    api,
                    db_session_with_containers,
                    app_id=hidden.id,
                    auth_data=auth_for(account),
                    query=AppDescribeQuery(),
                )
