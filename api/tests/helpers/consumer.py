"""Real Account consumer services with deterministic plugin and access boundaries."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.passport import PassportService
from models.end_user_connection import EndUserConnection
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun, WorkflowType
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.console_repository import ConsoleAppRepository
from services.consumer_adapters import PluginConsumerConnectionProviders
from services.consumer_service import ConsumerIdentity, ConsumerService
from services.end_user_connections.contracts import ConnectionSummary
from services.web_identity_service import WebIdentityService
from services.web_passport_gateways import PassportTokenGateway
from tests.helpers.end_user_api_key import ConnectionHarness
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness
from tests.helpers.unit.config_override import apply_config_overrides


def consumer_connection_key(connection: EndUserConnection | ConnectionSummary) -> UUID:
    return UUID(connection.id)


def new_consumer_run(base: ConnectionHarness, *, created_at: datetime) -> WorkflowRun:
    run = WorkflowRun(
        tenant_id=base.context.tenant_id,
        app_id=base.context.app_id,
        workflow_id=base.workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="published",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.END_USER,
        created_by=base.context.end_user_id,
    )
    run.created_at = created_at
    return run


@dataclass
class ConsumerAccess:
    denied: set[str] = field(default_factory=set)

    def get_visible_app_ids(self, *, user_id: str, app_ids: Sequence[str]) -> frozenset[str]:
        return frozenset(app_id for app_id in app_ids if app_id not in self.denied)


@dataclass
class ConsumerHarness:
    oauth: OAuthHarness
    apps: ConsoleAppRepository
    access: ConsumerAccess
    service: ConsumerService
    identity: ConsumerIdentity

    def record_usage(self, used_at: datetime) -> None:
        base = self.oauth.base
        self.service.record_usage(
            self.identity,
            tenant_id=base.context.tenant_id,
            app_id=base.context.app_id,
            end_user_id=base.context.end_user_id,
            used_at=used_at,
        )

    def token(self, *, source: str | None = "webapp_account_login", subject: str = "Web API Account Login") -> str:
        return PassportService().issue(
            {
                "sub": subject,
                "user_id": self.identity.account_id,
                "auth_type": "internal",
                "token_source": source,
                "exp": datetime.now(UTC) + timedelta(minutes=10),
            }
        )


def make_consumer_harness(sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConsumerHarness:
    apply_config_overrides(
        monkeypatch,
        SECRET_KEY="consumer-test-key-with-at-least-32-bytes",
        CONSOLE_API_URL="http://localhost",
        CONSOLE_WEB_URL="http://localhost",
    )
    oauth = make_oauth_harness(sessions, monkeypatch)
    assert oauth.base.context.account_id is not None
    apps = ConsoleAppRepository(session_factory=sessions)
    access = ConsumerAccess()
    return ConsumerHarness(
        oauth,
        apps,
        access,
        ConsumerService(
            apps=apps,
            connections=oauth.base.repository,
            providers=PluginConsumerConnectionProviders(providers=oauth.providers),
            access=access,
            shared_apps=lambda: (oauth.base.context.app_id,),
            management=oauth.base.service,
            identities=WebIdentityService(
                accounts=SQLAlchemyAccountRepository(session_factory=sessions),
                allow_console_login=True,
                allow_webapp_login=False,
            ),
            tokens=PassportTokenGateway(passport=PassportService()),
        ),
        ConsumerIdentity(oauth.base.context.account_id),
    )
