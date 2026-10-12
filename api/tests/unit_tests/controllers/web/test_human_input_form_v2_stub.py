from __future__ import annotations

from inspect import unwrap

import pytest
from flask import Flask
from werkzeug.exceptions import NotImplemented

from controllers.web import human_input_form_access_request as human_input_form_v2
from libs.external_api import ExternalApi


@pytest.mark.parametrize(
    ("method", "suffix", "json_body"),
    [("GET", "", None), ("POST", "", {"inputs": {}, "action": "approve"}), ("POST", "/upload-token", None)],
)
def test_v2_public_form_uses_explicit_public_path(app: Flask, method, suffix, json_body) -> None:
    ExternalApi(app).add_namespace(human_input_form_v2.web_ns)
    client = app.test_client()
    response = client.open(f"/form/human-input/v2/public/token{suffix}", method=method, json=json_body)
    assert response.status_code == 501
    old_route = client.open(f"/form/human-input/token{suffix}", method=method, json=json_body)
    assert old_route.status_code == 404


@pytest.mark.parametrize(
    ("resource_name", "method_name", "path", "json_body"),
    [
        ("HumanInputV2FormApi", "get", "/api/form/human-input/v2/public/token", None),
        (
            "HumanInputV2FormApi",
            "post",
            "/api/form/human-input/v2/public/token",
            {"inputs": {}, "action": "approve"},
        ),
        (
            "HumanInputV2FormUploadTokenApi",
            "post",
            "/api/form/human-input/v2/public/token/upload-token",
            None,
        ),
    ],
)
def test_v2_public_form_routes_are_exposed_as_independent_stubs(
    app: Flask,
    resource_name: str,
    method_name: str,
    path: str,
    json_body: dict[str, object] | None,
) -> None:
    resource_cls = getattr(human_input_form_v2, resource_name, None)
    assert resource_cls is not None
    method = getattr(resource_cls, method_name)

    with app.test_request_context(path, method=method_name.upper(), json=json_body):
        with pytest.raises(NotImplemented):
            unwrap(method)(resource_cls(), form_token="token")
