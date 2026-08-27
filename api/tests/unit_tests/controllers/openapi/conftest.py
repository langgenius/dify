from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from controllers.openapi import bp as openapi_bp
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType


@pytest.fixture
def openapi_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture
def app():
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a


@dataclass(frozen=True, slots=True)
class AdmittedWorld:
    """The ids a request needs to address the world `admitted_bearer` built."""

    client: FlaskClient
    workspace_id: str
    app_id: str
    member_id: str
    headers: dict[str, str]


@pytest.fixture
def admitted_bearer(
    openapi_app: Flask,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> AdmittedWorld:
    """A caller every guarded route admits, so a request reaches `@accepts`.

    `@endpoint` stacks `@accepts` *inside* the guard, so a 422 is only observable
    on the wire once auth has passed. Everything here is world — one owner account
    in one workspace owning one API-enabled app — plus the two process seams the
    router already treats as pluggable: the bound authenticator, and the
    flask-login mount, which needs a real Flask login manager it has no reason to
    carry here.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, RBAC_ENABLED=False)

    account_id, workspace_id, app_id = (str(uuid.uuid4()) for _ in range(3))
    account = Account(name="caller", email="caller@example.com", status=AccountStatus.ACTIVE)
    account.id = account_id
    workspace = Tenant(name="caller workspace", status=TenantStatus.NORMAL)
    workspace.id = workspace_id
    sqlite_session.add_all(
        [
            account,
            workspace,
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=account_id,
                current=True,
                role=TenantAccountRole.OWNER,
            ),
            App(
                id=app_id,
                tenant_id=workspace_id,
                name="caller app",
                description="",
                mode=AppMode.WORKFLOW,
                icon_type=IconType.EMOJI,
                icon="robot",
                icon_background="#FFFFFF",
                status=AppStatus.NORMAL,
                enable_site=True,
                enable_api=True,
                max_active_requests=None,
            ),
        ]
    )
    sqlite_session.commit()

    token = AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email=account.email,
        subject_issuer="dify:account",
        account_id=uuid.UUID(account_id),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
    )
    monkeypatch.setattr(
        "controllers.openapi.auth.router.get_authenticator",
        lambda: SimpleNamespace(authenticate=lambda _token: token),
    )
    monkeypatch.setattr("controllers.openapi.auth.pipelines._mount_flask_login", lambda _user: None)

    return AdmittedWorld(
        client=openapi_app.test_client(),
        workspace_id=workspace_id,
        app_id=app_id,
        member_id=str(uuid.uuid4()),
        headers={"Authorization": "Bearer dfoa_admitted"},
    )
