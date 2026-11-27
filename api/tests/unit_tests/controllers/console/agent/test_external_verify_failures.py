"""Actual HTTP error serialization from real SQL services and a real TCP peer.

The resource adapter enters the admitted handler; Console session/CSRF admission
keeps its existing independent coverage. No successful gateway receipt is injected.
"""

import inspect
from dataclasses import replace

import httpx
import pytest
from flask import Flask
from flask_restx import Namespace, Resource
from sqlalchemy import func, select
from werkzeug.exceptions import Unauthorized

from controllers.console.agent.external import ExternalAgentVerifyApi
from controllers.console.agent.external_errors import ExternalAgentVerificationHTTPError
from extensions.ext_application_services import ApplicationServices
from libs.external_api import ExternalApi, error_responses
from models.external_agent import ExternalAgentVerification
from providers.a2a.control_adapters import DifyExternalIconURLs
from services.external_agents.asset_service import ExternalAssetService
from services.external_agents.contracts import ExternalAgentLimits
from tests.unit_tests.controllers.console.agent.test_external_endpoint_contracts import AdmittedHandler
from tests.unit_tests.providers.a2a.test_gateway import response
from tests.unit_tests.providers.a2a.test_gateway_branches import wire
from tests.unit_tests.repositories.external_agents.test_runtime_repository import uid
from tests.unit_tests.services.external_agents import test_control_plane_applications as control_fixtures
from tests.unit_tests.services.external_agents.test_control_plane_applications import ControlPlane

domain = control_fixtures.domain
control = control_fixtures.control


@pytest.mark.parametrize(
    ("failure", "reason", "subreason"),
    [
        ("service_unavailable", "connection_failed", "remote_service_error"),
        ("bad_request", "connection_failed", None),
        ("not_found", "connection_failed", "invalid_a2a_endpoint"),
        ("gone", "connection_failed", "invalid_a2a_endpoint"),
        ("redirect", "connection_failed", "invalid_a2a_endpoint"),
        ("rate_limited", "connection_failed", "rate_limited"),
        ("unauthorized", "authentication_failed", "authentication_required"),
        ("forbidden", "authentication_failed", "access_denied"),
        ("old_protocol", "unsupported_protocol", "unsupported_protocol_version"),
        ("invalid_card", "invalid_agent_card", "agent_card_field_invalid"),
        ("wrong_content_type", "invalid_agent_card", "invalid_a2a_endpoint"),
        ("invalid_json", "invalid_agent_card", "invalid_a2a_endpoint"),
    ],
)
def test_verify_serves_a_documented_stable_reason_without_peer_content_or_a_proof(
    control: ControlPlane,
    account_application_services: ApplicationServices,
    failure: str,
    reason: str,
    subreason: str | None,
) -> None:
    marker = "private-peer-payload-must-not-be-visible"
    body = {"protocolVersion": "0.3.0", "description": marker} if failure == "old_protocol" else {"description": marker}
    status = {
        "service_unavailable": 503,
        "bad_request": 400,
        "not_found": 404,
        "gone": 410,
        "redirect": 302,
        "rate_limited": 429,
        "unauthorized": 401,
        "forbidden": 403,
    }.get(failure, 200)
    content_type = "text/html" if failure == "wrong_content_type" else "application/a2a+json"
    reply = (
        httpx.Response(200, content=b"not-json", headers={"content-type": "application/json"})
        if failure == "invalid_json"
        else response(body, status=status, content_type=content_type)
    )
    with wire([reply]) as (gateway, connection, peer):
        assets = ExternalAssetService(
            store=control.store,
            access=control.access,
            permissions=control.access,
            reference_access=control.access,
            icons=DifyExternalIconURLs(),
            gateway=gateway,
            secrets=control.secrets,
            clock=control.clock.now,
            new_id=uid,
            limits=ExternalAgentLimits(),
        )
        app = Flask(__name__)
        app.extensions["application_services"] = replace(
            account_application_services,
            external_agents=replace(account_application_services.external_agents, enabled=True, assets=assets),
        )
        api = ExternalApi(app, doc=False)
        namespace = Namespace("external-verify-wire", path="/console/api")
        handler = inspect.unwrap(ExternalAgentVerifyApi.post)
        assert isinstance(handler, AdmittedHandler)

        class VerifyWireResource(Resource):
            @error_responses(ExternalAgentVerificationHTTPError)
            def post(self) -> object:
                return handler(ExternalAgentVerifyApi(), control.context)

        namespace.add_resource(VerifyWireResource, "/external-agents/verify")
        api.add_namespace(namespace)
        with app.test_client() as client:
            result = client.post(
                "/console/api/external-agents/verify",
                json={"endpoint": connection.endpoint, "auth_type": "none", "credential_action": "remove"},
            )
        assert result.status_code == 400
        payload = result.get_json()
        assert payload["code"] == "verification_failed"
        assert payload["details"]["reason"] == reason
        assert payload["details"].get("subreason") == subreason
        if subreason == "agent_card_field_invalid":
            assert {"path": "name", "code": "missing"} in payload["details"]["card_errors"]
            assert len(payload["details"]["card_errors"]) <= 10
        else:
            assert "card_errors" not in payload["details"]
        assert payload["status"] == 400
        assert marker not in result.get_data(as_text=True)
        assert "verification_id" not in payload
        assert len(peer.requests) == 1
        assert peer.requests[0][0] == "GET"
        with control.database[1]() as session:
            assert session.scalar(select(func.count()).select_from(ExternalAgentVerification)) == 0


def test_console_unauthorized_keeps_its_native_401_instead_of_verification_reason() -> None:
    app = Flask(__name__)
    api = ExternalApi(app, doc=False)
    namespace = Namespace("console-login-error", path="/console/api")

    class LoginErrorResource(Resource):
        def get(self) -> None:
            raise Unauthorized("Console authentication is required.")

    namespace.add_resource(LoginErrorResource, "/login-error")
    api.add_namespace(namespace)
    with app.test_client() as client:
        result = client.get("/console/api/login-error")
    assert result.status_code == 401
    assert result.get_json() == {
        "code": "unauthorized",
        "message": "Console authentication is required.",
        "status": 401,
    }
