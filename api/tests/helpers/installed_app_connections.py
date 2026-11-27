"""Real persistence fixtures shared by member-configuration repository tests."""

import json
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from context.connection_execution import (
    ConnectionExecutionContext,
    ExecutionConnectionSelection,
    WorkspaceConnectionScope,
)
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, ConversationStatus, InvokeFrom
from models.model import App, AppMode, Conversation, InstalledApp
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowType
from services.installed_app_connections import InstalledConnectionConfiguration
from tests.helpers.workflow_test_credentials import tool_node


@dataclass(frozen=True)
class InstalledConnectionData:
    tenant: Tenant
    account: Account
    other: Account
    app: App
    workflow: Workflow
    installation: InstalledApp
    credential: BuiltinToolProvider
    revision: str

    @property
    def scope(self) -> WorkspaceConnectionScope:
        return WorkspaceConnectionScope(
            tenant_id=self.tenant.id, installed_app_id=self.installation.id, account_id=self.account.id
        )

    @property
    def configuration(self) -> InstalledConnectionConfiguration:
        return InstalledConnectionConfiguration(self.revision, {"root": self.credential.id})

    @property
    def execution(self) -> ConnectionExecutionContext:
        return ConnectionExecutionContext(
            tenant_id=self.tenant.id,
            app_id=self.app.id,
            end_user_id="",
            account_id=self.account.id,
            workspace=self.scope,
            workflow_id=self.workflow.id,
            connection_revision=self.revision,
            selections=(
                ExecutionConnectionSelection(
                    node_id="root", provider=self.credential.provider, connection_id=self.credential.id
                ),
            ),
        )


def seed_installed_connections(
    sessions: sessionmaker[Session], *, tenant: Tenant | None = None, account: Account | None = None
) -> InstalledConnectionData:
    """Commit a published installation and team credential using a real database.

    None creates a tenant/account; supplying them seeds another app in the same
    scope. Return detached rows usable with expire_on_commit=False sessions.
    """
    tenant = tenant if tenant is not None else Tenant(name="Workspace")
    account = account if account is not None else Account(name="Member", email=f"{uuid4()}@example.com")
    other = Account(name="Other member", email=f"{uuid4()}@example.com")
    app = App(tenant_id=tenant.id, name="App", mode=AppMode.ADVANCED_CHAT, enable_site=True, enable_api=True)
    workflow = Workflow(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.CHAT,
        version="published",
        graph=json.dumps({"nodes": [tool_node("root", None)], "edges": []}),
        _features="{}",
        created_by=account.id,
    )
    app.workflow_id = workflow.id
    installation = InstalledApp(tenant_id=tenant.id, app_id=app.id, app_owner_tenant_id=tenant.id)
    credential = BuiltinToolProvider(
        tenant_id=tenant.id,
        user_id=account.id,
        provider="vendor/calendar/calendar",
        name="Team OAuth",
        credential_type=CredentialType.OAUTH2,
        encrypted_credentials='{"token":"encrypted"}',
    )
    with sessions.begin() as session:
        session.merge(tenant)
        session.merge(account)
        session.add_all([other, app, workflow, installation, credential])
        membership = session.scalar(
            select(TenantAccountJoin.id).where(
                TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == account.id
            )
        )
        if membership is None:
            session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL))
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=other.id, role=TenantAccountRole.NORMAL))
    return InstalledConnectionData(tenant, account, other, app, workflow, installation, credential, str(uuid4()))


def member_conversation(data: InstalledConnectionData) -> Conversation:
    """Construct an unsaved, member-owned Explore conversation for the fixture app."""
    return Conversation(
        app_id=data.app.id,
        mode=AppMode.ADVANCED_CHAT,
        from_account_id=data.account.id,
        from_source=ConversationFromSource.CONSOLE,
        invoke_from=InvokeFrom.EXPLORE,
        name="Conversation",
        _inputs={},
        status=ConversationStatus.NORMAL,
    )
