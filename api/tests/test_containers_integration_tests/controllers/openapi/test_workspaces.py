from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspacesApi, WorkspaceSwitchApi
from models import Account
from models.account import TenantAccountRole
from tests.test_containers_integration_tests.controllers.openapi.conftest import add_tenant_for_account, auth_for


class TestWorkspacesList:
    def test_lists_only_members_workspaces_with_role(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None

        api = WorkspacesApi()
        with app.test_request_context("/openapi/v1/workspaces"):
            result = unwrap(api.get)(api, auth_data=auth_for(account))

        ids = {w.id for w in result.workspaces}
        assert ids == {owner_tenant.id}
        only = result.workspaces[0]
        assert only.role == TenantAccountRole.OWNER.value
        assert only.status == "normal"
        # Newly-created owner membership is not yet "current"; switching flips it
        # (see TestWorkspaceSwitch).
        assert only.current is False

    def test_lists_all_joined_workspaces(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        second = add_tenant_for_account(account, session=db_session_with_containers, role="normal", name="Second WS")

        api = WorkspacesApi()
        with app.test_request_context("/openapi/v1/workspaces"):
            result = unwrap(api.get)(api, auth_data=auth_for(account))

        assert {w.id for w in result.workspaces} == {owner_tenant.id, second.id}


class TestWorkspaceDetail:
    def test_member_can_read_detail(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        tenant = account.current_tenant
        assert tenant is not None

        api = WorkspaceByIdApi()
        with app.test_request_context(f"/openapi/v1/workspaces/{tenant.id}"):
            detail = unwrap(api.get)(api, workspace_id=tenant.id, auth_data=auth_for(account))

        assert detail.id == tenant.id
        assert detail.role == TenantAccountRole.OWNER.value
        assert detail.current is False
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
                unwrap(api.get)(api, workspace_id=someone_elses_ws.id, auth_data=auth_for(outsider))


class TestWorkspaceSwitch:
    def test_switch_sets_current_and_persists(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        owner_tenant = account.current_tenant
        assert owner_tenant is not None
        target = add_tenant_for_account(
            account, session=db_session_with_containers, role="normal", name="Switch Target"
        )

        api = WorkspaceSwitchApi()
        with app.test_request_context(f"/openapi/v1/workspaces/{target.id}:switch", method="POST"):
            detail = unwrap(api.post)(api, workspace_id=target.id, auth_data=auth_for(account))

        # Response reflects the post-switch state.
        assert detail.id == target.id
        assert detail.current is True

        # And the switch persisted: the previously-current owner workspace is no
        # longer current (verified through the real read path).
        with app.test_request_context("/openapi/v1/workspaces"):
            listing = unwrap(WorkspacesApi().get)(WorkspacesApi(), auth_data=auth_for(account))
        by_id = {w.id: w for w in listing.workspaces}
        assert by_id[target.id].current is True
        assert by_id[owner_tenant.id].current is False

    def test_switch_to_non_member_workspace_is_404(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        outsider_ws = make_account().current_tenant
        assert outsider_ws is not None

        api = WorkspaceSwitchApi()
        with app.test_request_context(f"/openapi/v1/workspaces/{outsider_ws.id}:switch", method="POST"):
            with pytest.raises(NotFound):
                unwrap(api.post)(api, workspace_id=outsider_ws.id, auth_data=auth_for(account))
