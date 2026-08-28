"""`SubjectType` in `libs/oauth_bearer` owns the mint-time facts (prefix, scopes);
a `Subject` owns the request-time behaviour, so `libs/` never has to import the
auth layer.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import ClassVar, Protocol, override

from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.data import CallerKind, ExternalIdentity
from libs.oauth_bearer import AuthContext, Scope, SubjectType
from models.account import Account, Tenant
from models.enums import EndUserType
from models.model import App, EndUser
from services.account_service import AccountService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import WebAppAccessMode


class CallerContext(Protocol):
    """Structural on purpose: the concrete `Context` holds a `Subject`, so a
    concrete import in either direction would be a cycle.
    """

    @property
    def has_app(self) -> bool: ...

    @property
    def workspace_loaded(self) -> bool: ...

    @property
    def app(self) -> App: ...

    @property
    def workspace(self) -> Tenant: ...


_SUBJECT_CLASSES: dict[SubjectType, type[Subject]] = {}


class Subject(ABC):
    subject_type: ClassVar[SubjectType]
    caller_kind: ClassVar[CallerKind]
    webapp_modes: ClassVar[frozenset[WebAppAccessMode]]

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        _SUBJECT_CLASSES[cls.subject_type] = cls

    def __init__(self, auth: AuthContext) -> None:
        self._auth = auth

    @property
    def auth(self) -> AuthContext:
        return self._auth

    @property
    def account_id(self) -> uuid.UUID | None:
        return self._auth.account_id

    @property
    def client_id(self) -> str | None:
        return self._auth.client_id

    @property
    def token_id(self) -> uuid.UUID:
        return self._auth.token_id

    @property
    def scopes(self) -> frozenset[Scope]:
        return self._auth.scopes

    @abstractmethod
    def resolve_caller(self, ctx: CallerContext, session: Session) -> Account | EndUser: ...

    @abstractmethod
    def mounts_caller(self, ctx: CallerContext) -> bool: ...

    @abstractmethod
    def webapp_user_id(self, session: Session) -> str | None: ...


class AccountSubject(Subject):
    subject_type = SubjectType.ACCOUNT
    caller_kind = CallerKind.ACCOUNT
    webapp_modes = frozenset(
        {
            WebAppAccessMode.PUBLIC,
            WebAppAccessMode.SSO_VERIFIED,
            WebAppAccessMode.PRIVATE_ALL,
            WebAppAccessMode.PRIVATE,
        }
    )

    @override
    def resolve_caller(self, ctx: CallerContext, session: Session) -> Account:
        account = AccountService.get_account_by_id(str(self.account_id), session=session)
        if account is None:
            raise Unauthorized("account not found")
        if ctx.has_app or ctx.workspace_loaded:
            account.set_current_tenant_with_session(ctx.workspace, session=session)
        return account

    @override
    def mounts_caller(self, ctx: CallerContext) -> bool:
        return True

    @override
    def webapp_user_id(self, session: Session) -> str | None:
        return str(self.account_id) if self.account_id is not None else None


class ExternalSsoSubject(Subject):
    subject_type = SubjectType.EXTERNAL_SSO
    caller_kind = CallerKind.END_USER
    webapp_modes = frozenset(
        {
            WebAppAccessMode.PUBLIC,
            WebAppAccessMode.SSO_VERIFIED,
        }
    )

    @property
    def external_identity(self) -> ExternalIdentity | None:
        if not self._auth.subject_email:
            return None
        return ExternalIdentity(email=self._auth.subject_email, issuer=self._auth.subject_issuer)

    @override
    def resolve_caller(self, ctx: CallerContext, session: Session) -> EndUser:
        identity = self.external_identity
        if identity is None:
            raise Unauthorized("missing context for external user resolution")
        return EndUserService.get_or_create_end_user_by_type(
            EndUserType.OPENAPI,
            tenant_id=str(ctx.workspace.id),
            app_id=str(ctx.app.id),
            user_id=identity.email,
        )

    @override
    def mounts_caller(self, ctx: CallerContext) -> bool:
        return ctx.has_app

    @override
    def webapp_user_id(self, session: Session) -> str | None:
        identity = self.external_identity
        if identity is None:
            return None
        account = AccountService.get_account_by_email(identity.email, session=session)
        return str(account.id) if account is not None else None


def subject_from_auth(auth: AuthContext) -> Subject:
    subject_class = _SUBJECT_CLASSES.get(auth.subject_type)
    if subject_class is None:
        raise Forbidden("unsupported_token_type")
    return subject_class(auth)
