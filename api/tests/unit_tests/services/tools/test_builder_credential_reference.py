"""Exact metadata-only Builder credential selection on real SQLite sessions.

No credential is decrypted, validated, refreshed or invoked: every such owner
is replaced by a spy raising ``AssertionError``. PostgreSQL locking is CI-owned.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import cast
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from core.dify_builder.models import Actor
from core.dify_builder.real_call_consent import CredentialReference
from core.plugin.entities.plugin_daemon import CredentialType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import Base, TypeBase
from models.credential_permission import CredentialPermission
from models.credential_permission import CredentialType as CredentialPermissionType
from models.enums import PermissionEnum
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from services.tools.builder_credential_reference import (
    OAuthClientSource,
    credential_revision,
    oauth_client_revision,
    select_builder_credential,
)
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

PROVIDER = "langgenius/dify-gmail/dify-gmail"
PLUGIN = "langgenius/dify-gmail"
KEY = b"unit-key"
CREDENTIAL_CIPHERTEXT = '{"access_token":"encrypted-access","refresh_token":"encrypted-refresh"}'
TENANT_CLIENT_CIPHERTEXT = '{"client_id":"encrypted-tenant-id","client_secret":"encrypted-tenant-secret"}'
SYSTEM_CLIENT_CIPHERTEXT = "encrypted-system-client-params"


def test_rotation_at_same_timestamp_changes_revision() -> None:
    row = BuiltinToolProvider(
        name="Canary",
        tenant_id="tenant",
        user_id="owner",
        provider="langgenius/dify-gmail/dify-gmail",
        credential_type=CredentialType.OAUTH2,
    )
    row.encrypted_credentials = '{"access_token":"encrypted-one"}'
    before = credential_revision(row, key=b"unit-key")
    row.encrypted_credentials = '{"access_token":"encrypted-two"}'
    assert credential_revision(row, key=b"unit-key") != before


def _row(*, tenant_id: str = "tenant", user_id: str = "owner", name: str = "Team mailbox") -> BuiltinToolProvider:
    return BuiltinToolProvider(
        name=name,
        tenant_id=tenant_id,
        user_id=user_id,
        provider=PROVIDER,
        credential_type=CredentialType.OAUTH2,
        encrypted_credentials=CREDENTIAL_CIPHERTEXT,
        expires_at=1_900_000_000,
        visibility=PermissionEnum.ALL_TEAM,
        is_default=False,
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "Renamed mailbox"),
        ("credential_type", CredentialType.API_KEY),
        ("expires_at", 1_900_000_001),
        ("encrypted_credentials", '{"access_token":"rotated"}'),
        ("encrypted_credentials", None),
        ("user_id", "other-owner"),
        ("visibility", PermissionEnum.ONLY_ME),
        ("provider", "langgenius/other/other"),
        ("tenant_id", "other-tenant"),
        ("id", "other-id"),
    ],
)
def test_every_bound_metadata_field_changes_revision(field: str, value: object) -> None:
    row = _row()
    row.id = "credential"
    before = credential_revision(row, key=KEY)
    setattr(row, field, value)
    assert credential_revision(row, key=KEY) != before


def test_default_flag_is_not_part_of_the_revision() -> None:
    row = _row()
    before = credential_revision(row, key=KEY)
    row.is_default = True
    assert credential_revision(row, key=KEY) == before


def _client(
    *,
    source: str = "tenant",
    row_id: str | None = "client",
    encrypted_params: str | None = TENANT_CLIENT_CIPHERTEXT,
    enabled: bool = True,
    tenant_id: str = "tenant",
    plugin_id: str = PLUGIN,
    provider: str = "dify-gmail",
    key: object = KEY,
) -> str:
    return oauth_client_revision(
        source=cast(OAuthClientSource, source),
        row_id=row_id,
        encrypted_params=encrypted_params,
        enabled=enabled,
        tenant_id=tenant_id,
        plugin_id=plugin_id,
        provider=provider,
        key=cast(bytes, key),
    )


@pytest.mark.parametrize("key", [b"", "unit-key", bytearray(b"unit-key"), None])
def test_revisions_refuse_an_empty_or_untyped_key(key: object) -> None:
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_revision_key"):
        credential_revision(_row(), key=cast(bytes, key))
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_revision_key"):
        _client(key=key)


def test_revisions_are_keyed() -> None:
    row = _row()
    assert credential_revision(row, key=KEY) != credential_revision(row, key=b"rotated-key")
    assert _client() != _client(key=b"rotated-key")


@pytest.mark.parametrize(
    "changed",
    [
        lambda: _client(source="system"),
        lambda: _client(row_id="other-client"),
        lambda: _client(encrypted_params='{"client_id":"rotated"}'),
        lambda: _client(enabled=False),
        lambda: _client(tenant_id="other-tenant"),
        lambda: _client(plugin_id="langgenius/other"),
        lambda: _client(provider="other"),
    ],
)
def test_every_client_snapshot_field_changes_client_revision(changed: Callable[[], str]) -> None:
    assert changed() != _client()


def test_client_source_is_closed() -> None:
    assert _client(source="missing", row_id=None, encrypted_params=None, enabled=False) != _client()
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_oauth_client_source"):
        _client(source="debug")


# --- owner selection on a real SQLite session -------------------------------------


@dataclass
class World:
    factory: sessionmaker[Session]
    tenant_id: str
    actor: Actor
    teammate_id: str
    credential_id: str


@pytest.fixture(autouse=True)
def forbidden_effects(monkeypatch: pytest.MonkeyPatch) -> dict[str, Mock]:
    """Selection is metadata only: any secret/runtime/provider owner call fails the test."""
    from core.helper import encrypter
    from core.helper.provider_encryption import ProviderConfigEncrypter
    from core.plugin.impl.oauth import OAuthHandler
    from core.plugin.impl.tool import PluginToolManager
    from core.plugin.plugin_service import PluginService
    from core.tools.tool_manager import ToolManager
    from core.tools.utils import system_encryption
    from services.tools import builtin_tools_manage_service as service_module

    targets: list[tuple[object, str]] = [
        (ProviderConfigEncrypter, "decrypt"),
        (encrypter, "decrypt_token"),
        (encrypter, "batch_decrypt_token"),
        (system_encryption, "decrypt_system_params"),
        (service_module, "decrypt_system_params"),
        (service_module, "create_provider_encrypter"),
        (ToolManager, "get_builtin_provider"),
        (ToolManager, "get_tool_runtime"),
        (PluginToolManager, "invoke"),
        (PluginToolManager, "validate_provider_credentials"),
        (PluginToolManager, "get_runtime_parameters"),
        (OAuthHandler, "get_credentials"),
        (OAuthHandler, "refresh_credentials"),
        (PluginService, "is_plugin_verified"),
        (BuiltinToolManageService, "get_oauth_client"),
        # The caller owns the short session; the owner opens no other one.
        (service_module, "sessionmaker"),
        (service_module, "Session"),
    ]
    spies: dict[str, Mock] = {}
    for owner, name in targets:
        spy = Mock(side_effect=AssertionError("unexpected effect"))
        monkeypatch.setattr(owner, name, spy)
        spies[f"{getattr(owner, '__name__', owner)}.{name}"] = spy
    return spies


@pytest.fixture
def world(forbidden_effects: dict[str, Mock]) -> Iterator[World]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TypeBase.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    with factory.begin() as db:
        workspace = Tenant(name="Workspace")
        workspace.id = tenant_id
        admin = Account(name="Admin", email="admin@example.invalid")
        teammate = Account(name="Teammate", email="teammate@example.invalid")
        db.add_all([workspace, admin, teammate])
        db.flush()
        db.add_all(
            [
                TenantAccountJoin(tenant_id=tenant_id, account_id=admin.id, role=TenantAccountRole.ADMIN),
                TenantAccountJoin(tenant_id=tenant_id, account_id=teammate.id, role=TenantAccountRole.OWNER),
            ]
        )
        credential = _row(tenant_id=tenant_id, user_id=admin.id)
        db.add(credential)
        tenant_client = ToolOAuthTenantClient(tenant_id=tenant_id, plugin_id=PLUGIN, provider="dify-gmail")
        tenant_client.encrypted_oauth_params = TENANT_CLIENT_CIPHERTEXT
        tenant_client.enabled = True
        db.add(tenant_client)
        db.add(
            ToolOAuthSystemClient(
                plugin_id=PLUGIN, provider="dify-gmail", encrypted_oauth_params=SYSTEM_CLIENT_CIPHERTEXT
            )
        )
        db.flush()
        actor = Actor(account_id=admin.id, tenant_id=tenant_id)
        state = World(factory, tenant_id, actor, teammate.id, credential.id)
    yield state
    for spy in forbidden_effects.values():
        spy.assert_not_called()
    engine.dispose()


def resolve(
    world: World,
    *,
    actor: Actor | None = None,
    provider_id: str = PROVIDER,
    credential_id: str | None = None,
    verified_plugin: object = True,
    revision_key: object = KEY,
) -> CredentialReference:
    with world.factory() as db:
        return BuiltinToolManageService.resolve_builder_reference(
            db=db,
            actor=actor or world.actor,
            provider_id=provider_id,
            credential_id=world.credential_id if credential_id is None else credential_id,
            # Deliberately untyped inputs exercise the owner's own refusal.
            verified_plugin=cast(bool, verified_plugin),
            revision_key=cast(bytes, revision_key),
        )


def refused(
    world: World,
    reason: str,
    *,
    actor: Actor | None = None,
    provider_id: str = PROVIDER,
    credential_id: str | None = None,
    verified_plugin: object = True,
    revision_key: object = KEY,
) -> None:
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        resolve(
            world,
            actor=actor,
            provider_id=provider_id,
            credential_id=credential_id,
            verified_plugin=verified_plugin,
            revision_key=revision_key,
        )
    assert raised.value.reason_code == reason


def test_explicit_credential_reference_is_exact_metadata_without_secrets(world: World) -> None:
    reference = resolve(world)
    assert reference.credential_id == world.credential_id
    assert reference.provider_id == PROVIDER
    assert reference.alias == "Team mailbox"
    assert reference.credential_type == "oauth2"
    assert reference.visibility == "all_team_members"
    assert reference.expires_at == 1_900_000_000
    with world.factory() as db:
        row = db.get(BuiltinToolProvider, world.credential_id)
        client = db.scalars(select(ToolOAuthTenantClient)).one()
        assert row is not None
        # The opaque reference revision binds the row primitive AND the effective access.
        assert reference.revision != credential_revision(row, key=KEY)
        assert reference.oauth_client_revision == _client(row_id=client.id, tenant_id=world.tenant_id)
    assert resolve(world) == reference
    dumped = json.dumps(reference.model_dump(mode="json"))
    for secret in ("encrypted-access", "encrypted-refresh", "encrypted-tenant", "encrypted-system"):
        assert secret not in dumped


def test_private_snapshot_preserves_exact_selected_ciphertext_and_client(world: World) -> None:
    with world.factory() as db:
        snapshot = select_builder_credential(
            db,
            actor=world.actor,
            provider_id=PROVIDER,
            credential_id=world.credential_id,
            verified_plugin=True,
            revision_key=KEY,
        )
        client = db.scalars(select(ToolOAuthTenantClient)).one()
    assert snapshot.encrypted_credentials == CREDENTIAL_CIPHERTEXT
    assert snapshot.client.source == "tenant"
    assert snapshot.client.row_id == client.id
    assert snapshot.client.encrypted_params == TENANT_CLIENT_CIPHERTEXT
    assert snapshot.client.enabled is True
    assert snapshot.reference == resolve(world)
    # The ephemeral snapshot never renders ciphertext.
    assert "encrypted" not in repr(snapshot)


def test_private_credential_of_another_member_is_unavailable_even_to_an_admin(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(user_id=world.teammate_id, visibility=PermissionEnum.ONLY_ME))
    refused(world, "credential_reference_unavailable")


def test_own_private_credential_is_selectable(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(visibility=PermissionEnum.ONLY_ME))
    assert resolve(world).visibility == "only_me"


def test_partial_member_access_is_read_now_and_revocation_refuses(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(
            update(BuiltinToolProvider).values(user_id=world.teammate_id, visibility=PermissionEnum.PARTIAL_TEAM)
        )
        db.add(
            CredentialPermission(
                credential_id=world.credential_id,
                credential_type=CredentialPermissionType.BUILTIN_TOOL_PROVIDER,
                account_id=world.actor.account_id,
                tenant_id=world.tenant_id,
            )
        )
    assert resolve(world).visibility == "partial_members"
    with world.factory.begin() as db:
        db.execute(delete(CredentialPermission).where(CredentialPermission.account_id == world.actor.account_id))
    refused(world, "credential_reference_unavailable")


def test_partial_member_grant_of_another_credential_type_does_not_apply(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(
            update(BuiltinToolProvider).values(user_id=world.teammate_id, visibility=PermissionEnum.PARTIAL_TEAM)
        )
        db.add(
            CredentialPermission(
                credential_id=world.credential_id,
                credential_type=CredentialPermissionType.DATASOURCE_PROVIDER,
                account_id=world.actor.account_id,
                tenant_id=world.tenant_id,
            )
        )
    refused(world, "credential_reference_unavailable")


def _share_with_teammate_as(world: World, visibility: PermissionEnum) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(user_id=world.teammate_id, visibility=visibility))


def _grant(
    world: World,
    *,
    account_id: str | None = None,
    tenant_id: str | None = None,
    credential_id: str | None = None,
    has_permission: bool = True,
) -> str:
    grant = CredentialPermission(
        credential_id=credential_id or world.credential_id,
        credential_type=CredentialPermissionType.BUILTIN_TOOL_PROVIDER,
        account_id=account_id or world.actor.account_id,
        tenant_id=tenant_id or world.tenant_id,
        has_permission=has_permission,
    )
    with world.factory.begin() as db:
        db.add(grant)
        db.flush()
        return grant.id


def _row_revision(world: World) -> str:
    with world.factory() as db:
        row = db.get(BuiltinToolProvider, world.credential_id)
        assert row is not None
        return credential_revision(row, key=KEY)


def test_revoke_then_regrant_changes_the_reference_revision(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    first_grant = _grant(world)
    row_before = _row_revision(world)
    before = resolve(world)
    with world.factory.begin() as db:
        db.execute(delete(CredentialPermission).where(CredentialPermission.id == first_grant))
    refused(world, "credential_reference_unavailable")
    _grant(world)
    after = resolve(world)
    # Same credential row and timestamp; only the effective grant differs.
    assert _row_revision(world) == row_before
    assert after.revision != before.revision
    assert after.oauth_client_revision == before.oauth_client_revision


def test_applicable_grant_metadata_change_changes_the_reference_revision(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    grant_id = _grant(world)
    before = resolve(world)
    with world.factory.begin() as db:
        db.execute(
            update(CredentialPermission)
            .where(CredentialPermission.id == grant_id)
            .values(created_at=datetime(2030, 1, 1, 0, 0, 0))
        )
    assert resolve(world).revision != before.revision


def test_stale_grant_on_another_members_only_me_credential_refuses(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.ONLY_ME)
    _grant(world)
    refused(world, "credential_reference_unavailable")


def test_foreign_tenant_grant_cannot_authorize(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    _grant(world, tenant_id=str(uuid4()))
    refused(world, "credential_reference_unavailable")


def test_inactive_grant_cannot_authorize(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    _grant(world, has_permission=False)
    refused(world, "credential_reference_unavailable")


def test_unrelated_member_grant_changes_do_not_invalidate_the_actor(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    _grant(world)
    before = resolve(world)
    teammate_grant = _grant(world, account_id=world.teammate_id)
    _grant(world, credential_id=str(uuid4()))
    assert resolve(world) == before
    with world.factory.begin() as db:
        db.execute(delete(CredentialPermission).where(CredentialPermission.id == teammate_grant))
    assert resolve(world) == before


@pytest.mark.parametrize("visibility", [PermissionEnum.ONLY_ME, PermissionEnum.PARTIAL_TEAM, PermissionEnum.ALL_TEAM])
def test_own_credential_needs_no_grant_and_ignores_grants(world: World, visibility: PermissionEnum) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(visibility=visibility))
    before = resolve(world)
    _grant(world)
    assert resolve(world) == before


def test_team_shared_credential_ignores_grants(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.ALL_TEAM)
    before = resolve(world)
    _grant(world)
    assert resolve(world) == before


def test_private_snapshot_records_the_effective_partial_grant(world: World) -> None:
    _share_with_teammate_as(world, PermissionEnum.PARTIAL_TEAM)
    grant_id = _grant(world)
    with world.factory() as db:
        snapshot = select_builder_credential(
            db,
            actor=world.actor,
            provider_id=PROVIDER,
            credential_id=world.credential_id,
            verified_plugin=True,
            revision_key=KEY,
        )
    assert snapshot.access.basis == "partial_grant"
    assert snapshot.access.grant_ids == (grant_id,)
    assert "encrypted" not in repr(snapshot)


def test_credential_in_another_workspace_is_unavailable(world: World) -> None:
    foreign = _row(tenant_id=str(uuid4()), user_id=world.actor.account_id, name="Foreign")
    with world.factory.begin() as db:
        db.add(foreign)
        db.flush()
        foreign_id = foreign.id
    refused(world, "credential_reference_unavailable", credential_id=foreign_id)
    refused(
        world,
        "credential_reference_unavailable",
        actor=Actor(account_id=world.actor.account_id, tenant_id=str(uuid4())),
    )


@pytest.mark.parametrize(
    "provider_id",
    ["dify-gmail", "langgenius/dify-gmail/other", "other/dify-gmail/dify-gmail", "langgenius/dify-gmail", ""],
)
def test_requested_provider_must_equal_the_canonical_row_provider(world: World, provider_id: str) -> None:
    refused(world, "credential_reference_unavailable", provider_id=provider_id)


def test_row_of_another_provider_is_unavailable(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(provider="langgenius/github/github"))
    refused(world, "credential_reference_unavailable")


def test_legacy_short_row_provider_canonicalizes_to_full_identity(world: World) -> None:
    # The row is canonicalized; the request is never matched by short name.
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(provider="dify-gmail"))
    assert resolve(world).provider_id == PROVIDER


def test_uncanonicalizable_row_provider_is_unavailable(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(provider="Not A Provider"))
    refused(world, "credential_reference_unavailable")


@pytest.mark.parametrize("credential_id", [str(uuid4()), "", "x" * 129])
def test_unknown_or_malformed_credential_id_is_unavailable(world: World, credential_id: str) -> None:
    refused(world, "credential_reference_unavailable", credential_id=credential_id)


def _session_that_must_not_query() -> Mock:
    # Any SQL would reach PostgreSQL's native UUID column; refusal must precede it.
    db = Mock(spec=Session)
    for name in ("scalar", "scalars", "execute", "get", "query"):
        getattr(db, name).side_effect = AssertionError("unexpected query")
    return db


VALID_UUID = "6f1c3b0e-8a3d-4c2b-9f4e-2d7a1b5c9e10"


@pytest.mark.parametrize(
    "credential_id",
    [
        "not-a-uuid",
        "x" * 36,
        "6f1c3b0e-8a3d-4c2b-9f4e-2d7a1b5c9e1g",
        "6f1c3b0e-8a3d-4c2b-9f4e-2d7a1b5c9e1",
        VALID_UUID.upper(),
        "{" + VALID_UUID + "}",
        VALID_UUID.replace("-", ""),
        "urn:uuid:" + VALID_UUID,
        " " + VALID_UUID,
        VALID_UUID + "\n",
        "6f1c3b0e-8a3d-4c2b-9f4e-2d7a1b5c9e10'; --",
    ],
)
def test_noncanonical_credential_uuid_refuses_before_any_query(credential_id: str) -> None:
    db = _session_that_must_not_query()
    with pytest.raises(BuilderExecutionPolicyError) as raised:
        BuiltinToolManageService.resolve_builder_reference(
            db=db,
            actor=Actor(account_id="account", tenant_id="tenant"),
            provider_id=PROVIDER,
            credential_id=credential_id,
            verified_plugin=True,
            revision_key=KEY,
        )
    assert raised.value.reason_code == "credential_reference_unavailable"
    assert credential_id not in str(raised.value)
    db.scalar.assert_not_called()


def test_canonical_credential_uuid_reaches_the_query_without_validating_actor_ids() -> None:
    # Actor/tenant identities are not credential UUIDs; only credential_id is checked.
    db = Mock(spec=Session)
    db.scalar.return_value = None
    with pytest.raises(BuilderExecutionPolicyError, match="credential_reference_unavailable"):
        BuiltinToolManageService.resolve_builder_reference(
            db=db,
            actor=Actor(account_id="account", tenant_id="tenant"),
            provider_id=PROVIDER,
            credential_id=VALID_UUID,
            verified_plugin=True,
            revision_key=KEY,
        )
    db.scalar.assert_called_once()


def test_explicit_credential_stays_selected_after_workspace_default_changes(world: World) -> None:
    before = resolve(world)
    other = _row(tenant_id=world.tenant_id, user_id=world.actor.account_id, name="Other mailbox")
    with world.factory.begin() as db:
        db.add(other)
        db.flush()
        db.execute(update(BuiltinToolProvider).values(is_default=False))
        db.execute(update(BuiltinToolProvider).where(BuiltinToolProvider.id == other.id).values(is_default=True))
    after = resolve(world)
    assert after == before
    assert after.credential_id == world.credential_id
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(is_default=True))
    assert resolve(world) == before


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("name", "Renamed mailbox"),
        ("credential_type", CredentialType.API_KEY),
        ("expires_at", 1_900_000_100),
        ("encrypted_credentials", '{"access_token":"rotated-same-second"}'),
    ],
)
def test_credential_metadata_change_changes_reference(world: World, column: str, value: object) -> None:
    before = resolve(world)
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values({column: value}))
    after = resolve(world)
    assert after.revision != before.revision
    assert after != before


def test_client_ciphertext_rotation_changes_client_revision(world: World) -> None:
    before = resolve(world)
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthTenantClient).values(encrypted_oauth_params='{"client_id":"rotated"}'))
    after = resolve(world)
    assert after.revision == before.revision
    assert after.oauth_client_revision != before.oauth_client_revision


def test_disabled_tenant_client_switches_source_to_verified_system_client(world: World) -> None:
    tenant = resolve(world)
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthTenantClient).values(enabled=False))
    system = resolve(world)
    assert system.revision == tenant.revision
    assert system.oauth_client_revision != tenant.oauth_client_revision
    with world.factory() as db:
        system_row = db.scalars(select(ToolOAuthSystemClient)).one()
        snapshot = select_builder_credential(
            db,
            actor=world.actor,
            provider_id=PROVIDER,
            credential_id=world.credential_id,
            verified_plugin=True,
            revision_key=KEY,
        )
    assert (snapshot.client.source, snapshot.client.row_id) == ("system", system_row.id)
    assert snapshot.client.encrypted_params == SYSTEM_CLIENT_CIPHERTEXT
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthSystemClient).values(encrypted_oauth_params="rotated-system"))
    assert resolve(world).oauth_client_revision != system.oauth_client_revision


@pytest.mark.parametrize("verified_plugin", [False, None, 1, "true"])
def test_system_client_requires_positive_server_verification(world: World, verified_plugin: object) -> None:
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthTenantClient).values(enabled=False))
    refused(world, "needs_setup", verified_plugin=verified_plugin)


def test_tenant_client_takes_precedence_without_verification(world: World) -> None:
    assert resolve(world, verified_plugin=False) == resolve(world, verified_plugin=True)


def test_missing_oauth_client_needs_setup(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(delete(ToolOAuthTenantClient))
        db.execute(delete(ToolOAuthSystemClient))
    refused(world, "needs_setup")


def test_enabled_tenant_client_without_params_needs_setup_and_never_falls_back(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthTenantClient).values(encrypted_oauth_params=""))
    refused(world, "needs_setup")


def test_other_workspace_or_plugin_tenant_client_is_not_selected(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(delete(ToolOAuthSystemClient))
        db.execute(update(ToolOAuthTenantClient).values(tenant_id=str(uuid4())))
    refused(world, "needs_setup")
    with world.factory.begin() as db:
        db.execute(update(ToolOAuthTenantClient).values(tenant_id=world.tenant_id, plugin_id="langgenius/other"))
    refused(world, "needs_setup")


def test_api_key_credential_binds_the_missing_client_state(world: World) -> None:
    with world.factory.begin() as db:
        db.execute(update(BuiltinToolProvider).values(credential_type=CredentialType.API_KEY))
        db.execute(delete(ToolOAuthTenantClient))
        db.execute(delete(ToolOAuthSystemClient))
    reference = resolve(world)
    assert reference.credential_type == "api-key"
    assert reference.oauth_client_revision == _client(
        source="missing", row_id=None, encrypted_params=None, enabled=False, tenant_id=world.tenant_id
    )


@pytest.mark.parametrize("revision_key", [b"", "unit-key"])
def test_owner_refuses_missing_revision_key(world: World, revision_key: object) -> None:
    refused(world, "invalid_revision_key", revision_key=revision_key)
