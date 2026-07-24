from __future__ import annotations

from inspect import unwrap

import pytest
from flask import Flask
from werkzeug.exceptions import NotImplemented

from controllers.service_api.app import human_input_form as human_input_form_module


def test_v1_and_v2_service_form_routes_are_distinct() -> None:
    urls = {
        url
        for _resource, resource_urls, _route_doc, _kwargs in human_input_form_module.service_api_ns.resources
        for url in resource_urls
    }
    v2_form_api = getattr(human_input_form_module, "WorkflowHumanInputV2FormApi", None)

    assert "/form/human_input/<string:form_token>" in urls
    assert "/form/human-input/<string:form_token>" in urls
    assert v2_form_api is not None
    assert human_input_form_module.WorkflowHumanInputFormApi is not v2_form_api


def test_v2_service_get_requires_query_user(app: Flask) -> None:
    resource_cls = getattr(human_input_form_module, "WorkflowHumanInputV2FormApi", None)
    assert resource_cls is not None
    get_method = resource_cls.get
    user_doc = getattr(get_method, "__apidoc__", {})["params"]["user"]

    assert user_doc["required"] is True

    with app.test_request_context("/v1/form/human-input/token?user=end-user", method="GET"):
        with pytest.raises(NotImplemented):
            unwrap(get_method)(
                resource_cls(),
                app_model=object(),
                end_user=object(),
                form_token="token",
            )


def test_v2_service_post_uses_independent_payload(app: Flask) -> None:
    resource_cls = getattr(human_input_form_module, "WorkflowHumanInputV2FormApi", None)
    assert resource_cls is not None
    post_method = resource_cls.post

    with app.test_request_context(
        "/v1/form/human-input/token",
        method="POST",
        json={"user": "end-user", "inputs": {}, "action": "approve"},
    ):
        with pytest.raises(NotImplemented):
            unwrap(post_method)(
                resource_cls(),
                app_model=object(),
                end_user=object(),
                form_token="token",
            )
