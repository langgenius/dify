"""Unit tests for persisted credential permission policy.

Tests visibility filtering and complete domain reads against real SQLite rows.
"""

from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType as TriggerCredentialType
from models.account import Account, TenantAccountRole
from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from models.oauth import DatasourceProvider
from models.provider import ProviderCredential
from models.tools import BuiltinToolProvider
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from repositories.credentials.query_repository import (
    CredentialQueryRepository,
    apply_credential_visibility_filter_for_actor,
)


@pytest.fixture
def tenant_id() -> str:
    return str(uuid4())


@pytest.fixture
def user_id() -> str:
    return str(uuid4())


@pytest.fixture
def other_user_id() -> str:
    return str(uuid4())


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> CredentialQueryRepository:
    return CredentialQueryRepository(session_factory=sqlite_session_factory)


@pytest.mark.parametrize("provider", ["openai", "langgenius/openai/openai"])
def test_model_aliases_preserve_visibility_and_tenant_scope(
    sqlite_session: Session, repository: CredentialQueryRepository, provider: str
) -> None:
    tenant, actor, teammate = (str(uuid4()) for _ in range(3))
    rows = [
        ProviderCredential(
            tenant_id=tenant,
            provider_name="openai" if index % 2 else "langgenius/openai/openai",
            credential_name=name,
            encrypted_config="encrypted",
            user_id=owner,
            visibility=visibility,
        )
        for index, (name, owner, visibility) in enumerate(
            [
                ("team", teammate, PermissionEnum.ALL_TEAM),
                ("mine", actor, PermissionEnum.ONLY_ME),
                ("legacy", None, PermissionEnum.ONLY_ME),
                ("shared", teammate, PermissionEnum.PARTIAL_TEAM),
                ("disabled", teammate, PermissionEnum.PARTIAL_TEAM),
                ("wrong-tenant-grant", teammate, PermissionEnum.PARTIAL_TEAM),
                ("wrong-type-grant", teammate, PermissionEnum.PARTIAL_TEAM),
                ("private", teammate, PermissionEnum.ONLY_ME),
            ]
        )
    ]
    for index, row in enumerate(rows):
        row.created_at = datetime(2026, 1, index + 1)
    sqlite_session.add_all(rows)
    sqlite_session.add_all(
        [
            CredentialPermission(
                credential_id=rows[index].id,
                credential_type=CredentialType.BUILTIN_TOOL_PROVIDER
                if index == 6
                else CredentialType.PROVIDER_CREDENTIAL,
                account_id=actor,
                tenant_id=str(uuid4()) if index == 5 else tenant,
                has_permission=index != 4,
            )
            for index in (3, 4, 5, 6)
        ]
    )
    sqlite_session.add_all(
        [
            ProviderCredential(
                tenant_id=str(uuid4()), provider_name="openai", credential_name="foreign", encrypted_config="secret"
            ),
            ProviderCredential(
                tenant_id=tenant,
                provider_name="anthropic",
                credential_name="different-provider",
                encrypted_config="secret",
            ),
        ]
    )
    sqlite_session.commit()

    records = repository.list_models(workspace_id=tenant, provider=provider, actor_id=actor)

    assert [record.name for record in records] == ["shared", "legacy", "mine", "team"]
    internal = repository.list_models(workspace_id=tenant, provider=provider, actor_id=None)
    assert {record.id for record in internal} == {row.id for row in rows}


def test_datasource_hidden_default_and_complete_owner_scope(
    sqlite_session: Session, repository: CredentialQueryRepository
) -> None:
    tenant, actor, teammate = (str(uuid4()) for _ in range(3))
    visible = DatasourceProvider(
        tenant_id=tenant,
        name="visible",
        provider="notion",
        plugin_id="plugin",
        auth_type="oauth2",
        encrypted_credentials={"access_token": "encrypted"},
        user_id=actor,
        visibility=PermissionEnum.ONLY_ME,
    )
    hidden_default = DatasourceProvider(
        tenant_id=tenant,
        name="hidden",
        provider="notion",
        plugin_id="plugin",
        auth_type="oauth2",
        encrypted_credentials={},
        user_id=teammate,
        visibility=PermissionEnum.ONLY_ME,
        is_default=True,
    )
    sqlite_session.add_all([visible, hidden_default])
    for owner, provider, plugin in [
        (str(uuid4()), "notion", "plugin"),
        (tenant, "other", "plugin"),
        (tenant, "notion", "other"),
    ]:
        sqlite_session.add(
            DatasourceProvider(
                tenant_id=owner,
                name="unrelated",
                provider=provider,
                plugin_id=plugin,
                auth_type="oauth2",
                encrypted_credentials={},
                is_default=True,
            )
        )
    sqlite_session.commit()

    records = repository.list_datasources(workspace_id=tenant, provider="notion", plugin_id="plugin", actor_id=actor)

    assert len(records) == 1
    assert records[0].id == visible.id
    assert records[0].encrypted_credentials == {"access_token": "encrypted"}
    assert records[0].is_default is False
    internal = repository.list_datasources(workspace_id=tenant, provider="notion", plugin_id="plugin", actor_id=None)
    assert {record.id for record in internal if record.is_default} == {hidden_default.id}


def test_tool_borrowing_members_and_default_do_not_escape_scope_or_write_state(
    sqlite_session: Session, repository: CredentialQueryRepository
) -> None:
    tenant, actor, teammate = (str(uuid4()) for _ in range(3))
    visible = BuiltinToolProvider(
        name="visible",
        tenant_id=tenant,
        user_id=actor,
        provider="tool",
        visibility=PermissionEnum.PARTIAL_TEAM,
        encrypted_credentials='{"api_key": "encrypted"}',
    )
    borrowed = BuiltinToolProvider(
        name="borrowed",
        tenant_id=tenant,
        user_id=teammate,
        provider="tool",
        visibility=PermissionEnum.ONLY_ME,
        is_default=True,
    )
    foreign = BuiltinToolProvider(name="foreign", tenant_id=str(uuid4()), user_id=teammate, provider="tool")
    other_provider = BuiltinToolProvider(name="other", tenant_id=tenant, user_id=teammate, provider="other")
    sqlite_session.add_all([visible, borrowed, foreign, other_provider])
    sqlite_session.add_all(
        [
            CredentialPermission(
                credential_id=visible.id,
                credential_type=kind,
                account_id=member,
                tenant_id=owner,
                has_permission=enabled,
            )
            for member, owner, kind, enabled in [
                (teammate, tenant, CredentialType.BUILTIN_TOOL_PROVIDER, True),
                (str(uuid4()), tenant, CredentialType.BUILTIN_TOOL_PROVIDER, False),
                (str(uuid4()), str(uuid4()), CredentialType.BUILTIN_TOOL_PROVIDER, True),
                (str(uuid4()), tenant, CredentialType.PROVIDER_CREDENTIAL, True),
            ]
        ]
    )
    sqlite_session.commit()

    records = repository.list_tools(
        workspace_id=tenant,
        provider="tool",
        actor_id=actor,
        include_credential_ids=[visible.id, borrowed.id, borrowed.id, foreign.id, other_provider.id, ""],
    )

    assert [record.id for record in records] == [visible.id, borrowed.id]
    assert records[0].partial_member_ids == (teammate,)
    assert records[0].credentials == {"api_key": "encrypted"}
    assert records[0].is_default is True
    assert records[0].from_other_member is False
    assert records[1].from_other_member is True
    sqlite_session.refresh(visible)
    assert visible.is_default is False


def test_trigger_visibility_and_usage_counts_are_tenant_scoped(
    sqlite_session: Session, repository: CredentialQueryRepository
) -> None:
    tenant, actor, teammate, app_id = (str(uuid4()) for _ in range(4))
    rows = [
        TriggerSubscription(
            name=name,
            tenant_id=owner,
            user_id=teammate,
            provider_id=provider,
            endpoint_id=f"{name}-endpoint",
            parameters={"event": "created"},
            properties={"label": name},
            credentials={"api_key": "encrypted"},
            credential_type=TriggerCredentialType.API_KEY,
            visibility=visibility,
        )
        for name, owner, provider, visibility in [
            ("shared", tenant, "trigger", PermissionEnum.PARTIAL_TEAM),
            ("private", tenant, "trigger", PermissionEnum.ONLY_ME),
            ("foreign", str(uuid4()), "trigger", PermissionEnum.ALL_TEAM),
            ("other-provider", tenant, "other", PermissionEnum.ALL_TEAM),
        ]
    ]
    sqlite_session.add_all(rows)
    sqlite_session.add(
        CredentialPermission(
            credential_id=rows[0].id,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            tenant_id=tenant,
            account_id=actor,
        )
    )
    sqlite_session.add_all(
        [
            WorkflowPluginTrigger(
                app_id=app,
                node_id=node,
                tenant_id=owner,
                provider_id="trigger",
                event_name="created",
                subscription_id=rows[0].id,
            )
            for owner, app, node in [
                (tenant, app_id, "node-1"),
                (tenant, app_id, "node-2"),
                (tenant, str(uuid4()), "node-3"),
                (str(uuid4()), str(uuid4()), "foreign-node"),
            ]
        ]
    )
    sqlite_session.commit()

    records = repository.list_trigger_subscriptions(workspace_id=tenant, provider="trigger", actor_id=actor)

    assert len(records) == 1
    assert records[0].id == rows[0].id
    assert records[0].workflows_in_use == 2
    assert records[0].parameters == {"event": "created"}
    assert records[0].endpoint_id == "shared-endpoint"
    assert records[0].credentials == {"api_key": "encrypted"}


def test_empty_lists_do_not_require_related_rows(repository: CredentialQueryRepository) -> None:
    assert repository.list_models(workspace_id="empty", provider="openai", actor_id="actor") == []
    assert (
        repository.list_datasources(workspace_id="empty", provider="notion", plugin_id="plugin", actor_id="actor") == []
    )
    assert repository.list_tools(workspace_id="empty", provider="tool", actor_id="actor") == []
    assert repository.list_trigger_subscriptions(workspace_id="empty", provider="trigger", actor_id="actor") == []


def _subscription(
    *,
    tenant_id: str,
    owner_id: str,
    name: str,
    visibility: PermissionEnum,
) -> TriggerSubscription:
    return TriggerSubscription(
        name=name,
        tenant_id=tenant_id,
        user_id=owner_id,
        provider_id="test/provider",
        endpoint_id=f"{name}-endpoint",
        parameters={},
        properties={},
        credentials={},
        credential_type=TriggerCredentialType.API_KEY,
        visibility=visibility,
    )


def _user(user_id: str, *, is_admin: bool) -> Account:
    user = Account(name="Credential User", email=f"{user_id}@example.com")
    user.id = user_id
    user.role = TenantAccountRole.ADMIN if is_admin else TenantAccountRole.NORMAL
    return user


class TestApplyVisibilityFilter:
    def test_admin_does_not_bypass_personal_visibility(
        self,
        sqlite_session: Session,
        tenant_id: str,
        user_id: str,
        other_user_id: str,
    ) -> None:
        private_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="private",
            visibility=PermissionEnum.ONLY_ME,
        )
        sqlite_session.add(private_subscription)
        sqlite_session.commit()

        query = apply_credential_visibility_filter_for_actor(
            select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id),
            tenant_id=tenant_id,
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            actor_id=_user(user_id, is_admin=True).id,
        )

        assert sqlite_session.scalars(query).all() == []

    def test_non_admin_sees_team_owned_and_partial_member_subscriptions(
        self,
        sqlite_session: Session,
        tenant_id: str,
        user_id: str,
        other_user_id: str,
    ) -> None:
        team_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="team",
            visibility=PermissionEnum.ALL_TEAM,
        )
        owned_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=user_id,
            name="owned",
            visibility=PermissionEnum.ONLY_ME,
        )
        shared_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="shared",
            visibility=PermissionEnum.PARTIAL_TEAM,
        )
        private_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="private",
            visibility=PermissionEnum.ONLY_ME,
        )
        sqlite_session.add_all(
            [
                team_subscription,
                owned_subscription,
                shared_subscription,
                private_subscription,
                CredentialPermission(
                    credential_id=shared_subscription.id,
                    credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                    account_id=user_id,
                    tenant_id=tenant_id,
                ),
            ]
        )
        sqlite_session.commit()

        query = apply_credential_visibility_filter_for_actor(
            select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id),
            tenant_id=tenant_id,
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            actor_id=_user(user_id, is_admin=False).id,
        )

        visible_ids = {subscription.id for subscription in sqlite_session.scalars(query)}
        assert visible_ids == {team_subscription.id, owned_subscription.id, shared_subscription.id}

    def test_partial_permissions_are_scoped_by_tenant(
        self,
        sqlite_session: Session,
        tenant_id: str,
        user_id: str,
        other_user_id: str,
    ) -> None:
        other_tenant_id = str(uuid4())
        shared_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="shared",
            visibility=PermissionEnum.PARTIAL_TEAM,
        )
        sqlite_session.add(shared_subscription)
        sqlite_session.flush()
        sqlite_session.add(
            CredentialPermission(
                credential_id=shared_subscription.id,
                credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                account_id=user_id,
                tenant_id=other_tenant_id,
            )
        )
        sqlite_session.commit()

        query = apply_credential_visibility_filter_for_actor(
            select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id),
            tenant_id=tenant_id,
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            actor_id=_user(user_id, is_admin=False).id,
        )

        assert sqlite_session.scalars(query).all() == []
