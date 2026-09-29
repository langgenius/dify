"""Access-policy writes must expose typed bodies through the RBAC decorators."""

import json
from typing import cast

import pytest


def _object_at(root: dict[str, object], *keys: str) -> dict[str, object]:
    current: object = root
    for key in keys:
        assert isinstance(current, dict)
        current = current[key]
    assert isinstance(current, dict)
    return cast(dict[str, object], current)


@pytest.fixture
def console_schema(exported_console_json: str) -> dict[str, object]:
    schema: object = json.loads(exported_console_json)
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
