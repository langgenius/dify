from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from app_factory import create_flask_app_with_configs
from constants.oauth_bearer import TokenType
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import CATALOG_HEADER, catalog_for
from core.logging.context import clear_request_context
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from services.tools.tool_sources import ToolSource, resolve_tool


@pytest.fixture(autouse=True)
def _clear_request_context() -> Iterator[None]:
    """A real request's before_request hook sets the logging request id; later tests expect none."""
    yield
    clear_request_context()


@pytest.fixture
def openapi_app() -> Flask:
    # the real factory: flask-restx wire behaviour (404 route suggestions) is app config
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture
def app() -> Flask:
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
        subject_email=account.email,
        subject_issuer="dify:account",
        account_id=uuid.UUID(account_id),
        client_id="difyctl",
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
        headers={"Authorization": "Bearer dfoa_admitted", CATALOG_HEADER: catalog_for(openapi_app)[1]},
    )


@pytest.fixture(autouse=True)
def _account_services(monkeypatch: pytest.MonkeyPatch, account_application_services: ApplicationServices) -> None:
    from controllers.openapi import workspaces
    from controllers.openapi.auth import loaders, requirements, subjects

    for module in (
        workspaces,
        loaders,
        requirements,
        subjects,
    ):
        monkeypatch.setattr(module, "application_services", lambda: account_application_services)


@pytest.fixture
def time_tool(admitted_bearer: AdmittedWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    tool = resolve_tool(tenant_id="tenant", provider_type="builtin", provider_id="time", tool_name="current_time")
    assert tool is not None
    provider = ToolProviderApiEntity(
        id="time",
        author="langgenius",
        name="time",
        description=I18nObject(en_US="time"),
        icon="",
        label=I18nObject(en_US="CurrentTime"),
        type=ToolProviderType.BUILT_IN,
        tools=[tool],
    )

    def list_providers(self: ToolSource, *, tenant_id: str, **_ids: str) -> list[ToolProviderApiEntity]:
        assert tenant_id == admitted_bearer.workspace_id
        return [provider] if self is ToolSource.BUILTIN else []

    monkeypatch.setattr(ToolSource, "list_providers", list_providers)
