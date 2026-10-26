from __future__ import annotations

from collections.abc import Callable

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.openapi._models import WorkspaceListQuery
from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspacesApi
from models import Account
from models.account import TenantAccountRole
from tests.e2e_tests.containers.controllers.openapi.conftest import add_tenant_for_account, context_for


class TestWorkspacesList:
    def test_lists_only_members_workspaces_with_role(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None

        api = WorkspacesApi()
        with app.test_request_context("/openapi/v1/workspaces"):
            result = api.get.__handler__(
                api, context_for(account, session=db_session_with_containers), query=WorkspaceListQuery()
            )

        ids = {w.id for w in result.data}
        assert ids == {owner_tenant.id}
        only = result.data[0]
        assert only.role == TenantAccountRole.OWNER.value
        assert only.status == "normal"

    def test_lists_all_joined_workspaces(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        second = add_tenant_for_account(account, session=db_session_with_containers, role="normal", name="Second WS")

        api = WorkspacesApi()
        with app.test_request_context("/openapi/v1/workspaces"):
            result = api.get.__handler__(
                api, context_for(account, session=db_session_with_containers), query=WorkspaceListQuery()
            )

        assert {w.id for w in result.data} == {owner_tenant.id, second.id}


class TestWorkspaceDetail:
    def test_member_can_read_detail(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None

        api = WorkspaceByIdApi()
        with app.test_request_context(f"/openapi/v1/workspaces/{tenant.id}"):
            detail = api.get.__handler__(
                api,
                context_for(account, session=db_session_with_containers, view_args={"workspace_id": tenant.id}),
                tenant.id,
            )

        assert detail.id == tenant.id
        assert detail.role == TenantAccountRole.OWNER.value
        assert detail.created_at is not None

    def test_non_member_detail_is_404_not_403(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """A workspace the caller doesn't belong to must be indistinguishable
        from a missing one (404), so IDs can't be probed across tenants."""
        owner = make_account()
        outsider = make_account()
        someone_elses_ws = owner.current_tenant
        assert someone_elses_ws is not None

        api = WorkspaceByIdApi()
        with app.test_request_context(f"/openapi/v1/workspaces/{someone_elses_ws.id}"):
            with pytest.raises(NotFound):
                api.get.__handler__(
                    api,
                    context_for(
                        outsider,
                        session=db_session_with_containers,
                        view_args={"workspace_id": someone_elses_ws.id},
                    ),
                    someone_elses_ws.id,
                )
