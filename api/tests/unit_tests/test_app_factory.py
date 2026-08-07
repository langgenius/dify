"""Enterprise license gating performed by the global ``before_request`` hook."""

from unittest.mock import patch

import pytest
from flask import Blueprint, Flask
from flask_restx import Resource

from app_factory import create_flask_app_with_configs
from enums import DeploymentEdition
from libs.external_api import ExternalApi
from services.entities.feature_entities import LicenseStatus

INVALID_STATUSES = [LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST]
VALID_STATUSES = [LicenseStatus.ACTIVE, LicenseStatus.EXPIRING]


def _license(status: LicenseStatus | None):
    return patch("app_factory.EnterpriseService.get_cached_license_status", return_value=status)


def _enterprise():
    return patch("app_factory.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)


def _community():
    return patch("app_factory.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)


@pytest.fixture
def gated_app() -> Flask:
    app = create_flask_app_with_configs()

    @app.route("/v1/chat-messages", methods=["POST"])
    def service_api_route():
        return {"surface": "service_api"}

    @app.route("/v1/")
    def service_api_index_route():
        return {"surface": "service_api_index"}

    @app.route("/mcp/server/<server_code>/mcp", methods=["POST"])
    def mcp_route(server_code: str):
        return {"surface": "mcp"}

    @app.route("/triggers/webhook/<webhook_id>", methods=["POST"])
    def trigger_route(webhook_id: str):
        return {"surface": "triggers"}

    @app.route("/console/api/apps")
    def console_route():
        return {"surface": "console"}

    @app.route("/console/api/login", methods=["POST"])
    def console_bootstrap_route():
        return {"surface": "console_bootstrap"}

    @app.route("/api/messages")
    def webapp_route():
        return {"surface": "webapp"}

    @app.route("/api/system-features")
    def webapp_bootstrap_route():
        return {"surface": "webapp_bootstrap"}

    @app.route("/health")
    def health_route():
        return {"surface": "health"}

    @app.route("/inner/api/rbac/check-access", methods=["POST"])
    def inner_api_route():
        return {"surface": "inner_api"}

    @app.route("/files/upload/for-plugin", methods=["POST"])
    def files_route():
        return {"surface": "files"}

    return app


class TestServiceApiLicenseGate:
    """/v1 is a bearer-token surface, so it is gated with an opaque 403."""

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_blocks_when_license_invalid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 403

    def test_block_response_carries_machine_readable_marker(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert b"license_required" in response.data

    def test_block_response_does_not_leak_license_status(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert b"expired" not in response.data.lower()

    def test_blocks_when_license_status_unavailable(self, gated_app: Flask):
        with _enterprise(), _license(None):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 403

    def test_blocks_when_license_lookup_raises(self, gated_app: Flask):
        lookup_failed = patch(
            "app_factory.EnterpriseService.get_cached_license_status",
            side_effect=RuntimeError("enterprise api unreachable"),
        )
        with _enterprise(), lookup_failed:
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 403

    def test_blocks_index_route(self, gated_app: Flask):
        """/v1 has no sign-in page to bootstrap, so nothing on it is exempt."""
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().get("/v1/")

        assert response.status_code == 403

    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_allows_when_license_valid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 200

    def test_allows_unclassified_status(self, gated_app: Flask):
        """LicenseStatus.NONE is not in the blocked set — parity with console/webapp."""
        with _enterprise(), _license(LicenseStatus.NONE):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 200

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_does_not_gate_community_edition(self, gated_app: Flask, status: LicenseStatus):
        with _community(), _license(status):
            response = gated_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 200


class TestMcpLicenseGate:
    """/mcp invokes apps for external MCP clients, so it is gated like the Service API."""

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_blocks_when_license_invalid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/mcp/server/srv-code/mcp")

        assert response.status_code == 403

    def test_block_response_carries_machine_readable_marker(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/mcp/server/srv-code/mcp")

        assert b"license_required" in response.data

    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_allows_when_license_valid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/mcp/server/srv-code/mcp")

        assert response.status_code == 200

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_does_not_gate_community_edition(self, gated_app: Flask, status: LicenseStatus):
        with _community(), _license(status):
            response = gated_app.test_client().post("/mcp/server/srv-code/mcp")

        assert response.status_code == 200


class TestTriggerLicenseGate:
    """Inbound webhooks are refused so senders retry, rather than dropping events."""

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_blocks_when_license_invalid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/triggers/webhook/hook-id")

        assert response.status_code == 503

    def test_block_response_carries_machine_readable_marker(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/triggers/webhook/hook-id")

        assert b"license_required" in response.data

    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_allows_when_license_valid(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().post("/triggers/webhook/hook-id")

        assert response.status_code == 200

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_does_not_gate_community_edition(self, gated_app: Flask, status: LicenseStatus):
        with _community(), _license(status):
            response = gated_app.test_client().post("/triggers/webhook/hook-id")

        assert response.status_code == 200


class TestGateThroughRealErrorHandlers:
    """Gate errors must survive each blueprint's error handling: flask-restx vs plain Flask."""

    @pytest.fixture
    def wired_app(self) -> Flask:
        app = create_flask_app_with_configs()

        service_api_bp = Blueprint("service_api_test", __name__, url_prefix="/v1")
        api = ExternalApi(service_api_bp)

        @api.route("/chat-messages")
        class ChatMessages(Resource):
            def post(self):
                return {"surface": "service_api"}

        app.register_blueprint(service_api_bp)

        trigger_bp = Blueprint("trigger_test", __name__, url_prefix="/triggers")

        @trigger_bp.route("/webhook/<webhook_id>", methods=["POST"])
        def webhook_route(webhook_id: str):
            return {"surface": "triggers"}

        app.register_blueprint(trigger_bp)
        return app

    def test_service_api_block_is_json_with_license_marker(self, wired_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = wired_app.test_client().post("/v1/chat-messages")

        assert response.status_code == 403
        body = response.get_json()
        assert body["message"] == "license_required"
        assert body["status"] == 403

    def test_service_api_block_does_not_clear_cookies(self, wired_app: Flask):
        """Force-logout cookie clearing belongs to the cookie-authed surfaces only."""
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = wired_app.test_client().post("/v1/chat-messages")

        assert response.headers.getlist("Set-Cookie") == []

    def test_trigger_block_survives_plain_blueprint_handling(self, wired_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = wired_app.test_client().post("/triggers/webhook/hook-id")

        assert response.status_code == 503
        assert b"license_required" in response.data

    def test_surfaces_are_reachable_when_license_valid(self, wired_app: Flask):
        with _enterprise(), _license(LicenseStatus.ACTIVE):
            service_api = wired_app.test_client().post("/v1/chat-messages")
            triggers = wired_app.test_client().post("/triggers/webhook/hook-id")

        assert service_api.status_code == 200
        assert triggers.status_code == 200


class TestUngatedSurfaces:
    """Surfaces that must stay reachable while the license is invalid."""

    def test_inner_api_is_not_gated(self, gated_app: Flask):
        """dify-enterprise control plane — gating it could block license recovery itself."""
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/inner/api/rbac/check-access")

        assert response.status_code == 200

    def test_files_data_plane_is_not_gated(self, gated_app: Flask):
        """Signed file URLs are fetched by the plugin daemon and by LLM vendors."""
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/files/upload/for-plugin")

        assert response.status_code == 200


class TestSessionSurfaceLicenseGate:
    """Console and webapp are cookie-authed, so they keep force-logout 401 semantics."""

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_blocks_console_with_force_logout(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().get("/console/api/apps")

        assert response.status_code == 401

    @pytest.mark.parametrize("status", INVALID_STATUSES)
    def test_blocks_webapp_with_force_logout(self, gated_app: Flask, status: LicenseStatus):
        with _enterprise(), _license(status):
            response = gated_app.test_client().get("/api/messages")

        assert response.status_code == 401

    def test_console_bootstrap_route_stays_reachable(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().post("/console/api/login")

        assert response.status_code == 200

    def test_webapp_bootstrap_route_stays_reachable(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().get("/api/system-features")

        assert response.status_code == 200

    def test_health_route_is_never_gated(self, gated_app: Flask):
        with _enterprise(), _license(LicenseStatus.EXPIRED):
            response = gated_app.test_client().get("/health")

        assert response.status_code == 200
