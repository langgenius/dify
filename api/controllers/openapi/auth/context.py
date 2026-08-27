"""The lazy per-request auth context.

Every fetching accessor is a `cached_property`, so first access resolves and
caches, later access is free, and nothing is fetched until something asks for it.
Accessors raise on failure instead of leaving an `Optional` for a caller to
misread as "not yet loaded".

Structurally satisfies `subjects.CallerContext`. Only imports from
`subjects`, never the reverse.
"""

from __future__ import annotations

import uuid
from functools import cached_property

from flask import request
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.subjects import Subject
from models.account import Account, AccountStatus, Tenant, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import App, EndUser
from services.account_service import TenantService
from services.app_service import AppService


class Context:
    def __init__(self, subject: Subject, session: Session, view_args: dict[str, str]) -> None:
        self.subject = subject
        self._session = session
        self._view_args = view_args

    @property
    def session(self) -> Session:
        return self._session

    @property
    def has_app(self) -> bool:
        return "app_id" in self._view_args

    @property
    def workspace_resolved(self) -> bool:
        return "workspace" in self.__dict__

    @cached_property
    def app(self) -> App:
        app_id = self._view_args["app_id"]
        try:
            uuid.UUID(app_id)
        except ValueError:
            raise NotFound("app not found")
        app = AppService.get_app_by_id(app_id, self._session)
        if not app or app.status != AppStatus.NORMAL:
            raise NotFound("app not found")
        return app

    @cached_property
    def workspace(self) -> Tenant:
        if self.has_app:
            return self._workspace_from_app()
        return self._workspace_from_request()

    def _workspace_from_app(self) -> Tenant:
        tenant = TenantService.get_tenant_by_id(str(self.app.tenant_id), session=self._session)
        if tenant is None or tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden("workspace unavailable")
        return tenant

    def _workspace_from_request(self) -> Tenant:
        workspace_id = self._view_args.get("workspace_id") or request.args.get("workspace_id")
        if not workspace_id:
            raise NotFound("workspace not found")
        try:
            uuid.UUID(workspace_id)
        except ValueError:
            raise NotFound("workspace not found")
        tenant = TenantService.get_tenant_by_id(workspace_id, session=self._session)
        if tenant is None or tenant.status == TenantStatus.ARCHIVE:
            raise NotFound("workspace not found")
        return tenant

    @cached_property
    def caller(self) -> Account | EndUser:
        return self.subject.resolve_caller(self, self._session)

    @cached_property
    def workspace_role(self) -> TenantAccountRole:
        """The caller's role in the resolved workspace.

        Non-membership answers 404, never 403, so workspace ids cannot be probed
        across tenants, and an account that is not `ACTIVE` is a non-member even
        when it still holds a role.

        `workspace` is read before `caller`: an account binds its current tenant
        only once the workspace has been resolved.

        Cached here rather than on the requirements that read it: a requirement is
        a process-lifetime singleton, so its cache would outlive the membership it
        recorded and two threads would race on it.
        """
        workspace = self.workspace
        caller = self.caller
        if not isinstance(caller, Account) or caller.status != AccountStatus.ACTIVE:
            raise NotFound("workspace not found")
        role = TenantService.get_account_role_in_tenant(
            str(self.subject.account_id), str(workspace.id), session=self._session
        )
        if role is None:
            raise NotFound("workspace not found")
        return role
