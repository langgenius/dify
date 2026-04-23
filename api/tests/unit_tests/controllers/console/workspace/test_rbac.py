"""Controller tests for ``controllers.console.workspace.rbac``.

The controllers here are thin: almost every non-trivial behaviour lives in
``services.enterprise.rbac_service`` (covered by its own suite). These tests
therefore focus on the three Flask-layer concerns the service layer cannot
exercise:

* ``enterprise_only`` rejects community-edition calls with 403 (it is the
  outermost decorator, so it fires before any auth middleware).
* ``_current_ids`` raises 404 when the session has no tenant.
* The pydantic request models accept / reject bodies as expected.

We explicitly avoid "happy-path" integration tests through the full
decorator stack — those belong in e2e tests where a real Dify session is
available — to keep this suite fast and resilient to ancillary auth wiring
changes.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console.workspace import rbac as rbac_mod


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


def _enabled(enabled: bool):
    return patch("controllers.console.workspace.rbac.dify_config.ENTERPRISE_ENABLED", enabled)


class TestEnterpriseGate:
    """``enterprise_only`` is the outermost decorator on every resource, so we
    can exercise it directly — no auth stubs required.
    """

    def test_catalog_forbidden_when_disabled(self, app):
        with app.test_request_context("/workspaces/current/rbac/role-permissions/catalog"), _enabled(False):
            with pytest.raises(Forbidden):
                rbac_mod.RBACWorkspaceCatalogApi().get()

    def test_roles_post_forbidden_when_disabled(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/roles", method="POST", json={}),
            _enabled(False),
        ):
            with pytest.raises(Forbidden):
                rbac_mod.RBACRolesApi().post()


class TestCurrentIds:
    def test_rejects_missing_tenant(self):
        with patch("controllers.console.workspace.rbac.current_account_with_tenant") as mock_user:
            mock_user.return_value = (SimpleNamespace(id="acct-1"), None)
            with pytest.raises(NotFound):
                rbac_mod._current_ids()

    def test_returns_tuple(self):
        with patch("controllers.console.workspace.rbac.current_account_with_tenant") as mock_user:
            mock_user.return_value = (SimpleNamespace(id="acct-1"), "tenant-1")
            assert rbac_mod._current_ids() == ("tenant-1", "acct-1")


class TestPydanticModels:
    """The internal `_…Request` models are the contract between the browser
    and the controllers. We only check non-obvious branches (enum parsing,
    missing required fields) — trivial `str` fields are not worth asserting.
    """

    def test_role_upsert_requires_name_and_key(self):
        with pytest.raises(ValidationError):
            rbac_mod._RoleUpsertRequest.model_validate({})

    def test_role_upsert_to_mutation_preserves_fields(self):
        payload = rbac_mod._RoleUpsertRequest.model_validate(
            {
                "name": "Owner",
                "role_key": "workspace.owner",
                "description": "full access",
                "permission_keys": ["workspace.member.manage"],
            }
        )
        mutation = payload.to_mutation()
        assert mutation.role_key == "workspace.owner"
        assert mutation.description == "full access"
        assert mutation.permission_keys == ["workspace.member.manage"]

    def test_access_policy_create_parses_resource_type_enum(self):
        parsed = rbac_mod._AccessPolicyCreateRequest.model_validate(
            {
                "name": "Full access",
                "resource_type": "app",
                "description": "",
                "permission_keys": [],
            }
        )
        assert parsed.resource_type is rbac_mod.svc.RBACResourceType.APP

    def test_access_policy_create_rejects_unknown_resource_type(self):
        with pytest.raises(ValidationError):
            rbac_mod._AccessPolicyCreateRequest.model_validate({"name": "bad", "resource_type": "unknown"})

    def test_replace_role_bindings_defaults_empty(self):
        parsed = rbac_mod._ReplaceRoleBindingsRequest.model_validate({})
        assert parsed.role_keys == []


class TestDumpHelper:
    def test_dump_returns_plain_dict(self):
        role = rbac_mod.svc.RBACRole(id="role-1", type="workspace", role_key="workspace.owner", name="Owner")
        dumped = rbac_mod._dump(role)
        assert isinstance(dumped, dict)
        assert dumped["role_key"] == "workspace.owner"
