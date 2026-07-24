from __future__ import annotations

from inspect import unwrap

import pytest
from flask import Flask
from werkzeug.exceptions import NotImplemented

from controllers.web import human_input_form as human_input_form_v1
from controllers.web import human_input_form_access_request as human_input_form_v2


def _registered_urls(module) -> set[str]:
    return {
        url
        for _resource, resource_urls, _route_doc, _kwargs in module.web_ns.resources
        for url in resource_urls
    }


def test_v1_and_v2_public_form_routes_are_distinct() -> None:
    urls = _registered_urls(human_input_form_v2)
    v2_form_api = getattr(human_input_form_v2, "HumanInputV2FormApi", None)

    assert "/form/human_input/<string:form_token>" in urls
    assert "/form/human_input/<string:form_token>/upload-token" in urls
    assert "/form/human-input/<string:form_token>" in urls
    assert "/form/human-input/<string:form_token>/access-request" in urls
    assert "/form/human-input/<string:form_token>/upload-token" in urls

    assert v2_form_api is not None
    assert human_input_form_v1.HumanInputFormApi is not v2_form_api


@pytest.mark.parametrize(
    ("resource_name", "method_name", "path", "json_body"),
    [
        ("HumanInputV2FormApi", "get", "/api/form/human-input/token", None),
        (
            "HumanInputV2FormApi",
            "post",
            "/api/form/human-input/token",
            {"inputs": {}, "action": "approve"},
        ),
        (
            "HumanInputV2FormUploadTokenApi",
            "post",
            "/api/form/human-input/token/upload-token",
            None,
        ),
        (
            "FormAccessRequestApi",
            "post",
            "/api/form/human-input/token/access-request",
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
