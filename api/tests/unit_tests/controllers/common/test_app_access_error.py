import json
from collections.abc import Callable, Iterator
from typing import Literal
from uuid import UUID

import pytest
from flask import Blueprint, Flask, Response
from flask.typing import ResponseReturnValue
from flask_restx import Resource
from werkzeug.exceptions import NotFound
from werkzeug.middleware.proxy_fix import ProxyFix

from configs import dify_config
from controllers.common.app_access_error import register_app_access_error_metadata
from libs.exception import BaseHTTPException
from libs.external_api import ExternalApi

APP_ID = "9d6e3fb3-94ce-48f9-a958-58ca80b1c02e"
TRUSTED = "172.18.0.0/16,10.0.0.0/8,2400:cb00::/32"
WEB_IDENTITIES = ("/site", "/parameters", "/meta", "/passport", "/login/status", "/webapp/access-mode")
CONSOLE_IDENTITIES = (
    "/apps/<uuid:app_id>",
    "/agent/<uuid:agent_id>",
    "/installed-apps/<uuid:installed_app_id>",
    "/installed-apps/<uuid:installed_app_id>/parameters",
    "/installed-apps/<uuid:installed_app_id>/meta",
    "/trial-apps/<uuid:app_id>",
    "/trial-apps/<uuid:app_id>/parameters",
)
OTHER_ROUTES = (
    "/chat-messages",
    "/form/human_input/<string:form_token>",
    "/form/human_input/<string:form_token>/upload-token",
    "/human-input-forms/files",
    "/conversations/<uuid:conversation_id>",
    "/apps/<uuid:app_id>/workflows/<uuid:workflow_id>",
    "/agent/<uuid:agent_id>/versions/<uuid:version_id>",
    "/installed-apps/<uuid:installed_app_id>/conversations",
    "/trial-apps/<uuid:app_id>/workflows",
)


class AppNotFoundError(BaseHTTPException):
    error_code = "app_not_found"
    code = 404
    description = "App not found."


class AgentNotFoundError(NotFound):
    description = "Agent not found."


def _missing_app() -> ResponseReturnValue:
    raise NotFound("App not found.")


def _create_app(responder: Callable[[], ResponseReturnValue] = _missing_app, *, use_proxy_fix: bool = False) -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    if use_proxy_fix:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)
    for surface, prefix in (("web", "/api"), ("console", "/console/api"), ("service", "/v1")):
        bp = Blueprint(surface, __name__, url_prefix=prefix)
        if surface == "web":
            register_app_access_error_metadata(bp, surface="web")
        elif surface == "console":
            register_app_access_error_metadata(bp, surface="console")
        api = ExternalApi(bp)

        class AppResource(Resource):
            def get(self, **_kwargs: str | UUID) -> ResponseReturnValue:
                return responder()

            def post(self, **_kwargs: str | UUID) -> ResponseReturnValue:
                return responder()

        # Include the opposite surface's identity paths to prove the allowlists
        # are independent, not broad suffix/path matches.
        api.add_resource(AppResource, *WEB_IDENTITIES, *CONSOLE_IDENTITIES, *OTHER_ROUTES)
        app.register_blueprint(bp)
    return app


def _path(rule: str) -> str:
    for name in ("app_id", "agent_id", "installed_app_id", "workflow_id", "conversation_id", "version_id"):
        rule = rule.replace(f"<uuid:{name}>", APP_ID)
    return rule.replace("<string:form_token>", "missing-form-token")


@pytest.fixture(autouse=True)
def _trusted_proxies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "NETWORK_ACCESS_TRUSTED_PROXY_CIDRS", TRUSTED)


@pytest.mark.parametrize("rule", WEB_IDENTITIES)
def test_web_app_identity_404s_receive_metadata(rule: str) -> None:
    response = _create_app().test_client().get("/api" + rule, environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    assert response.status_code == 404
    assert response.get_json() == {
        "code": "app_not_found",
        "message": "App not found.",
        "status": 404,
        "client_ip": "203.0.113.42",
    }
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("rule", CONSOLE_IDENTITIES)
def test_console_app_identity_404s_receive_metadata(rule: str) -> None:
    response = (
        _create_app().test_client().get("/console/api" + _path(rule), environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    )
    assert response.status_code == 404
    assert response.get_json()["client_ip"] == "203.0.113.42"
    assert response.get_json()["code"] == "not_found"


@pytest.mark.parametrize("prefix", ["/api", "/console/api"])
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_typed_app_not_found_keeps_exception_payload_after_restx_formatting(prefix: str, method: str) -> None:
    def missing() -> ResponseReturnValue:
        error = AppNotFoundError()
        assert error.data is not None
        error.data["detail"] = {"reason": "unavailable"}
        raise error

    response = (
        _create_app(missing)
        .test_client()
        .open(prefix + "/chat-messages", method=method, environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    )
    assert response.status_code == 404
    expected: dict[str, object] = {
        "code": "app_not_found",
        "message": "App not found.",
        "status": 404,
        "client_ip": "203.0.113.42",
    }
    if prefix == "/console/api":
        expected["detail"] = {"reason": "unavailable"}
    assert response.get_json() == expected


def test_agent_error_code_is_not_reclassified() -> None:
    def missing() -> ResponseReturnValue:
        raise AgentNotFoundError()

    response = (
        _create_app(missing)
        .test_client()
        .get(f"/console/api/agent/{APP_ID}", environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    )
    assert response.status_code == 404
    assert response.get_json()["code"] == "agent_not_found_error"
    assert response.get_json()["message"] == "Agent not found."
    assert response.get_json()["client_ip"] == "203.0.113.42"


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        ("203.0.113.42", "192.0.2.1, invalid", "203.0.113.42"),
        ("2001:db8::42", "192.0.2.1", "2001:db8::42"),
        ("::ffff:203.0.113.42", "192.0.2.1", "203.0.113.42"),
        ("172.18.0.2", "192.0.2.1, 203.0.113.42, 10.2.3.4", "203.0.113.42"),
        ("172.18.0.2", "2001:0db8::42, 2400:cb00::1, 10.2.3.4", "2001:db8::42"),
        ("::ffff:172.18.0.2", "::ffff:203.0.113.42, ::ffff:10.2.3.4", "203.0.113.42"),
    ],
)
@pytest.mark.parametrize("use_proxy_fix", [False, True])
def test_trust_boundary_ignores_spoofed_arguments_and_headers(
    peer: str, forwarded: str, expected: str, use_proxy_fix: bool
) -> None:
    response = (
        _create_app(use_proxy_fix=use_proxy_fix)
        .test_client()
        .get(
            "/api/site?client_ip=192.0.2.123&app_code=does-not-exist",
            json={"client_ip": "192.0.2.124"},
            headers={"X-Forwarded-For": forwarded, "X-Real-IP": "192.0.2.125", "CF-Connecting-IP": "192.0.2.126"},
            environ_overrides={"REMOTE_ADDR": peer},
        )
    )
    assert response.status_code == 404
    assert response.get_json()["client_ip"] == expected


@pytest.mark.parametrize("config", ["", " ", "not-a-cidr", "172.18.0.1/16", "172.18.0.0/16,"])
def test_missing_or_invalid_trust_configuration_preserves_original_404(
    monkeypatch: pytest.MonkeyPatch, config: str
) -> None:
    monkeypatch.setattr(dify_config, "NETWORK_ACCESS_TRUSTED_PROXY_CIDRS", config)
    response = (
        _create_app()
        .test_client()
        .get("/api/site", environ_overrides={"REMOTE_ADDR": "172.18.0.2", "HTTP_X_FORWARDED_FOR": "203.0.113.42"})
    )
    assert response.status_code == 404
    assert response.get_json() == {"code": "app_not_found", "message": "App not found.", "status": 404}
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("forwarded", [None, "", "unknown", "192.0.2.1, invalid", "10.2.3.4", "192.0.2.1," * 33])
def test_unavailable_client_ip_never_exposes_internal_peer_or_changes_status(forwarded: str | None) -> None:
    environ = {"REMOTE_ADDR": "172.18.0.2"}
    if forwarded is not None:
        environ["HTTP_X_FORWARDED_FOR"] = forwarded
    response = _create_app().test_client().get("/api/site", environ_overrides=environ)
    assert response.status_code == 404
    assert "client_ip" not in response.get_json()
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("config", ["", "not-a-cidr", TRUSTED])
def test_unavailable_client_ip_removes_existing_unverified_metadata(
    monkeypatch: pytest.MonkeyPatch, config: str
) -> None:
    monkeypatch.setattr(dify_config, "NETWORK_ACCESS_TRUSTED_PROXY_CIDRS", config)
    payload = {
        "code": "app_not_found",
        "message": "missing",
        "status": 404,
        "client_ip": "192.0.2.123",
        "extra": "kept",
    }
    response = (
        _create_app(lambda: (payload, 404))
        .test_client()
        .get("/api/site", environ_overrides={"REMOTE_ADDR": "172.18.0.2"})
    )
    assert response.status_code == 404
    assert response.get_json() == {"code": "app_not_found", "message": "App not found.", "status": 404}
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("prefix", ["/api", "/console/api"])
@pytest.mark.parametrize("rule", [rule for rule in OTHER_ROUTES if "human_input" in rule or "human-input" in rule])
def test_typed_app_not_found_on_human_input_forms_is_unchanged(prefix: str, rule: str) -> None:
    def missing() -> ResponseReturnValue:
        raise AppNotFoundError()

    response = _create_app(missing).test_client().get(prefix + _path(rule))
    assert response.status_code == 404
    assert response.get_json() == {"code": "app_not_found", "message": "App not found.", "status": 404}
    assert "Cache-Control" not in response.headers


def test_response_metadata_is_request_local_and_disables_shared_caching() -> None:
    payload = {"code": "app_not_found", "message": "missing", "status": 404, "extra": ["kept"]}
    client = _create_app(
        lambda: (payload, 404, {"Cache-Control": "public, max-age=600", "X-Custom": "kept"})
    ).test_client()
    for peer in ("203.0.113.42", "2001:db8::43", "172.18.0.2"):
        response = client.get("/api/site", environ_overrides={"REMOTE_ADDR": peer})
        assert response.get_json().get("client_ip") == (None if peer == "172.18.0.2" else peer)
        assert "extra" not in response.get_json()
        assert response.headers["Cache-Control"] == "no-store"
        assert response.headers["X-Custom"] == "kept"
    assert "client_ip" not in payload


@pytest.mark.parametrize("prefix", ["/api", "/console/api"])
@pytest.mark.parametrize("rule", OTHER_ROUTES)
def test_unrelated_resource_and_human_input_form_404s_are_unchanged(prefix: str, rule: str) -> None:
    response = _create_app().test_client().get(prefix + _path(rule))
    assert response.status_code == 404
    if prefix == "/api" and rule.startswith("/form/human_input/"):
        assert response.get_json() == {"code": "not_found", "message": "Form not found", "status": 404}
        assert response.headers["Cache-Control"] == "no-store"
    else:
        assert response.get_json() == {"code": "not_found", "message": "App not found.", "status": 404}
        assert "Cache-Control" not in response.headers


@pytest.mark.parametrize("code", ["app_unavailable", "agent_not_published"])
@pytest.mark.parametrize("route", WEB_IDENTITIES)
def test_web_unavailable_and_unpublished_identity_uses_same_404(code: str, route: str) -> None:
    payload = {"code": code, "message": "private configuration details", "status": 400, "app_name": "private"}
    response = (
        _create_app(lambda: (payload, 400))
        .test_client()
        .get("/api" + route, environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    )
    assert response.status_code == 404
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.data == (
        b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
    )


@pytest.mark.parametrize("code", ["not_found", "app_not_found", "agent_not_found_error"])
def test_web_missing_identity_has_one_minimal_canonical_wire_contract(code: str) -> None:
    payload = {"code": code, "message": "private cause", "status": 404, "policy_id": "private", "app_name": "private"}
    response = (
        _create_app(lambda: (payload, 404))
        .test_client()
        .get("/api/passport", environ_overrides={"REMOTE_ADDR": "203.0.113.42"})
    )
    assert response.data == (
        b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
    )
    assert response.headers["Content-Type"] == "application/json"


def test_hitl_upload_invalid_token_keeps_native_contract_without_ip() -> None:
    payload = {"code": "invalid_upload_token", "message": "private cause", "status": 403, "client_ip": "192.0.2.1"}
    response = _create_app(lambda: (payload, 403)).test_client().post("/api/human-input-forms/files")
    assert response.status_code == 403
    assert response.data == (
        b'{"code":"invalid_upload_token","message":"Upload token is invalid or expired.","status":403}'
    )
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Type"] == "application/json"


@pytest.mark.parametrize("prefix", ["/api", "/console/api"])
@pytest.mark.parametrize("status", [200, 400, 401, 403, 503])
def test_success_and_non_404_errors_are_unchanged(prefix: str, status: int) -> None:
    # Even an inconsistent error code cannot override the HTTP status contract.
    payload = {"code": "app_not_found", "message": "unchanged", "status": status}
    response = _create_app(lambda: (payload, status)).test_client().get(prefix + "/site")
    assert response.status_code == status
    assert response.get_json() == payload
    assert "Cache-Control" not in response.headers


def test_trial_forbidden_is_not_reclassified_as_missing_app() -> None:
    payload = {"code": "forbidden", "message": "App unavailable", "status": 403}
    response = _create_app(lambda: (payload, 403)).test_client().get(f"/console/api/trial-apps/{APP_ID}")
    assert response.status_code == 403
    assert response.get_json() == payload
    assert "Cache-Control" not in response.headers


@pytest.mark.parametrize("prefix", ["/api", "/console/api"])
def test_non_get_untyped_identity_404_is_unchanged(prefix: str) -> None:
    response = _create_app().test_client().post(prefix + "/site")
    assert response.status_code == 404
    assert "client_ip" not in response.get_json()
    assert "Cache-Control" not in response.headers


@pytest.mark.parametrize(
    "path", ["/api/unknown", "/console/api/unknown", "/api/site/unknown", "/console/api/apps/not-a-uuid", "/elsewhere"]
)
def test_unknown_routes_preserve_default_html_not_found(path: str) -> None:
    response = _create_app().test_client().get(path)
    assert response.status_code == 404
    assert response.mimetype == "text/html"
    assert "Cache-Control" not in response.headers


@pytest.mark.parametrize("path", [f"/api/apps/{APP_ID}", "/console/api/site", "/v1/site", f"/v1/apps/{APP_ID}"])
def test_identity_allowlist_does_not_leak_between_surfaces(path: str) -> None:
    response = _create_app().test_client().get(path)
    assert response.status_code == 404
    assert "client_ip" not in response.get_json()
    assert "Cache-Control" not in response.headers


def test_typed_service_api_error_is_unchanged() -> None:
    def missing() -> ResponseReturnValue:
        raise AppNotFoundError()

    response = _create_app(missing).test_client().get("/v1/chat-messages")
    assert response.status_code == 404
    assert response.get_json()["code"] == "app_not_found"
    assert "client_ip" not in response.get_json()
    assert "Cache-Control" not in response.headers


@pytest.mark.parametrize("kind", ["stream", "passthrough", "html", "list", "null", "invalid-json"])
def test_non_json_object_and_streamed_responses_are_not_consumed(kind: str) -> None:
    consumed: list[bool] = []

    def respond() -> Response:
        if kind in {"stream", "passthrough"}:

            def stream() -> Iterator[str]:
                consumed.append(True)
                yield '{"code":"app_not_found"}'

            return Response(stream(), 404, mimetype="application/json", direct_passthrough=kind == "passthrough")
        if kind == "html":
            return Response("<h1>Missing</h1>", 404, mimetype="text/html")
        data = {"list": json.dumps([{"code": "app_not_found"}]), "null": "null", "invalid-json": "{"}[kind]
        return Response(data, 404, mimetype="application/json")

    app = _create_app(respond)
    with app.test_request_context("/api/site", environ_overrides={"REMOTE_ADDR": "203.0.113.42"}):
        response = app.full_dispatch_request()
        assert response.status_code == 404
        assert "Cache-Control" not in response.headers
        assert not consumed


@pytest.mark.parametrize("surface", ["web", "console"])
def test_production_blueprints_register_metadata_hook_and_all_identity_rules(
    surface: Literal["web", "console"],
) -> None:
    if surface == "web":
        from controllers.web import bp

        routes = WEB_IDENTITIES
    else:
        from controllers.console import bp

        routes = CONSOLE_IDENTITIES
    assert any(hook.__name__ == "add_app_access_error_metadata" for hook in bp.after_request_funcs[None])
    app = Flask(__name__)
    app.register_blueprint(bp)
    actual_rules = {rule.rule for rule in app.url_map.iter_rules()}
    assert bp.url_prefix is not None
    assert {bp.url_prefix + route for route in routes} <= actual_rules
