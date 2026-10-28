"""Console admission and wire contracts for Builder test credential checks."""

from collections.abc import Callable
from functools import wraps

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import document_errors, error_responses
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from services.workflow_test_credentials import (
    BuilderScope,
    TestCredentialDraftChangedError,
    TestCredentialNotReadyError,
    TestCredentialPreflight,
)


class TestCredentialDraftChangedHTTPError(BaseHTTPException):
    code = 409
    error_code = "test_credential_draft_changed"
    description = "Save the current draft and check test credentials again."


class TestCredentialsNotReadyError(BaseHTTPException):
    code = 400
    error_code = "test_credentials_not_ready"
    description = "Required test credentials are not ready."
    details_model = TestCredentialPreflight


def test_credential_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except TestCredentialDraftChangedError as exc:
            raise TestCredentialDraftChangedHTTPError() from exc
        except TestCredentialNotReadyError as exc:
            error = TestCredentialsNotReadyError()
            assert error.data is not None
            error.data["details"] = exc.result.model_dump(mode="json")
            raise error from exc

    return document_errors(wrapped, TestCredentialDraftChangedHTTPError, TestCredentialsNotReadyError)


class TestCredentialPreflightPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    draft_hash: str = Field(min_length=1, description="Hash of the saved draft, not a historical version selector.")
    node_id: str | None = Field(
        default=None, min_length=1, description="Omit for full Preview; container nodes check their nested tool nodes."
    )


class TestCredentialPreflightResponse(TestCredentialPreflight, ResponseModel):
    pass


register_schema_models(console_ns, TestCredentialPreflightPayload)
register_response_schema_models(console_ns, TestCredentialPreflightResponse)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/test-credentials/preflight")
class TestCredentialPreflightApi(Resource):
    @console_ns.doc(description="Check saved Builder test credentials without executing tools or creating a Run.")
    @console_ns.expect(console_ns.models[TestCredentialPreflightPayload.__name__])
    @console_ns.response(200, "Test credential readiness", console_ns.models[TestCredentialPreflightResponse.__name__])
    @error_responses(TestCredentialDraftChangedHTTPError)
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp()))
    @with_current_tenant_id
    @model_validate(TestCredentialPreflightPayload)
    def post(self, payload: TestCredentialPreflightPayload, current_tenant_id: str, app_id: str):
        account, _ = current_account_with_tenant()
        try:
            result = application_services().workflow_test_credentials.check(
                BuilderScope(current_tenant_id, str(app_id), account.id),
                draft_hash=payload.draft_hash,
                node_id=payload.node_id,
            )
        except TestCredentialDraftChangedError as exc:
            raise TestCredentialDraftChangedHTTPError() from exc
        return dump_response(TestCredentialPreflightResponse, result)
