"""Swagger JSON rendering tests for Flask-RESTX API blueprints."""

import pytest
from flask import Flask


def _definition_refs(value: object) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/definitions/"):
            refs.add(ref.removeprefix("#/definitions/"))
        for item in value.values():
            refs.update(_definition_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.update(_definition_refs(item))
    return refs


@pytest.mark.parametrize(
    ("first_kwargs", "second_kwargs"),
    [
        ({"min_items": 1}, {"min_items": 2}),
        ({"max_items": 1}, {"max_items": 2}),
        ({"unique": True}, {"unique": False}),
    ],
)
def test_inline_model_name_includes_list_constraints(
    first_kwargs: dict[str, object],
    second_kwargs: dict[str, object],
):
    from flask_restx import fields

    from libs.flask_restx_compat import _inline_model_name

    first_inline_model: dict[object, object] = {"items": fields.List(fields.String, **first_kwargs)}
    second_inline_model: dict[object, object] = {"items": fields.List(fields.String, **second_kwargs)}

    assert _inline_model_name(first_inline_model) != _inline_model_name(second_inline_model)


def test_swagger_json_endpoints_render(monkeypatch: pytest.MonkeyPatch):
    from configs import dify_config
    from controllers.console import bp as console_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp

    monkeypatch.setattr(dify_config, "SWAGGER_UI_ENABLED", True)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(service_api_bp)

    client = app.test_client()

    for route in ("/console/api/swagger.json", "/api/swagger.json", "/v1/swagger.json"):
        response = client.get(route)

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["swagger"] == "2.0"
        assert "paths" in payload
        assert "definitions" in payload
        assert isinstance(payload["definitions"], dict)
        missing_refs = _definition_refs(payload) - set(payload["definitions"])
        assert not sorted(ref for ref in missing_refs if ref.startswith("_AnonymousInlineModel"))

    assert app.config["RESTX_INCLUDE_ALL_MODELS"] is True
