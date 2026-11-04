"""Console full-draft credential preflight and test execution errors."""

from collections.abc import Callable
from functools import wraps

from flask_restx import Resource

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import document_errors
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from services.workflow_test_credentials import BuilderScope, TestCredentialNotReadyError, TestCredentialReadiness


class TestCredentialsNotReadyError(BaseHTTPException):
    code = 400
    error_code = "test_credentials_not_ready"
    description = "Required test credentials are not ready."
    details_model = TestCredentialReadiness


def test_credential_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except TestCredentialNotReadyError as exc:
            error = TestCredentialsNotReadyError()
            assert error.data is not None
            error.data["details"] = exc.result.model_dump(mode="json")
            raise error from exc

    return document_errors(wrapped, TestCredentialsNotReadyError)


class TestCredentialPreflightResponse(TestCredentialReadiness, ResponseModel):
    pass


register_response_schema_models(console_ns, TestCredentialPreflightResponse)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/test-credentials/preflight")
class TestCredentialPreflightApi(Resource):
    @console_ns.doc(
        description="Check all EndUser test credentials in the current saved draft. "
        "No request body or draft hash is required. Returns readiness without creating a Run or executing tools; "
        "existing workspace OAuth credentials may be refreshed. Actual test execution checks credentials again."
    )
    @console_ns.response(
        200, "Full draft test credential readiness", console_ns.models[TestCredentialPreflightResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp()))
    @with_current_tenant_id
    def post(self, current_tenant_id: str, app_id: str):
        account, _ = current_account_with_tenant()
        result = application_services().workflow_test_credentials.preflight(
            BuilderScope(current_tenant_id, str(app_id), account.id)
        )
        return dump_response(TestCredentialPreflightResponse, result)
