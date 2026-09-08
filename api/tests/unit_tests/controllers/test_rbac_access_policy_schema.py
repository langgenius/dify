"""Access-policy writes must expose typed bodies through the RBAC decorators."""

import json

import pytest


@pytest.fixture(scope="module")
def console_schema(tmp_path_factory):
    from dev.generate_swagger_specs import generate_specs

    output_dir = tmp_path_factory.mktemp("rbac-openapi")
    generate_specs(output_dir)
    return json.loads((output_dir / "console-openapi.json").read_text())


@pytest.mark.parametrize(
    ("method", "path", "model", "status"),
    [
        ("post", "/workspaces/current/rbac/access-policies", "_AccessPolicyCreateRequest", "201"),
        ("put", "/workspaces/current/rbac/access-policies/{policy_id}", "_AccessPolicyUpdateRequest", "200"),
    ],
)
def test_access_policy_write_contracts(console_schema, method, path, model, status):
    operation = console_schema["paths"][path][method]
    request_body = operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_body["$ref"] == f"#/components/schemas/{model}"

    properties = console_schema["components"]["schemas"][model]["properties"]
    assert {"name", "description", "permission_keys"} <= properties.keys()
    assert properties["permission_keys"]["items"]["type"] == "string"
    response = operation["responses"][status]["content"]["application/json"]["schema"]
    assert response["$ref"] == "#/components/schemas/AccessPolicy"
