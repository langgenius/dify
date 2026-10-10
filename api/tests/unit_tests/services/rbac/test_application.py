"""RBAC use cases exercise real repositories and explicit transport/task fakes."""

from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models import Dataset, TenantAccountJoin
from services.errors.base import NoPermissionError
from services.errors.workspace import CannotOperateSelfError, InvalidWorkspaceMemberRoleError, RoleAlreadyAssignedError
from services.rbac import contracts as dto
from tests.unit_tests.model_factories import make_account, make_app, make_tenant
from tests.unit_tests.rbac_fakes import Initialization, RBACDomain, build_rbac_domain

CONTEXT = RequestContext("request", "trace", "actor", "workspace")


@pytest.fixture
def domain(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> RBACDomain:
    config_overrides(RBAC_ENABLED=True, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    return build_rbac_domain(sqlite_session_factory, monkeypatch)


def add_members(domain: RBACDomain, roles: dict[str, TenantAccountRole]) -> None:
    with domain.sessions.begin() as session:
        session.add(make_tenant(tenant_id="workspace"))
        for account_id, role in roles.items():
            account = make_account(account_id=account_id, name="Resolved name", email=f"{account_id}@example.com")
            account.avatar = "avatar"
            session.add(account)
            session.add(TenantAccountJoin(tenant_id="workspace", account_id=account_id, role=role))


@pytest.mark.parametrize("billing", [True, False])
@pytest.mark.parametrize("dataset_operator", [True, False])
def test_builtin_roles_keep_filters_owner_projection_and_pagination(
    domain: RBACDomain, config_overrides: Callable[..., None], billing: bool, dataset_operator: bool
) -> None:
    config_overrides(
        RBAC_ENABLED=False,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD if billing else DeploymentEdition.ENTERPRISE,
        DATASET_OPERATOR_ENABLED=dataset_operator,
    )
    service = domain.rbac.roles
    complete = service.list(CONTEXT, options=dto.ListOption(), include_owner=1, language=None)
    assert [role.name for role in complete.data] == ["owner", "admin", "editor", "normal"] + (
        ["dataset_operator"] if dataset_operator else []
    )
    assert complete.data[0].role_tag == "owner"
    assert "workspace.role.manage" in complete.data[0].permission_keys
    page = service.list(
        CONTEXT, options=dto.ListOption(page_number=2, results_per_page=2, reverse=True), include_owner=0, language=None
    )
    assert [role.id for role in page.data] == [role.id for role in reversed(complete.data[1:])][2:4]
    assert page.pagination is not None
    assert page.pagination.total_count == 3 + int(dataset_operator)
    assert page.pagination.current_page == 2
    assert not domain.transport.requests


def test_enterprise_roles_receive_identity_billing_and_language(
    domain: RBACDomain, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    domain.transport.response = {"data": []}
    domain.rbac.roles.list(
        CONTEXT, options=dto.ListOption(page_number=3, results_per_page=10), include_owner=1, language="ja"
    )
    sent = domain.transport.only_request
    assert (sent.tenant_id, sent.account_id) == ("workspace", "actor")
    assert sent.params == {
        "page_number": 3,
        "results_per_page": 10,
        "include_owner": 1,
        "biiling_enabled": True,
        "language": "ja",
        "dataset_operator_enabled": False,
    }


@pytest.mark.parametrize("role", [None, TenantAccountRole.EDITOR, TenantAccountRole.OWNER])
def test_builtin_member_and_permission_snapshots_share_membership(
    domain: RBACDomain, config_overrides: Callable[..., None], role: TenantAccountRole | None
) -> None:
    config_overrides(RBAC_ENABLED=False)
    if role:
        add_members(domain, {"actor": role})
    result = domain.rbac.members.get(CONTEXT, "actor", language=None)
    assert [item.id for item in result.roles] == ([role.value] if role else [])
    permissions = domain.rbac.members.permissions(
        CONTEXT.active_workspace_id, CONTEXT.account_id, app_id=None, dataset_id=None, agent_id=None, language=None
    )
    assert bool(permissions.app.default_permission_keys) is bool(role)
    assert not domain.transport.requests


@pytest.mark.parametrize("roles", [[], ["admin", "editor"], ["unknown"]])
def test_invalid_builtin_role_assignments_never_write(
    domain: RBACDomain, config_overrides: Callable[..., None], roles: list[str]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    add_members(domain, {"member": TenantAccountRole.NORMAL})
    with pytest.raises(InvalidWorkspaceMemberRoleError):
        domain.rbac.members.replace(CONTEXT, "member", roles, language=None)
    with domain.sessions() as session:
        assert session.scalar(select(TenantAccountJoin.role)) == TenantAccountRole.NORMAL
    assert not domain.transport.requests


def test_builtin_owner_replacement_commits_both_memberships(
    domain: RBACDomain, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    add_members(domain, {"actor": TenantAccountRole.OWNER, "member": TenantAccountRole.NORMAL})
    result = domain.rbac.members.replace(CONTEXT, "member", ["owner"], language=None)
    assert result.roles[0].id == "owner"
    with domain.sessions() as session:
        assigned = dict(session.execute(select(TenantAccountJoin.account_id, TenantAccountJoin.role)).tuples().all())
    assert assigned == {"actor": TenantAccountRole.NORMAL, "member": TenantAccountRole.OWNER}
    assert not domain.transport.requests


@pytest.mark.parametrize(
    ("actor_role", "member_id", "new_role", "error"),
    [
        (None, "member", "owner", NoPermissionError),
        (TenantAccountRole.NORMAL, "actor", "owner", CannotOperateSelfError),
        (TenantAccountRole.NORMAL, "member", "owner", NoPermissionError),
        (TenantAccountRole.NORMAL, "member", "admin", NoPermissionError),
        (TenantAccountRole.EDITOR, "member", "admin", NoPermissionError),
        (TenantAccountRole.ADMIN, "member", "owner", NoPermissionError),
        (TenantAccountRole.ADMIN, "owner", "normal", NoPermissionError),
        (TenantAccountRole.ADMIN, "member", "dataset_operator", InvalidWorkspaceMemberRoleError),
        (TenantAccountRole.ADMIN, "member", "normal", RoleAlreadyAssignedError),
    ],
)
def test_builtin_role_changes_enforce_workspace_policy_without_writing(
    domain: RBACDomain,
    config_overrides: Callable[..., None],
    actor_role: TenantAccountRole | None,
    member_id: str,
    new_role: str,
    error: type[Exception],
) -> None:
    config_overrides(RBAC_ENABLED=False, DATASET_OPERATOR_ENABLED=False)
    original = {"owner": TenantAccountRole.OWNER, "member": TenantAccountRole.NORMAL}
    if actor_role is not None:
        original["actor"] = actor_role
    add_members(domain, original)
    with pytest.raises(error):
        domain.rbac.members.replace(CONTEXT, member_id, [new_role], language=None)
    with domain.sessions() as session:
        assigned = dict(session.execute(select(TenantAccountJoin.account_id, TenantAccountJoin.role)).tuples().all())
    assert assigned == original
    assert not domain.transport.requests


@pytest.mark.parametrize("actor_role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
@pytest.mark.parametrize("new_role", [TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR])
def test_builtin_role_changes_allow_authorized_operators(
    domain: RBACDomain,
    config_overrides: Callable[..., None],
    actor_role: TenantAccountRole,
    new_role: TenantAccountRole,
) -> None:
    config_overrides(RBAC_ENABLED=False, DATASET_OPERATOR_ENABLED=True)
    add_members(domain, {"actor": actor_role, "member": TenantAccountRole.NORMAL})
    result = domain.rbac.members.replace(CONTEXT, "member", [new_role.value], language=None)
    assert result.roles[0].id == new_role.value
    with domain.sessions() as session:
        assigned = dict(session.execute(select(TenantAccountJoin.account_id, TenantAccountJoin.role)).tuples().all())
    assert assigned == {"actor": actor_role, "member": new_role}
    assert not domain.transport.requests


def test_enterprise_member_use_cases_keep_assignment_and_resource_filters(domain: RBACDomain) -> None:
    domain.transport.response = {"account_id": "member", "roles": []}
    domain.rbac.members.get(CONTEXT, "member", language="en")
    domain.rbac.members.replace(CONTEXT, "member", ["custom-role"], language="en")
    domain.rbac.members.permissions(
        CONTEXT.active_workspace_id, CONTEXT.account_id, app_id="app", dataset_id=None, agent_id=None, language="en"
    )
    get, replace, permissions = domain.transport.requests
    assert get.params == {"account_id": "member", "language": "en"}
    assert replace.json == {"role_ids": ["custom-role"]}
    assert permissions.params == {"app_id": "app", "language": "en"}
    with domain.sessions() as session:
        assert session.scalar(select(TenantAccountJoin)) is None


@pytest.mark.parametrize(
    ("kind", "id_param"),
    [
        (dto.RBACResourceType.APP, "app_id"),
        (dto.RBACResourceType.DATASET, "dataset_id"),
        (dto.RBACResourceType.AGENT, "agent_id"),
    ],
)
@pytest.mark.parametrize("automatic", [True, False])
def test_successful_whitelist_update_initializes_only_automatic_scope(
    domain: RBACDomain, kind: dto.RBACResourceType, id_param: str, automatic: bool
) -> None:
    domain.transport.response = {"account_ids": ["member"]}
    result = domain.rbac.resources.replace_whitelist(
        CONTEXT,
        kind,
        "resource",
        dto.ReplaceMemberBindings(automatic_include_workspace_members=automatic),
        language=None,
    )
    assert result.account_ids == ["member"]
    assert domain.tasks.queued == ([Initialization("workspace", "actor", {id_param: "resource"})] if automatic else [])


def test_failed_whitelist_update_never_dispatches(domain: RBACDomain) -> None:
    domain.transport.failure = ValueError("denied")
    with pytest.raises(ValueError, match="denied"):
        domain.rbac.resources.replace_whitelist(
            CONTEXT,
            dto.RBACResourceType.APP,
            "app",
            dto.ReplaceMemberBindings(automatic_include_workspace_members=True),
            language=None,
        )
    assert not domain.tasks.queued


@pytest.mark.parametrize("kind", list(dto.RBACResourceType))
@pytest.mark.parametrize("maintainer_on_page", [True, False])
def test_resource_maintainer_order_is_stable_and_page_local(
    domain: RBACDomain, kind: dto.RBACResourceType, maintainer_on_page: bool
) -> None:
    with domain.sessions.begin() as session:
        if kind == dto.RBACResourceType.APP:
            session.add(make_app(app_id="resource", tenant_id="workspace", maintainer="maintainer"))
        elif kind == dto.RBACResourceType.DATASET:
            session.add(
                Dataset(
                    id="resource",
                    tenant_id="workspace",
                    name="Dataset",
                    created_by="maintainer",
                    maintainer="maintainer",
                )
            )
    ids = ["member", "maintainer" if maintainer_on_page else "other", "last"]
    domain.transport.response = {"data": [{"account": {"account_id": account_id}} for account_id in ids]}
    result = domain.rbac.resources.user_access_policies(
        CONTEXT, kind, "resource", options=dto.ListOption(), language="zh"
    )
    assert [item.account.account_id for item in result.data] == (
        ["maintainer", "member", "last"] if maintainer_on_page and kind != dto.RBACResourceType.AGENT else ids
    )


@pytest.mark.parametrize("workspace_matrix", [True, False])
def test_account_hydration_is_tenant_scoped_and_preserves_names(domain: RBACDomain, workspace_matrix: bool) -> None:
    add_members(domain, {"known": TenantAccountRole.NORMAL})
    with domain.sessions.begin() as session:
        session.add(make_tenant(tenant_id="other"))
        session.add(make_account(account_id="foreign", name="Foreign", email="foreign@example.com"))
        session.add(TenantAccountJoin(tenant_id="other", account_id="foreign", role=TenantAccountRole.NORMAL))
    domain.transport.response = {
        "items": [
            {
                "accounts": [
                    {"account_id": " known ", "account_name": "Provided name", "binding_id": "1"},
                    {"account_id": "known", "account_name": "", "binding_id": "2"},
                    {"account_id": "foreign", "account_name": "", "binding_id": "3"},
                ]
            }
        ]
    }
    if workspace_matrix:
        result = domain.rbac.resources.workspace_matrix(
            CONTEXT, dto.RBACResourceType.APP, dto.ListOption(), language=None
        )
    else:
        result = domain.rbac.resources.matrix(CONTEXT, dto.RBACResourceType.APP, "app", language=None)
    first, second, foreign = result.items[0].accounts
    assert (first.account_name, first.avatar, first.email) == ("Provided name", "avatar", "known@example.com")
    assert (second.account_name, second.avatar, second.email) == ("Resolved name", "avatar", "known@example.com")
    assert (foreign.account_name, foreign.email) == ("", "")
