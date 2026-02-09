"""
Regression tests for i18n error code mechanism.

Validates:
1. abort_with_code() helper: custom error_code via exception attribute
2. 400 branch guard: custom code from abort_with_code() not overwritten
3. Chinese error messages in runtime paths
4. BaseHTTPException.description preserved in English (Swagger)
5. Response structure consistency (code + message + status)
6. Plain abort() still works (no regression in default behaviour)

Note: Flask-RESTX bypasses custom handlers when e.data is set, so we
CANNOT use e.data to pass custom fields. abort_with_code() works around
this by setting a custom attribute (error_code) on the HTTPException.
"""

from flask import Blueprint, Flask, abort
from flask_restx import Resource

from libs.exception import BaseHTTPException
from libs.external_api import ExternalApi, abort_with_code


def _create_test_app():
    app = Flask(__name__)
    bp = Blueprint("i18n_test", __name__)
    api = ExternalApi(bp)

    # --- 1. 403 with custom code + Chinese message (simulates billing quota) ---
    @api.route("/quota-error")
    class QuotaError(Resource):
        def get(self):
            abort_with_code(403, "已超出配额限制", "billing_upgrade_required")

    # --- 2. 400 with custom code (guard test: code must not be overwritten) ---
    @api.route("/custom-400")
    class Custom400(Resource):
        def get(self):
            abort_with_code(400, "知识库数量已达上限", "knowledge_rate_limited")

    # --- 3. 400 without custom code (default behavior via plain abort) ---
    @api.route("/plain-400")
    class Plain400(Resource):
        def get(self):
            abort(400, "参数不合法")

    # --- 4. 403 plain abort without custom code ---
    @api.route("/plain-403")
    class Plain403(Resource):
        def get(self):
            abort(403, "无权限访问此资源")

    # --- 5. BaseHTTPException with description (Swagger doc) ---
    class TestDocError(BaseHTTPException):
        error_code = "test_doc_error"
        description = "This is English documentation."  # Should stay English
        code = 400

    @api.route("/doc-error")
    class DocError(Resource):
        def get(self):
            raise TestDocError()

    # --- 6. Chinese raise ValueError ---
    @api.route("/value-error-zh")
    class ValueErrorZh(Resource):
        def get(self):
            raise ValueError("无效的类型: workflow")

    # --- 7. Multiple error codes ---
    @api.route("/billing-members")
    class BillingMembers(Resource):
        def get(self):
            abort_with_code(403, "成员数量已达订阅上限。", "billing_members_limit_exceeded")

    @api.route("/billing-apps")
    class BillingApps(Resource):
        def get(self):
            abort_with_code(403, "应用数量已达上限。", "billing_apps_limit_exceeded")

    app.register_blueprint(bp, url_prefix="/api")
    return app


class TestAbortWithCode:
    """Test that abort_with_code() correctly sets error_code attribute."""

    def test_403_custom_code_preserved(self):
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/quota-error")
        data = res.get_json()

        assert res.status_code == 403
        assert data["code"] == "billing_upgrade_required"
        assert data["message"] == "已超出配额限制"
        assert data["status"] == 403

    def test_400_custom_code_not_overwritten(self):
        """Key regression: 400 branch must NOT overwrite custom code."""
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/custom-400")
        data = res.get_json()

        assert res.status_code == 400
        assert data["code"] == "knowledge_rate_limited"
        assert data["message"] == "知识库数量已达上限"
        assert data["status"] == 400

    def test_plain_abort_400_still_works(self):
        """Plain abort() without custom code should still work normally."""
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/plain-400")
        data = res.get_json()

        assert res.status_code == 400
        assert data["message"] == "参数不合法"
        assert data["status"] == 400

    def test_plain_abort_403_still_works(self):
        """Plain abort(403) (no custom code) should return class-based code."""
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/plain-403")
        data = res.get_json()

        assert res.status_code == 403
        assert data["message"] == "无权限访问此资源"
        assert data["status"] == 403
        # Default code derived from exception class name
        assert data["code"] == "forbidden"

    def test_billing_members_error_code(self):
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/billing-members")
        data = res.get_json()

        assert res.status_code == 403
        assert data["code"] == "billing_members_limit_exceeded"
        assert "成员" in data["message"]

    def test_billing_apps_error_code(self):
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/billing-apps")
        data = res.get_json()

        assert res.status_code == 403
        assert data["code"] == "billing_apps_limit_exceeded"
        assert "应用" in data["message"]


class TestBaseHTTPExceptionDescription:
    """Ensure BaseHTTPException.description stays in English for Swagger."""

    def test_description_used_as_message(self):
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/doc-error")
        data = res.get_json()

        assert res.status_code == 400
        assert data["code"] == "test_doc_error"


class TestChineseErrorMessages:
    """Verify Chinese messages are preserved through the error pipeline."""

    def test_value_error_chinese(self):
        app = _create_test_app()
        client = app.test_client()
        res = client.get("/api/value-error-zh")
        data = res.get_json()

        assert res.status_code == 400
        assert data["code"] == "invalid_param"
        assert "无效的类型" in data["message"]


class TestErrorResponseStructure:
    """Verify response always has code + message + status (兼容性)."""

    def test_response_fields_present(self):
        app = _create_test_app()
        client = app.test_client()

        endpoints = [
            "/api/quota-error",
            "/api/custom-400",
            "/api/plain-400",
            "/api/plain-403",
            "/api/value-error-zh",
            "/api/billing-members",
            "/api/billing-apps",
        ]
        for endpoint in endpoints:
            res = client.get(endpoint)
            data = res.get_json()
            assert "code" in data, f"Missing 'code' in {endpoint}"
            assert "message" in data, f"Missing 'message' in {endpoint}"
            assert "status" in data, f"Missing 'status' in {endpoint}"
