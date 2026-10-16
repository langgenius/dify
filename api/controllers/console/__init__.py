from collections import OrderedDict
from http import HTTPStatus
from importlib import import_module
from types import ModuleType
from typing import cast

from flask import Blueprint, current_app, got_request_exception
from flask_restx import Namespace

from controllers.common.errors import (
    InternalServerError,
    InvalidArgumentError,
    NotFoundError,
    UnauthorizedError,
    register_permission_error_handler,
)
from controllers.console.error import NotInitValidateError, NotSetupError, UnauthorizedAndForceLogout
from controllers.console.workspace.error import AccountNotInitializedError
from libs.external_api import ExternalApi
from machinery.errors import ActiveWorkspaceRequiredError
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveInvalidMonthError,
    WorkflowRunArchiveNotFoundError,
)

bp = Blueprint("console", __name__, url_prefix="/console/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Console API",
    description="Console management APIs for app configuration, monitoring, and administration",
)
register_permission_error_handler(api)
# Errors the Console client handles centrally (bootstrap redirects, forced logout, malformed
# input); any operation may answer with them, so no operation lists them. The shared
# ``not_found``, ``unauthorized`` and ``internal_server_error`` codes are the ones Werkzeug's own
# exceptions already produce on every operation, so documenting them per operation adds nothing.
api.document_generic_errors(
    NotSetupError,
    NotInitValidateError,
    AccountNotInitializedError,
    UnauthorizedAndForceLogout,
    InvalidArgumentError,
    NotFoundError,
    UnauthorizedError,
    InternalServerError,
)


@api.errorhandler(ActiveWorkspaceRequiredError)
def _handle_active_workspace_required_error(error: ActiveWorkspaceRequiredError):
    """Map a broken Console admission invariant without exposing internal details."""
    got_request_exception.send(current_app, exception=error)
    status = HTTPStatus.INTERNAL_SERVER_ERROR
    return {
        "code": error.error_code,
        "message": status.phrase,
        "status": status.value,
    }, status.value


@api.errorhandler(WorkflowRunArchiveInvalidMonthError)
def _handle_workflow_run_archive_invalid_month_error(
    error: WorkflowRunArchiveInvalidMonthError,
) -> tuple[dict[str, str | int], int]:
    got_request_exception.send(current_app, exception=error)
    status = HTTPStatus.BAD_REQUEST
    return {"code": "bad_request", "message": str(error), "status": status.value}, status.value


@api.errorhandler(WorkflowRunArchiveNotFoundError)
@api.errorhandler(WorkflowRunArchiveDownloadTaskNotFoundError)
def _handle_workflow_run_archive_not_found_error(
    error: WorkflowRunArchiveNotFoundError | WorkflowRunArchiveDownloadTaskNotFoundError,
) -> tuple[dict[str, str | int], int]:
    got_request_exception.send(current_app, exception=error)
    status = HTTPStatus.NOT_FOUND
    return {"code": "not_found", "message": str(error), "status": status.value}, status.value


@api.errorhandler(WorkflowRunArchiveDownloadNotReadyError)
def _handle_workflow_run_archive_download_not_ready_error(
    error: WorkflowRunArchiveDownloadNotReadyError,
) -> tuple[dict[str, str | int], int]:
    got_request_exception.send(current_app, exception=error)
    status = HTTPStatus.CONFLICT
    return {"code": "conflict", "message": str(error), "status": status.value}, status.value


# Flask-RESTX dispatches in registration order; the shared Exception handler
# must not shadow these Console-specific error mappings.
for error_type in (
    ActiveWorkspaceRequiredError,
    WorkflowRunArchiveInvalidMonthError,
    WorkflowRunArchiveNotFoundError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveDownloadNotReadyError,
):
    cast(OrderedDict[type[Exception], object], api.error_handlers).move_to_end(error_type, last=False)
# What those handlers emit, so the document resolves a declared error to its status and code and the
# contract check admits the codes they serve.
api.document_error_handler(
    ActiveWorkspaceRequiredError,
    status=HTTPStatus.INTERNAL_SERVER_ERROR,
    code=ActiveWorkspaceRequiredError.error_code,
)
api.document_error_handler(WorkflowRunArchiveInvalidMonthError, status=HTTPStatus.BAD_REQUEST, code="bad_request")
api.document_error_handler(WorkflowRunArchiveNotFoundError, status=HTTPStatus.NOT_FOUND, code="not_found")
api.document_error_handler(WorkflowRunArchiveDownloadTaskNotFoundError, status=HTTPStatus.NOT_FOUND, code="not_found")
api.document_error_handler(WorkflowRunArchiveDownloadNotReadyError, status=HTTPStatus.CONFLICT, code="conflict")


console_ns = Namespace("console", description="Console management API operations", path="/")

RESOURCE_MODULES = (
    "controllers.console.app.app_import",
    "controllers.console.explore.audio",
    "controllers.console.explore.completion",
    "controllers.console.explore.conversation",
    "controllers.console.explore.message",
    "controllers.console.explore.workflow",
    "controllers.console.files",
    "controllers.console.remote_files",
)

for module_name in RESOURCE_MODULES:
    import_module(module_name)


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespaces and schema models exist."""

    # Ensure resource modules are imported so route decorators are evaluated.
    # Import other controllers
    from . import (
        apikey,
        extension,
        feature,
        human_input_form,
        init_validate,
        knowledge_fs_proxy,
        notification,
        onboarding,
        resource_access_token,
        setup,
        spec,
        system,
        workflow_run_archive,
    )
    from .agent import composer as agent_composer
    from .agent import roster as agent_roster

    # Import app controllers
    from .app import (
        advanced_prompt_template,
        agent,
        agent_app_access,
        agent_app_feature,
        agent_app_sandbox,
        agent_config_inspector,
        annotation,
        app,
        audio,
        completion,
        conversation,
        conversation_variables,
        generator,
        mcp_server,
        message,
        model_config,
        ops_trace,
        site,
        statistic,
        workflow,
        workflow_app_log,
        workflow_comment,
        workflow_draft_variable,
        workflow_node_output_inspector,
        workflow_run,
        workflow_statistic,
        workflow_trigger,
    )

    # Import auth controllers
    from .auth import (
        activate,
        data_source_bearer_auth,
        data_source_oauth,
        email_register,
        forgot_password,
        login,
        oauth,
        oauth_server,
    )

    # Import billing controllers
    from .billing import billing, compliance

    # Import datasets controllers
    from .datasets import (
        data_source,
        datasets,
        datasets_document,
        datasets_segments,
        external,
        hit_testing,
        metadata,
        website,
    )
    from .datasets.rag_pipeline import (
        datasource_auth,
        datasource_content_preview,
        rag_pipeline,
        rag_pipeline_datasets,
        rag_pipeline_draft_variable,
        rag_pipeline_import,
        rag_pipeline_workflow,
    )

    # Import explore controllers
    from .explore import (
        banner,
        installed_app,
        parameter,
        recommended_app,
        saved_message,
        trial,
    )
    from .snippets import snippet_workflow, snippet_workflow_draft_variable
    from .socketio import workflow as socketio_workflow

    # Import tag controllers
    from .tag import tags

    # Import workspace controllers
    from .workspace import (
        account,
        agent_providers,
        endpoint,
        load_balancing_config,
        members,
        model_providers,
        models,
        plugin,
        rbac,
        skills,
        snippets,
        tool_providers,
        trigger_providers,
        workspace,
    )

    return (
        apikey,
        extension,
        feature,
        human_input_form,
        init_validate,
        knowledge_fs_proxy,
        notification,
        onboarding,
        resource_access_token,
        setup,
        spec,
        system,
        workflow_run_archive,
        agent_composer,
        agent_roster,
        advanced_prompt_template,
        agent,
        agent_app_access,
        agent_app_feature,
        agent_app_sandbox,
        agent_config_inspector,
        annotation,
        app,
        audio,
        completion,
        conversation,
        conversation_variables,
        generator,
        mcp_server,
        message,
        model_config,
        ops_trace,
        site,
        statistic,
        workflow,
        workflow_app_log,
        workflow_comment,
        workflow_draft_variable,
        workflow_node_output_inspector,
        workflow_run,
        workflow_statistic,
        workflow_trigger,
        activate,
        data_source_bearer_auth,
        data_source_oauth,
        email_register,
        forgot_password,
        login,
        oauth,
        oauth_server,
        billing,
        compliance,
        data_source,
        datasets,
        datasets_document,
        datasets_segments,
        external,
        hit_testing,
        metadata,
        website,
        datasource_auth,
        datasource_content_preview,
        rag_pipeline,
        rag_pipeline_datasets,
        rag_pipeline_draft_variable,
        rag_pipeline_import,
        rag_pipeline_workflow,
        banner,
        installed_app,
        parameter,
        recommended_app,
        saved_message,
        trial,
        snippet_workflow,
        snippet_workflow_draft_variable,
        socketio_workflow,
        tags,
        account,
        agent_providers,
        endpoint,
        load_balancing_config,
        members,
        model_providers,
        models,
        plugin,
        rbac,
        skills,
        snippets,
        tool_providers,
        trigger_providers,
        workspace,
    )


(
    apikey,
    extension,
    feature,
    human_input_form,
    init_validate,
    notification,
    onboarding,
    resource_access_token,
    setup,
    spec,
    system,
    workflow_run_archive,
    agent_composer,
    agent_roster,
    advanced_prompt_template,
    agent,
    agent_app_access,
    agent_app_feature,
    agent_app_sandbox,
    agent_config_inspector,
    annotation,
    app,
    audio,
    completion,
    conversation,
    conversation_variables,
    generator,
    mcp_server,
    message,
    model_config,
    ops_trace,
    site,
    statistic,
    workflow,
    workflow_app_log,
    workflow_comment,
    workflow_draft_variable,
    workflow_node_output_inspector,
    workflow_run,
    workflow_statistic,
    workflow_trigger,
    activate,
    data_source_bearer_auth,
    data_source_oauth,
    email_register,
    forgot_password,
    login,
    oauth,
    oauth_server,
    billing,
    compliance,
    data_source,
    datasets,
    datasets_document,
    datasets_segments,
    external,
    hit_testing,
    metadata,
    website,
    datasource_auth,
    datasource_content_preview,
    rag_pipeline,
    rag_pipeline_datasets,
    rag_pipeline_draft_variable,
    rag_pipeline_import,
    rag_pipeline_workflow,
    banner,
    installed_app,
    parameter,
    recommended_app,
    saved_message,
    trial,
    snippet_workflow,
    snippet_workflow_draft_variable,
    socketio_workflow,
    tags,
    account,
    agent_providers,
    endpoint,
    load_balancing_config,
    members,
    model_providers,
    models,
    plugin,
    rbac,
    skills,
    snippets,
    tool_providers,
    trigger_providers,
    workspace,
) = _register_controllers()

api.add_namespace(console_ns)

__all__ = [
    "account",
    "activate",
    "advanced_prompt_template",
    "agent",
    "agent_app_access",
    "agent_app_feature",
    "agent_app_sandbox",
    "agent_composer",
    "agent_config_inspector",
    "agent_providers",
    "agent_roster",
    "annotation",
    "api",
    "apikey",
    "app",
    "audio",
    "banner",
    "billing",
    "bp",
    "completion",
    "compliance",
    "console_ns",
    "conversation",
    "conversation_variables",
    "data_source",
    "data_source_bearer_auth",
    "data_source_oauth",
    "datasets",
    "datasets_document",
    "datasets_segments",
    "datasource_auth",
    "datasource_content_preview",
    "email_register",
    "endpoint",
    "extension",
    "external",
    "feature",
    "forgot_password",
    "generator",
    "hit_testing",
    "human_input_form",
    "init_validate",
    "installed_app",
    "load_balancing_config",
    "login",
    "mcp_server",
    "members",
    "message",
    "metadata",
    "model_config",
    "model_providers",
    "models",
    "notification",
    "oauth",
    "oauth_server",
    "onboarding",
    "ops_trace",
    "parameter",
    "plugin",
    "rag_pipeline",
    "rag_pipeline_datasets",
    "rag_pipeline_draft_variable",
    "rag_pipeline_import",
    "rag_pipeline_workflow",
    "rbac",
    "recommended_app",
    "resource_access_token",
    "saved_message",
    "setup",
    "site",
    "skills",
    "snippet_workflow",
    "snippet_workflow_draft_variable",
    "snippets",
    "socketio_workflow",
    "spec",
    "statistic",
    "system",
    "tags",
    "tool_providers",
    "trial",
    "trigger_providers",
    "website",
    "workflow",
    "workflow_app_log",
    "workflow_comment",
    "workflow_draft_variable",
    "workflow_node_output_inspector",
    "workflow_run",
    "workflow_run_archive",
    "workflow_statistic",
    "workflow_trigger",
    "workspace",
]
