"""Integration tests for /openapi/v1/apps* read surface."""

from __future__ import annotations

from flask.testing import FlaskClient

from models import App


def test_apps_bare_id_route_404(test_client, app_in_workspace, account_token):
    resp = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert resp.status_code == 404


def test_apps_parameters_route_404(test_client, app_in_workspace, account_token):
    resp = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/parameters",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert resp.status_code == 404


def test_apps_info_route_404(test_client, app_in_workspace, account_token):
    resp = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/info",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert resp.status_code == 404


def test_apps_describe_returns_merged_shape(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"]["id"] == app_in_workspace.id
    assert body["info"]["mode"] == "chat"
    assert isinstance(body["parameters"], dict)


def test_apps_describe_full_includes_input_schema(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"] is not None
    assert body["parameters"] is not None
    assert body["input_schema"] is not None
    assert body["input_schema"]["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_apps_describe_fields_info_only(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=info",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"] is not None
    assert body["parameters"] is None
    assert body["input_schema"] is None


def test_apps_describe_fields_parameters_only(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=parameters",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"] is None
    assert body["parameters"] is not None
    assert body["input_schema"] is None


def test_apps_describe_fields_input_schema_only(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=input_schema",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"] is None
    assert body["parameters"] is None
    assert body["input_schema"] is not None


def test_apps_describe_fields_combined(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=info,input_schema",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["info"] is not None
    assert body["parameters"] is None
    assert body["input_schema"] is not None


def test_apps_describe_fields_unknown_returns_422(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=garbage",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 422


def test_apps_describe_fields_extra_param_returns_422(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
):
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/describe?fields=info&page=1",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 422


def test_apps_list_returns_pagination_envelope(
    test_client: FlaskClient,
    workspace_account,
    app_in_workspace: App,
    account_token: str,
):
    _, tenant, _ = workspace_account
    res = test_client.get(
        f"/openapi/v1/apps?workspace_id={tenant.id}&page=1&limit=20",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    body = res.json
    assert body["page"] == 1
    assert body["limit"] == 20
    assert body["total"] >= 1
    assert any(d["id"] == app_in_workspace.id for d in body["data"])


def test_apps_list_requires_workspace_id(test_client: FlaskClient, account_token: str):
    res = test_client.get("/openapi/v1/apps", headers={"Authorization": f"Bearer {account_token}"})
    assert res.status_code == 400


def test_apps_list_tag_no_match_returns_empty_data_not_400(
    test_client: FlaskClient,
    workspace_account,
    app_in_workspace: App,
    account_token: str,
):
    _, tenant, _ = workspace_account
    res = test_client.get(
        f"/openapi/v1/apps?workspace_id={tenant.id}&tag=nonexistent",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    assert res.json["data"] == []


def test_account_sessions_returns_envelope(
    test_client: FlaskClient,
    account_token: str,
):
    res = test_client.get("/openapi/v1/account/sessions", headers={"Authorization": f"Bearer {account_token}"})
    assert res.status_code == 200
    body = res.json
    # canonical envelope shape
    assert isinstance(body["data"], list)
    assert "page" in body
    assert "limit" in body
    assert "total" in body
    assert "has_more" in body
    # the bearer's own minted session must appear
    assert any(s["prefix"] == "dfoa_" for s in body["data"])
    # legacy "sessions" key must NOT appear
    assert "sessions" not in body
