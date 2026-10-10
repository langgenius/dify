"""RBAC transport tests use real services, SQLite and an explicit Enterprise transport fake."""

import inspect
from collections.abc import Callable
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.common.errors import InvalidArgumentError
from controllers.common.rbac import rbac_language
from controllers.console import flask_admission, wraps
from controllers.console.workspace.rbac import members, policies, roles, schemas
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from libs.external_api import ExternalApi
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, TenantAccountJoin
from services.rbac import contracts as dto
from tests.unit_tests.model_factories import make_account, make_tenant
from tests.unit_tests.rbac_fakes import RBACDomain, build_rbac_domain

CONTEXT = RequestContext("request", "trace", "actor", "tenant")


@pytest.fixture
def domain(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> RBACDomain:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, RBAC_ENABLED=True, LOGIN_DISABLED=True)
    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    for module in (roles, policies, members):
        monkeypatch.setattr(module, "application_services", lambda: domain)
    return domain


class TestPydanticModels:
    """The internal `_…Request` models are the contract between the browser
    and the controllers. We only check non-obvious branches (enum parsing,
    missing required fields) — trivial `str` fields are not worth asserting.
    """

    def test_role_upsert_requires_name(self) -> None:
        with pytest.raises(ValidationError):
            schemas._RoleUpsertRequest.model_validate({})

    def test_role_upsert_to_mutation_preserves_fields(self) -> None:
        payload = schemas._RoleUpsertRequest.model_validate(
            {
                "name": "Owner",
                "description": "full access",
                "permission_keys": ["workspace.member.manage"],
            }
        )
        mutation = payload.to_mutation()
        assert mutation.description == "full access"
        assert mutation.permission_keys == ["workspace.member.manage"]

    def test_access_policy_create_parses_resource_type_enum(self) -> None:
        parsed = schemas._AccessPolicyCreateRequest.model_validate(
            {
                "name": "Full access",
                "resource_type": "app",
                "description": "",
                "permission_keys": [],
            }
        )
        assert parsed.resource_type is dto.RBACResourceType.APP

    def test_access_policy_create_rejects_unknown_resource_type(self) -> None:
        with pytest.raises(ValidationError):
            schemas._AccessPolicyCreateRequest.model_validate({"name": "bad", "resource_type": "unknown"})

    def test_resource_access_scope_requires_automatic_include_workspace_members(self) -> None:
        with pytest.raises(ValidationError):
            schemas._ResourceAccessScopeRequest.model_validate({})

    def test_resource_access_scope_accepts_automatic_include_workspace_members(self) -> None:
        parsed = schemas._ResourceAccessScopeRequest.model_validate({"automatic_include_workspace_members": True})
        assert parsed.automatic_include_workspace_members is True

    def test_replace_bindings_keeps_role_binding_contract(self) -> None:
        parsed = schemas._ReplaceBindingsRequest.model_validate({"role_ids": None})
        assert parsed.role_ids == []

    def test_replace_member_roles_coerce_null_list(self) -> None:
        parsed = schemas._ReplaceMemberRolesRequest.model_validate({"role_ids": None})
        assert parsed.role_ids == []

    def test_pagination_query_accepts_page_and_limit_aliases(self) -> None:
        parsed = schemas._PaginationQuery.model_validate({"page": 3, "limit": 25, "reverse": True})
        assert parsed.page_number == 3
        assert parsed.results_per_page == 25
        assert parsed.reverse is True

    def test_pagination_query_accepts_legacy_inner_names(self) -> None:
        parsed = schemas._PaginationQuery.model_validate({"page_number": 4, "results_per_page": 30, "reverse": False})
        assert parsed.page_number == 4
        assert parsed.results_per_page == 30
        assert parsed.reverse is False


def test_role_query_aliases_and_context_are_forwarded(app: Flask, domain: RBACDomain) -> None:
    domain.transport.response = {"data": []}
    with app.test_request_context("/?page=2&limit=25&reverse=true&include_owner=1&language=ZH"):
        result = inspect.unwrap(roles.RBACRolesApi.get)(roles.RBACRolesApi(), CONTEXT)
    assert result == {"data": [], "pagination": None}
    sent = domain.transport.only_request
    assert (sent.tenant_id, sent.account_id) == ("tenant", "actor")
    assert sent.params == {
        "page_number": 2,
        "results_per_page": 25,
        "reverse": "true",
        "include_owner": 1,
        "language": "zh",
        "biiling_enabled": True,
        "dataset_operator_enabled": False,
    }


def test_invalid_pagination_does_not_reach_application(app: Flask, domain: RBACDomain) -> None:
    with app.test_request_context("/?page=0"), pytest.raises(ValidationError):
        inspect.unwrap(roles.RBACRolesApi.get)(roles.RBACRolesApi(), CONTEXT)
    assert not domain.transport.requests


@pytest.mark.parametrize(
    ("member_id", "role_ids", "message"),
    [
        ("missing", ["editor"], "Member not in tenant."),
        ("foreign", ["editor"], "Member not in tenant."),
        ("member", [], "Workspace member role update requires exactly one role."),
        ("member", ["unknown"], ""),
        ("member", ["dataset_operator"], ""),
        ("actor", ["owner"], "Cannot operate self."),
        ("member", ["normal"], "The provided role is already assigned to the member."),
    ],
)
def test_member_role_errors_keep_invalid_param_contract(
    domain: RBACDomain,
    config_overrides: Callable[..., None],
    member_id: str,
    role_ids: list[str],
    message: str,
) -> None:
    config_overrides(RBAC_ENABLED=False, DATASET_OPERATOR_ENABLED=False)
    with domain.sessions.begin() as session:
        session.add(make_tenant(tenant_id="tenant"))
        for account_id in ("actor", "member", "foreign"):
            session.add(make_account(account_id=account_id, email=f"{account_id}@example.com"))
        session.add_all(
            [
                TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER),
                TenantAccountJoin(tenant_id="tenant", account_id="member", role=TenantAccountRole.NORMAL),
            ]
        )
    error_app = Flask(__name__)
    api = ExternalApi(error_app)

    class MemberRoleEndpoint(Resource):
        def put(self, member_id: str) -> dict[str, object]:
            return inspect.unwrap(members.RBACMemberRolesApi.put)(members.RBACMemberRolesApi(), CONTEXT, member_id)

    api.add_resource(MemberRoleEndpoint, "/members/<member_id>/rbac-roles")
    response = error_app.test_client().put(f"/members/{member_id}/rbac-roles", json={"role_ids": role_ids})
    assert response.status_code == 400
    assert response.get_json() == {"code": "invalid_param", "message": message, "status": 400}
    assert not domain.transport.requests


@pytest.mark.parametrize(
    ("member_id", "role", "error"),
    [("actor", "owner", InvalidArgumentError), ("member", "owner", Forbidden), ("owner", "normal", Forbidden)],
)
def test_member_role_endpoint_rejects_privilege_escalation(
    app: Flask,
    domain: RBACDomain,
    config_overrides: Callable[..., None],
    member_id: str,
    role: str,
    error: type[Exception],
) -> None:
    config_overrides(RBAC_ENABLED=False)
    original = {"actor": TenantAccountRole.NORMAL, "owner": TenantAccountRole.OWNER, "member": TenantAccountRole.NORMAL}
    with domain.sessions.begin() as session:
        session.add(make_tenant(tenant_id="tenant"))
        for account_id, assigned_role in original.items():
            session.add(make_account(account_id=account_id, email=f"{account_id}@example.com"))
            session.add(TenantAccountJoin(tenant_id="tenant", account_id=account_id, role=assigned_role))
    with app.test_request_context("/", method="PUT", json={"role_ids": [role]}), pytest.raises(error):
        inspect.unwrap(members.RBACMemberRolesApi.put)(members.RBACMemberRolesApi(), CONTEXT, member_id)
    with domain.sessions() as session:
        assigned = dict(session.execute(select(TenantAccountJoin.account_id, TenantAccountJoin.role)).tuples().all())
    assert assigned == original
    assert not domain.transport.requests


def test_role_copy_normalizes_uuid_and_applies_payload_default(app: Flask, domain: RBACDomain) -> None:
    role_id = UUID("00000000-0000-0000-0000-000000000001")
    domain.transport.response = {"id": "copy", "type": "workspace", "name": "Copy"}
    with app.test_request_context("/", method="POST", json={}):
        result, status = inspect.unwrap(roles.RBACRoleCopyApi.post)(roles.RBACRoleCopyApi(), CONTEXT, role_id)
    assert status == 201
    assert result["id"] == "copy"
    assert domain.transport.only_request.params == {"id": str(role_id)}
    assert domain.transport.only_request.json == {"copy_member": True}


def test_policy_query_and_permissions_keep_resource_selectors(app: Flask, domain: RBACDomain) -> None:
    domain.transport.response = {"data": []}
    with app.test_request_context("/?resource_type=agent&page=3&limit=25&reverse=false"):
        inspect.unwrap(policies.RBACAccessPoliciesApi.get)(policies.RBACAccessPoliciesApi(), CONTEXT)
    assert domain.transport.only_request.params == {
        "resource_type": "agent",
        "page_number": 3,
        "results_per_page": 25,
        "reverse": "false",
    }
    domain.transport.requests.clear()
    domain.transport.response = {"agent": {"default_permission_keys": ["agent.acl.preview"]}}
    with app.test_request_context("/?agent_id=agent-1"):
        result = inspect.unwrap(members.RBACMyPermissionsApi.get)(members.RBACMyPermissionsApi(), CONTEXT)
    assert result["agent"]["default_permission_keys"] == ["agent.acl.preview"]
    assert domain.transport.only_request.params == {"agent_id": "agent-1"}


@pytest.mark.parametrize(
    "controller", [policies.RBACAccessPolicyBindingLockApi, policies.RBACAccessPolicyBindingUnlockApi]
)
def test_policy_binding_state_serialization(
    app: Flask,
    domain: RBACDomain,
    controller: type[policies.RBACAccessPolicyBindingLockApi] | type[policies.RBACAccessPolicyBindingUnlockApi],
) -> None:
    locked = controller is policies.RBACAccessPolicyBindingLockApi
    domain.transport.response = {"binding_id": "binding", "is_locked": locked}
    with app.test_request_context("/", method="PUT"):
        result = inspect.unwrap(controller.put)(controller(), CONTEXT, "binding")
    assert result == {"binding_id": "binding", "is_locked": locked}
    assert domain.transport.only_request.json == {"binding_id": "binding"}


@pytest.mark.parametrize("controller", [roles.RBACRolesApi, policies.RBACAccessPoliciesApi])
def test_role_administration_denied_before_application(
    app: Flask,
    domain: RBACDomain,
    controller: type[roles.RBACRolesApi] | type[policies.RBACAccessPoliciesApi],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = Account(name="User", email="user@example.com", status=AccountStatus.ACTIVE)
    identity = AccountWithTenant(account, "tenant")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
    domain.transport.response = {"allowed": False}
    with app.test_request_context("/", method="POST", json={}), pytest.raises(Forbidden):
        controller().post()
    assert domain.transport.only_request.endpoint == "/rbac/check-access"


@pytest.mark.parametrize(("value", "expected"), [(" EN ", "en"), ("ja", "ja"), ("zh", "zh"), ("fr", None), ("", None)])
def test_language_normalization_is_owned_by_transport(app: Flask, value: str, expected: str | None) -> None:
    with app.test_request_context(query_string={"language": value}):
        assert rbac_language() == expected
