"""Built-in permission projections and membership writes use the shared repository."""

from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models import TenantAccountJoin
from services.rbac import builtin
from services.rbac import contracts as rbac_contracts
from tests.unit_tests.model_factories import make_account, make_tenant
from tests.unit_tests.rbac_fakes import RBACDomain

CONTEXT = RequestContext("request", None, "acct-1", "tenant-1")


@pytest.mark.parametrize(
    ("role", "workspace_keys", "app_keys", "dataset_keys", "agent_keys"),
    [
        (
            "owner",
            builtin._BUILTIN_WORKSPACE_OWNER_KEYS,
            builtin._BUILTIN_APP_OWNER_KEYS,
            builtin._BUILTIN_DATASET_OWNER_KEYS,
            builtin._BUILTIN_AGENT_FULL_ACCESS_KEYS,
        ),
        (
            "admin",
            builtin._BUILTIN_WORKSPACE_ADMIN_KEYS,
            builtin._BUILTIN_APP_ADMIN_KEYS,
            builtin._BUILTIN_DATASET_ADMIN_KEYS,
            builtin._BUILTIN_AGENT_FULL_ACCESS_KEYS,
        ),
        (
            "editor",
            builtin._BUILTIN_WORKSPACE_EDITOR_KEYS,
            builtin._BUILTIN_APP_EDITOR_KEYS,
            builtin._BUILTIN_DATASET_EDITOR_KEYS,
            builtin._BUILTIN_AGENT_FULL_ACCESS_KEYS,
        ),
        (
            "normal",
            builtin._BUILTIN_WORKSPACE_NORMAL_KEYS,
            builtin._BUILTIN_APP_NORMAL_KEYS,
            [],
            builtin._BUILTIN_AGENT_PREVIEW_KEYS,
        ),
        (
            "dataset_operator",
            builtin._BUILTIN_WORKSPACE_DATASET_OPERATOR_KEYS,
            builtin._BUILTIN_APP_DATASET_OPERATOR_KEYS,
            builtin._BUILTIN_DATASET_DATASET_OPERATOR_KEYS,
            builtin._BUILTIN_AGENT_PREVIEW_KEYS,
        ),
    ],
)
def test_get_uses_builtin_role_permissions_when_rbac_disabled(
    rbac_domain: RBACDomain,
    role: str,
    workspace_keys: list[str],
    app_keys: list[str],
    dataset_keys: list[str],
    agent_keys: list[str],
    sqlite_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="acct-1", role=TenantAccountRole(role)))
    sqlite_session.commit()
    out = rbac_domain.rbac.members.permissions("tenant-1", "acct-1")

    assert not rbac_domain.transport.requests
    assert out.workspace.permission_keys == workspace_keys
    assert len(out.workspace.permission_keys) == len(set(out.workspace.permission_keys))
    assert out.app.default_permission_keys == app_keys
    assert out.dataset.default_permission_keys == dataset_keys
    assert out.agent.default_permission_keys == agent_keys
    assert out.app.overrides == []
    assert out.dataset.overrides == []
    assert out.agent.overrides == []
    if role == "owner":
        assert "snippets.management" in out.workspace.permission_keys
        assert "app.acl.preview" in out.workspace.permission_keys
        assert "dataset.acl.preview" in out.workspace.permission_keys
        assert "app.acl.preview" in out.app.default_permission_keys
        assert "dataset.acl.preview" in out.dataset.default_permission_keys
    assert not any(key.startswith("billing.") for key in out.workspace.permission_keys)
    if role == "editor":
        assert "app.acl.log_and_annotation" in out.app.default_permission_keys
    assert "app.acl.deploy" not in out.app.default_permission_keys


@pytest.mark.parametrize(
    ("role", "expected_snippet_keys"),
    [
        ("owner", {"snippets.create_and_modify", "snippets.management"}),
        ("admin", {"snippets.create_and_modify", "snippets.management"}),
        ("editor", {"snippets.create_and_modify"}),
        ("normal", set()),
        ("dataset_operator", set()),
    ],
)
def test_get_uses_builtin_snippet_permissions_when_rbac_disabled(
    rbac_domain: RBACDomain,
    role: str,
    expected_snippet_keys: set[str],
    sqlite_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="acct-1", role=TenantAccountRole(role)))
    sqlite_session.commit()
    out = rbac_domain.rbac.members.permissions("tenant-1", "acct-1")

    actual_snippet_keys = {
        permission_key for permission_key in out.workspace.permission_keys if permission_key.startswith("snippets.")
    }

    assert not rbac_domain.transport.requests
    assert actual_snippet_keys == expected_snippet_keys


def test_get_returns_empty_when_role_missing_and_rbac_disabled(
    rbac_domain: RBACDomain, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    out = rbac_domain.rbac.members.permissions("tenant-1", "acct-1")

    assert not rbac_domain.transport.requests
    assert out.workspace.permission_keys == []
    assert out.app.default_permission_keys == []
    assert out.dataset.default_permission_keys == []
    assert out.agent.default_permission_keys == []


def test_get_builtin_role_includes_permission_keys(
    rbac_domain: RBACDomain, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="acct-2", role=TenantAccountRole.EDITOR))
    sqlite_session.commit()

    out = rbac_domain.rbac.members.get(CONTEXT, "acct-2", language=None)

    assert not rbac_domain.transport.requests
    assert out.account_id == "acct-2"
    assert out.roles[0].name == "editor"
    assert out.roles[0].permission_keys == list(
        dict.fromkeys(
            [
                *builtin._BUILTIN_WORKSPACE_EDITOR_KEYS,
                *builtin._BUILTIN_APP_EDITOR_KEYS,
                *builtin._BUILTIN_DATASET_EDITOR_KEYS,
                *builtin._BUILTIN_AGENT_FULL_ACCESS_KEYS,
            ]
        )
    )
    assert "snippets.create_and_modify" in out.roles[0].permission_keys
    assert "app.acl.preview" in out.roles[0].permission_keys
    assert "dataset.acl.preview" in out.roles[0].permission_keys
    assert "app.acl.deploy" not in out.roles[0].permission_keys


def test_replace_commits_builtin_join_role_when_rbac_disabled(
    rbac_domain: RBACDomain, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add_all(
        [
            make_tenant(tenant_id="tenant-1"),
            make_account(account_id="acct-1", email="owner@example.com"),
            make_account(account_id="acct-2", email="member@example.com"),
            TenantAccountJoin(tenant_id="tenant-1", account_id="acct-1", role=TenantAccountRole.OWNER),
        ]
    )
    target_join = TenantAccountJoin(tenant_id="tenant-1", account_id="acct-2", role=TenantAccountRole.NORMAL)
    sqlite_session.add(target_join)
    sqlite_session.commit()
    target_join_id = target_join.id
    engine = sqlite_session.get_bind()

    out = rbac_domain.rbac.members.replace(CONTEXT, "acct-2", role_ids=["editor"], language=None)

    assert not rbac_domain.transport.requests
    # Closing the writer rolls back any uncommitted update and prevents its identity map
    # from satisfying the verification query.
    sqlite_session.close()
    with Session(engine) as verification_session:
        persisted_join = verification_session.scalar(
            select(TenantAccountJoin).where(TenantAccountJoin.id == target_join_id)
        )
        assert persisted_join is not None
        assert persisted_join.role == TenantAccountRole.EDITOR
    assert out.account_id == "acct-2"
    assert out.roles[0].id == "editor"
    assert "app.acl.preview" in out.roles[0].permission_keys


def test_app_permissions_batch_get_uses_builtin_role_permissions_when_rbac_disabled(
    rbac_domain: RBACDomain, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="acct-1", role=TenantAccountRole.EDITOR))
    sqlite_session.commit()
    out = rbac_domain.rbac.members.resource_permissions(
        "tenant-1", "acct-1", rbac_contracts.RBACResourceType.APP, ["app-1", "app-2"]
    )

    assert not rbac_domain.transport.requests
    assert out == {
        "app-1": builtin._BUILTIN_APP_EDITOR_KEYS,
        "app-2": builtin._BUILTIN_APP_EDITOR_KEYS,
    }
    assert all("app.acl.deploy" not in permission_keys for permission_keys in out.values())


def test_dataset_permissions_batch_get_uses_builtin_role_permissions_when_rbac_disabled(
    rbac_domain: RBACDomain, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    sqlite_session.add(
        TenantAccountJoin(
            tenant_id="tenant-1",
            account_id="acct-1",
            role=TenantAccountRole.DATASET_OPERATOR,
        )
    )
    sqlite_session.commit()
    out = rbac_domain.rbac.members.resource_permissions(
        "tenant-1", "acct-1", rbac_contracts.RBACResourceType.DATASET, ["ds-1", "ds-2"]
    )

    assert not rbac_domain.transport.requests
    assert out == {
        "ds-1": builtin._BUILTIN_DATASET_DATASET_OPERATOR_KEYS,
        "ds-2": builtin._BUILTIN_DATASET_DATASET_OPERATOR_KEYS,
    }
