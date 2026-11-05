"""Member-scoped selection, published requirements, and secret-free execution contracts."""

import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import create_autospec
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from context.connection_execution import ConnectionExecutionContext, WorkspaceConnectionScope
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.enums import ConversationFromSource, ConversationStatus, InvokeFrom, PermissionEnum
from models.installed_app_connection import InstalledAppConnectionConfiguration
from models.model import App, AppMode, Conversation, InstalledApp
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionRequiredError,
    ConnectionRevisionChangedError,
)
from services.end_user_connections.selections import SaveConnectionConfigurationInput
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_access_service import InstalledAppAccessService
from services.installed_app_connections import InstalledAppConnectionService, InstalledConnectionConfiguration
from services.workflow_test_credentials import ResolvedTestCredential
from services.workflow_test_credentials import TestCredentialCheck as CredentialCheck
from services.workflow_test_credentials import TestCredentialUnavailableError as Unavailable
from tests.helpers.workflow_test_credentials import tool_node


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]):
    account = Account(name="Member", email="member@example.com")
    other = Account(name="Other", email="other@example.com")
    tenant = Tenant(name="Workspace")
    foreign = Tenant(name="Other workspace")
    app = App(tenant_id=tenant.id, name="App", mode=AppMode.ADVANCED_CHAT, enable_site=True, enable_api=True)
    graph = {
        "nodes": [
            tool_node("root", str(uuid4())),
            tool_node(
                "reuse",
                None,
                credential_source="reuse_node",
                reuse_node_id="root",
                end_user_auth=None,
            ),
        ],
        "edges": [],
    }
    workflow = Workflow(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.CHAT,
        version="published",
        graph=json.dumps(graph),
        features="{}",
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
    hidden = BuiltinToolProvider(
        tenant_id=tenant.id,
        user_id=other.id,
        provider=credential.provider,
        name="Private OAuth",
        credential_type=CredentialType.OAUTH2,
        visibility=PermissionEnum.ONLY_ME,
    )
    elsewhere = BuiltinToolProvider(
        tenant_id=foreign.id,
        user_id=account.id,
        provider=credential.provider,
        name="Foreign OAuth",
        credential_type=CredentialType.OAUTH2,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                other,
                tenant,
                foreign,
                app,
                workflow,
                installation,
                credential,
                hidden,
                elsewhere,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL),
                TenantAccountJoin(tenant_id=tenant.id, account_id=other.id, role=TenantAccountRole.NORMAL),
            ]
        )
    scope = WorkspaceConnectionScope(installed_app_id=installation.id, tenant_id=tenant.id, account_id=account.id)
    store = SQLAlchemyInstalledConnectionRepository(session_factory=sqlite_session_factory)
    access = InstalledAppAccessService(
        installed_apps=SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory),
        is_user_allowed=lambda **_: True,
        get_access_modes=lambda **_: {},
        get_user_permissions=lambda **_: {},
    )
    definitions = create_autospec(AppDefinitionQueryService, instance=True)
    revision = str(uuid4())
    definitions.get_web_parameters.return_value = {"connection_revision": revision}
    gateway = SimpleNamespace(
        resolve=lambda *_: ResolvedTestCredential(
            credential.id,
            "oauth2",
            {"token": "runtime-secret"},
            CredentialCheck(status="valid", reason_code=None, retryable=False),
        )
    )
    service = InstalledAppConnectionService(
        store=store,
        access=access,
        definitions=definitions,
        credentials=gateway,
    )
    return SimpleNamespace(
        service=service,
        store=store,
        scope=scope,
        app=app,
        workflow=workflow,
        account=account,
        other=other,
        credential=credential,
        hidden=hidden,
        elsewhere=elsewhere,
        graph=graph,
        revision=revision,
        sessions=sqlite_session_factory,
        definitions=definitions,
        gateway=gateway,
    )


def command(harness, selections=None, conversation_id=None):
    return SaveConnectionConfigurationInput(
        connection_revision=harness.revision,
        connections={"root": harness.credential.id} if selections is None else selections,
        conversation_id=conversation_id,
    )


def conversation(harness, *, account_id=None):
    row = Conversation(
        app_id=harness.app.id,
        mode=AppMode.ADVANCED_CHAT,
        from_account_id=account_id or harness.account.id,
        from_source=ConversationFromSource.CONSOLE,
        invoke_from=InvokeFrom.EXPLORE,
        name="Conversation",
        _inputs={},
        status=ConversationStatus.NORMAL,
    )
    with harness.sessions.begin() as session:
        session.add(row)
    return row


def test_lists_only_visible_workspace_credentials_without_secrets(harness):
    page = harness.service.list_connections(harness.scope, provider=None, cursor=None, limit=1)
    assert [item.id for item in page.data] == [harness.credential.id]
    assert not page.has_more
    assert "encrypted" not in page.model_dump_json()
    assert "token" not in page.model_dump_json()
    assert page.data[0].last_active_at is None


@pytest.mark.parametrize("selection", ["hidden", "elsewhere", "missing"])
def test_saving_foreign_or_invisible_credentials_is_rejected(harness, selection):
    identifier = str(uuid4()) if selection == "missing" else getattr(harness, selection).id
    with pytest.raises(ConnectionNotFoundError):
        harness.service.save_configuration(harness.scope, command(harness, {"root": identifier}))


def test_configuration_is_per_member_and_explicit_empty_clears_it(harness):
    assert harness.service.configuration(harness.scope, None).reauthorization_required
    result = harness.service.save_configuration(harness.scope, command(harness))
    assert result.connections["root"].id == harness.credential.id
    assert not result.reauthorization_required
    other_scope = harness.scope.model_copy(update={"account_id": harness.other.id})
    assert harness.service.configuration(other_scope, None).connections == {}
    harness.service.save_configuration(harness.scope, command(harness, {}))
    assert harness.service.configuration(harness.scope, None).connections == {}


def test_preflight_and_run_never_use_test_credentials_or_workspace_defaults(harness):
    result = harness.service.preflight(harness.scope, command(harness, {}))
    assert not result.ready
    assert result.connections[0].status == "disconnected"
    with pytest.raises(ConnectionRequiredError):
        harness.service.prepare(
            harness.scope,
            workflow_id=harness.workflow.id,
            args={"connection_revision": harness.revision, "connections": {}},
        )
    harness.service.save_configuration(harness.scope, command(harness))
    with pytest.raises(ConnectionRequiredError):
        harness.service.prepare(
            harness.scope, workflow_id=harness.workflow.id, args={"connection_revision": harness.revision}
        )


@pytest.mark.parametrize(
    ("status", "reason", "expected"),
    [
        ("valid", None, "connected"),
        ("unsupported", None, "connected"),
        ("invalid", "credential_invalid", "invalid"),
        ("invalid", "credential_revoked", "reconnect_required"),
        ("temporarily_unavailable", "provider_timeout", None),
    ],
)
def test_preflight_uses_webapp_status_vocabulary(harness, status, reason, expected):
    harness.gateway.resolve = lambda *_: ResolvedTestCredential(
        harness.credential.id,
        "oauth2",
        {"token": "secret"},
        CredentialCheck(status=status, reason_code=reason, retryable=False),
    )
    result = harness.service.preflight(harness.scope, command(harness))
    assert result.connections[0].status == expected
    assert result.ready == (expected == "connected")
    assert "secret" not in result.model_dump_json()


@pytest.mark.parametrize("status", ["disconnected", "incompatible", "temporarily_unavailable"])
def test_preflight_preserves_gateway_failures(harness, status):
    def fail(*_):
        raise Unavailable(status)

    harness.gateway.resolve = fail
    result = harness.service.preflight(harness.scope, command(harness))
    assert not result.ready
    assert result.connections[0].status == {"incompatible": "invalid", "temporarily_unavailable": None}.get(
        status, status
    )


def test_revision_changes_require_confirmation_and_unknown_nodes_fail(harness):
    with pytest.raises(ConnectionRevisionChangedError):
        harness.service.preflight(
            harness.scope, command(harness).model_copy(update={"connection_revision": str(uuid4())})
        )
    with pytest.raises(ConnectionConfigurationError):
        harness.service.preflight(harness.scope, command(harness, {"reuse": harness.credential.id}))


def test_execution_context_roundtrip_and_conversation_choices(harness):
    execution = harness.service.prepare(
        harness.scope,
        workflow_id=harness.workflow.id,
        args={"connection_revision": harness.revision, "connections": {"root": harness.credential.id}},
    )
    assert execution.workspace == harness.scope
    assert execution.end_user_id == ""
    serialized = execution.model_dump_json()
    assert "runtime-secret" not in serialized
    assert ConnectionExecutionContext.model_validate_json(serialized) == execution
    row = conversation(harness)
    with harness.sessions.begin() as session:
        SQLAlchemyInstalledConnectionRepository.initialize_conversation(
            session, execution, session.get(Conversation, row.id)
        )
    restored = harness.service.prepare(
        harness.scope,
        workflow_id=harness.workflow.id,
        args={"conversation_id": row.id, "connection_revision": harness.revision},
    )
    assert restored.selections == execution.selections
    with pytest.raises(ConnectionRequiredError):
        harness.service.prepare(
            harness.scope,
            workflow_id=harness.workflow.id,
            args={"conversation_id": row.id, "connection_revision": harness.revision, "connections": None},
        )
    resolved = harness.service.resolve(restored, account_id=harness.account.id, node_id="reuse", graph=harness.graph)
    assert resolved.credential_id == harness.credential.id


def test_conversation_owner_cannot_be_spoofed_and_empty_does_not_inherit_defaults(harness):
    row = conversation(harness, account_id=harness.other.id)
    with pytest.raises(ConversationNotExistsError):
        harness.service.configuration(harness.scope, row.id)
    harness.service.save_configuration(harness.scope, command(harness))
    own = conversation(harness)
    assert harness.service.configuration(harness.scope, own.id).connections == {}


@pytest.mark.parametrize("change", ["member", "account", "app", "installation", "publication", "workspace"])
def test_entry_and_worker_revalidate_owner_chain(harness, change):
    execution = harness.service.prepare(
        harness.scope,
        workflow_id=harness.workflow.id,
        args={"connection_revision": harness.revision, "connections": {"root": harness.credential.id}},
    )
    with harness.sessions.begin() as session:
        if change == "member":
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        elif change == "account":
            session.execute(update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.BANNED))
        elif change == "app":
            session.execute(update(App).where(App.id == harness.app.id).values(tenant_id=str(uuid4())))
        elif change == "installation":
            session.execute(delete(InstalledApp).where(InstalledApp.id == harness.scope.installed_app_id))
        elif change == "publication":
            session.execute(update(Workflow).where(Workflow.id == harness.workflow.id).values(version="draft"))
        else:
            session.execute(
                update(Tenant).where(Tenant.id == harness.scope.tenant_id).values(status=TenantStatus.ARCHIVE)
            )
    with pytest.raises((ConnectionIdentityError, ConnectionConfigurationError, LookupError)):
        harness.service.resolve(execution, account_id=harness.account.id, node_id="root", graph=harness.graph)


def test_scope_and_credential_permissions_are_rechecked_after_external_io(harness):
    def revoke(*_):
        with harness.sessions.begin() as session:
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id))
        return ResolvedTestCredential(
            harness.credential.id, "oauth2", {}, CredentialCheck(status="valid", reason_code=None, retryable=False)
        )

    harness.gateway.resolve = revoke
    with pytest.raises(ConnectionIdentityError):
        harness.service.preflight(harness.scope, command(harness))


def test_saved_credentials_are_revalidated_and_revision_is_not_readiness(harness):
    harness.service.save_configuration(harness.scope, command(harness))
    with harness.sessions.begin() as session:
        session.execute(
            update(BuiltinToolProvider)
            .where(BuiltinToolProvider.id == harness.credential.id)
            .values(user_id=harness.other.id, visibility=PermissionEnum.ONLY_ME)
        )
    result = harness.service.configuration(harness.scope, None)
    assert result.connections == {"root": None}
    assert not result.reauthorization_required
    with harness.sessions() as session:
        stored = session.scalar(select(InstalledAppConnectionConfiguration))
        assert "token" not in stored.connections


def test_store_save_rejects_cross_provider_and_stale_graph(harness):
    graph = harness.store.graph(harness.scope)
    with harness.sessions.begin() as session:
        session.execute(
            update(BuiltinToolProvider)
            .where(BuiltinToolProvider.id == harness.credential.id)
            .values(provider="vendor/other/other")
        )
    with pytest.raises(ConnectionConfigurationError):
        harness.store.save(
            harness.scope,
            graph,
            InstalledConnectionConfiguration(harness.revision, {"root": harness.credential.id}),
            None,
        )
    with pytest.raises(ConnectionRevisionChangedError):
        harness.store.save(
            harness.scope,
            replace(graph, workflow_id=str(uuid4())),
            InstalledConnectionConfiguration(harness.revision, {}),
            None,
        )


def test_worker_rejects_installed_end_user_run_without_execution_context(harness):
    from unittest.mock import Mock

    from core.app.entities.app_invoke_entities import InvokeFrom
    from tasks.app_generate.workflow_execute_task import AppExecutionParams, _AppRunner

    payload = AppExecutionParams.new(
        app_model=harness.app,
        workflow=harness.workflow,
        user=harness.account,
        args={"inputs": {}},
        invoke_from=InvokeFrom.EXPLORE,
    )
    runner = _AppRunner(harness.sessions, payload)
    with harness.sessions() as session, pytest.raises(ConnectionRequiredError):
        runner._run_app(
            app=harness.app, workflow=harness.workflow, user=harness.account, pause_state_config=Mock(), session=session
        )


def test_missing_connection_payload_is_configuration_error_not_login_failure(harness):
    from services.end_user_connection_execution_adapters import prepare_installed_connection_execution

    with pytest.raises(ConnectionConfigurationError):
        prepare_installed_connection_execution(
            app=harness.app, user=harness.account, workflow=harness.workflow, args={"inputs": {}}
        )
