"""Enterprise-authenticated AppDeploy form lifecycle (D1–D4)."""

from typing import Literal, NoReturn

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, JsonValue, ValidationError
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from controllers.common.human_input_v2_errors import (
    HumanInputV2AlreadySubmittedError,
    HumanInputV2ExpiredError,
    HumanInputV2InvalidInputError,
    HumanInputV2WorkflowNotActiveError,
    form_http_error,
)
from controllers.common.schema import register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from factories.human_input_v2_form_presentation import build_form_presentation
from libs.external_api import error_responses
from libs.helper import to_timestamp
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from services.enterprise.human_input_service import (
    AppDeployHumanInputService,
    PreparePayload,
    project_prepared,
    resolve_service_api_end_user_id,
)
from services.human_input_service import FormExpiredError, FormSubmittedError, InvalidFormDataError
from services.human_input_v2.form_service import recover_initiator_prepared_form
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
    ServiceAPIFormActor,
    WebAppFormActor,
)
from services.message_extra_content_service import _restore_v2_content


class FormQuery(BaseModel):
    caller: Literal["web_app", "service_api"]
    end_user_id: str = ""


class SubmitPayload(FormQuery):
    action: str
    inputs: dict[str, JsonValue]


register_schema_models(inner_api_ns, PreparePayload, SubmitPayload)


def _tenant_id(app_id: str):
    """Translate an unknown application to the native opaque resource 404."""
    try:
        return AppDeployHumanInputService.tenant_id(app_id)
    except LookupError as error:
        raise NotFound("App not found") from error


def _require_enterprise() -> None:
    """Reject AppDeploy routes outside the Enterprise edition before accessing forms."""
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        raise NotFound()


@inner_api_ns.route("/enterprise/apps/<string:app_id>/workflow-runs/<string:workflow_run_id>/human-input-forms:prepare")
class PrepareHumanInputForm(Resource):
    @enterprise_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[PreparePayload.__name__])
    def post(self, app_id: str, workflow_run_id: str):
        """Prepare the exact node execution; malformed requests have no accepted form."""
        _require_enterprise()
        try:
            return AppDeployHumanInputService().prepare(
                app_id, workflow_run_id, PreparePayload.model_validate(request.get_json())
            )
        except LookupError as error:
            raise NotFound(str(error)) from error
        except ValueError as error:
            raise BadRequest(str(error)) from error


@inner_api_ns.route("/enterprise/apps/<string:app_id>/workflow-runs/<string:workflow_run_id>/human-input-forms")
class ListHumanInputForms(Resource):
    @enterprise_inner_api_only
    def get(self, app_id: str, workflow_run_id: str):
        """Replay persisted form events with only the original initiator grant."""
        _require_enterprise()
        tenant_id = _tenant_id(app_id)
        with session_factory.create_session() as session:
            forms = SQLAlchemyFormRepository(session, tenant_id, app_id).get_run_forms(workflow_run_id)
        data = []
        for form in forms:
            if form.run_gateway == "enterprise":
                # Existing-form reentry reads only; node_data and variables are
                # not required to recover the frozen form's initiator token.
                prepared = recover_initiator_prepared_form(form=form, session_factory=session_factory.create_session)
                projection = project_prepared(prepared)
                node_id = form.owner_ref["node_id"] if form.owner_ref else ""
                content = _restore_v2_content(prepared, workflow_run_id=workflow_run_id, node_id=node_id)
                assert content.form_definition is not None
                content = content.model_copy(
                    update={
                        "form_definition": content.form_definition.model_copy(
                            update={"form_version": form.form_version}
                        )
                    }
                )
                data.append(
                    {
                        "form_id": form.id,
                        "node_id": form.owner_ref["node_id"] if form.owner_ref else "",
                        "status": form.status.value,
                        "form_version": form.form_version,
                        "event": projection["event"],
                        "extra_content": content.model_dump(mode="json"),
                    }
                )
        return {"data": data}


@inner_api_ns.route("/enterprise/apps/<string:app_id>/workflow-runs/<string:workflow_run_id>/human-input-forms:expire")
class ExpireHumanInputForms(Resource):
    @enterprise_inner_api_only
    def post(self, app_id: str, workflow_run_id: str):
        """Expire waiting AppDeploy forms on run stop; preserve completed submissions."""
        _require_enterprise()
        tenant_id = _tenant_id(app_id)
        with session_factory.create_session() as session, session.begin():
            repository = SQLAlchemyFormRepository(session, tenant_id, app_id)
            for form in repository.get_run_forms(workflow_run_id):
                if form.run_gateway == "enterprise":
                    repository.cancel_form(form.id)
        return {}


def _form_service(app_id: str, token: str, query: FormQuery):
    """Authorize the caller through the same public form service and grant checks."""
    tenant_id = _tenant_id(app_id)
    service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
    if query.caller == "service_api":
        resolve_service_api_end_user_id(tenant_id=tenant_id, app_id=app_id, user=query.end_user_id)
        actor = ServiceAPIFormActor(tenant_id, app_id)
        form = service.get_service_api_form(actor=actor, form_token=token)
    else:
        actor = WebAppFormActor(tenant_id, app_id, query.end_user_id)
        form = service.get_web_app_form(actor=actor, form_token=token)
    if form.run_gateway != "enterprise":
        raise NotFound("Form not found")
    return service, actor, form


def _raise_form_error(error: HumanInputFormError, query: FormQuery, version: str, app_id: str) -> NoReturn:
    """Preserve v1/Service API 412 and v2 Web App 409/410 error semantics."""
    if error.form_id is not None:
        tenant_id = _tenant_id(app_id)
        with session_factory.create_session() as session:
            form = SQLAlchemyFormRepository(session, tenant_id, app_id).get_form_by_id(error.form_id)
        if form is not None:
            version = form.form_version
    if query.caller == "service_api" or version == "1":
        if error.code == HumanInputFormErrorCode.ALREADY_SUBMITTED:
            raise FormSubmittedError(error.form_id or "") from error
        if error.code == HumanInputFormErrorCode.EXPIRED:
            raise FormExpiredError(error.form_id or "") from error
        if error.code == HumanInputFormErrorCode.INVALID_INPUT:
            raise InvalidFormDataError(str(error)) from error
        if error.code == HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE:
            raise BadRequest("The workflow is not paused with an active checkpoint.") from error
    raise form_http_error(error, message="The approval could not be accepted.") from error


@inner_api_ns.route("/enterprise/apps/<string:app_id>/human-input-forms/<string:form_token>")
class GetHumanInputForm(Resource):
    @enterprise_inner_api_only
    @error_responses(FormSubmittedError, FormExpiredError, HumanInputV2AlreadySubmittedError, HumanInputV2ExpiredError)
    def get(self, app_id: str, form_token: str):
        """Read the caller-specific public definition plus its original version."""
        _require_enterprise()
        try:
            query = FormQuery.model_validate(request.args.to_dict())
        except ValidationError as error:
            raise BadRequest(str(error)) from error
        try:
            _, _, form = _form_service(app_id, form_token, query)
        except HumanInputFormError as error:
            _raise_form_error(error, query, "2", app_id)
        if form.form_version == "2" and query.caller == "web_app":
            return {
                "form_version": "2",
                "resolved_form": form.resolved_form.model_dump(mode="json"),
                "expiration_time": to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
            }
        presentation = build_form_presentation(form.resolved_form)
        return {
            "form_version": form.form_version,
            "form_content": presentation.form_content,
            "inputs": [value.model_dump(mode="json") for value in presentation.inputs],
            "resolved_default_values": presentation.resolved_default_values,
            "user_actions": [value.model_dump(mode="json") for value in presentation.user_actions],
            "expiration_time": to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
        }


@inner_api_ns.route("/enterprise/apps/<string:app_id>/human-input-forms/<string:form_token>:submit")
class SubmitHumanInputForm(Resource):
    @enterprise_inner_api_only
    @error_responses(
        FormSubmittedError,
        FormExpiredError,
        HumanInputV2AlreadySubmittedError,
        HumanInputV2ExpiredError,
        HumanInputV2WorkflowNotActiveError,
        HumanInputV2InvalidInputError,
    )
    @inner_api_ns.expect(inner_api_ns.models[SubmitPayload.__name__])
    def post(self, app_id: str, form_token: str):
        """Commit a validated submission before requesting Enterprise resume."""
        _require_enterprise()
        try:
            payload = SubmitPayload.model_validate(request.get_json())
        except ValidationError as error:
            raise BadRequest(str(error)) from error
        version = "2"
        try:
            service, actor, form = _form_service(app_id, form_token, payload)
            version = form.form_version
            if isinstance(actor, ServiceAPIFormActor):
                service.submit_service_api_form(
                    actor=actor,
                    end_user_id=resolve_service_api_end_user_id(
                        tenant_id=actor.tenant_id, app_id=app_id, user=payload.end_user_id
                    ),
                    form_token=form_token,
                    action=payload.action,
                    inputs=payload.inputs,
                )
            else:
                service.submit_web_app_form(
                    actor=actor, form_token=form_token, action=payload.action, inputs=payload.inputs
                )
        except HumanInputFormError as error:
            _raise_form_error(error, payload, version, app_id)
        return {"workflow_run_id": form.workflow_run_id}
