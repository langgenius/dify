"""Access-policy writes must expose typed bodies through the RBAC decorators."""

import json
from collections.abc import Callable
from inspect import unwrap
from typing import Protocol, cast
from uuid import UUID

import pytest
from flask import Flask
from jsonschema import Draft202012Validator
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.workspace.rbac import policies, resources, roles
from machinery.context import RequestContext
from services.rbac.contracts import RBACResourceType
from tests.unit_tests.rbac_fakes import build_rbac_domain


class _DeleteResource(Protocol):
    delete: Callable[..., dict[str, object]]


def _object_at(root: dict[str, object], *keys: str) -> dict[str, object]:
    current: object = root
    for key in keys:
        assert isinstance(current, dict)
        current = current[key]
    assert isinstance(current, dict)
    return cast(dict[str, object], current)


@pytest.fixture(scope="module")
def console_schema(tmp_path_factory: pytest.TempPathFactory) -> dict[str, object]:
    from dev.generate_swagger_specs import generate_specs

    output_dir = tmp_path_factory.mktemp("rbac-openapi")
    generate_specs(output_dir)
    schema: object = json.loads((output_dir / "console-openapi.json").read_text())
    assert isinstance(schema, dict)
    return cast(dict[str, object], schema)


@pytest.mark.parametrize(
    ("method", "path", "model", "status"),
    [
        ("post", "/workspaces/current/rbac/access-policies", "_AccessPolicyCreateRequest", "201"),
        ("put", "/workspaces/current/rbac/access-policies/{policy_id}", "_AccessPolicyUpdateRequest", "200"),
    ],
)
def test_access_policy_write_contracts(
    console_schema: dict[str, object], method: str, path: str, model: str, status: str
) -> None:
    operation = _object_at(console_schema, "paths", path, method)
    request_body = _object_at(operation, "requestBody", "content", "application/json", "schema")
    assert request_body["$ref"] == f"#/components/schemas/{model}"

    properties = _object_at(console_schema, "components", "schemas", model, "properties")
    assert {"name", "description", "permission_keys"} <= properties.keys()
    assert _object_at(properties, "permission_keys", "items")["type"] == "string"
    response = _object_at(operation, "responses", status, "content", "application/json", "schema")
    assert response["$ref"] == "#/components/schemas/AccessPolicy"


@pytest.mark.parametrize("target", ["roles", "access-policies", "apps", "datasets", "agents"])
def test_delete_response_matches_exported_schema(
    console_schema: dict[str, object],
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    target: str,
) -> None:
    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    context = RequestContext("request", None, "actor", "workspace")
    item_id = UUID("00000000-0000-0000-0000-000000000001")
    if target == "roles":
        module = roles
        resource = roles.RBACRoleItemApi()
        path = "/workspaces/current/rbac/roles/{role_id}"
        path_params = {"role_id": item_id}
    elif target == "access-policies":
        module = policies
        resource = policies.RBACAccessPolicyItemApi()
        path = "/workspaces/current/rbac/access-policies/{policy_id}"
        path_params = {"policy_id": item_id}
    else:
        module = resources
        kind = RBACResourceType(target[:-1])
        resource = resources._RESOURCE_ACCESS_APIS[kind].member_bindings()
        path = (
            f"/workspaces/current/rbac/{target}/{{{kind.route.id_param}}}/access-policies/{{policy_id}}/member-bindings"
        )
        path_params = {kind.route.id_param: item_id, "policy_id": item_id}
    monkeypatch.setattr(module, "application_services", lambda: domain)
    delete = cast(_DeleteResource, resource).delete
    with app.test_request_context(method="DELETE", json={"account_ids": ["member"]}):
        response = unwrap(delete)(resource, context, **path_params)

    assert response == {"result": "success"}
    schema = _object_at(
        console_schema, "paths", path, "delete", "responses", "200", "content", "application/json", "schema"
    )
    assert schema["$ref"] == "#/components/schemas/SimpleResultResponse"
    Draft202012Validator({**schema, "components": console_schema["components"]}).validate(response)
    assert domain.transport.only_request.method == "DELETE"
