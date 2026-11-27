from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource

from controllers.common.rbac import AgentId, PlainApp, RBACCheck, Workspace
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.wraps import rbac_permission_required
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.agent_fields import (
    AgentAppComposerResponse,
    AgentComposerCandidatesResponse,
    AgentComposerImpactResponse,
    AgentComposerValidateResponse,
    ComposerValidationFindingsResponse,
    WorkflowAgentComposerResponse,
)
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.app_composer_store import AgentComposerAgentMissingError, AgentComposerSnapshotMissingError
from services.agent.errors import (
    AgentNameConflictError,
    AgentNotFoundError,
    AgentSoulLockedError,
    AgentVersionConflictError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
    PlaintextSecretNotAllowedError,
)
from services.agent.workflow_composer_gateway import (
    WorkflowComposerAppMissingError,
    WorkflowComposerSnippetMissingError,
    WorkflowComposerTarget,
    WorkflowComposerTargetKind,
)
from services.entities.agent_entities import (
    ComposerSavePayload,
    WorkflowAgentComposerQuery,
    WorkflowComposerCopyFromRosterPayload,
)

register_schema_models(
    console_ns, ComposerSavePayload, WorkflowAgentComposerQuery, WorkflowComposerCopyFromRosterPayload
)
register_response_schema_models(
    console_ns,
    AgentAppComposerResponse,
    AgentComposerCandidatesResponse,
    AgentComposerImpactResponse,
    AgentComposerValidateResponse,
    WorkflowAgentComposerResponse,
)


_COMPOSER_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class SnippetNotFoundError(BaseHTTPException):
    """Keep the historical generic not-found code for a missing Composer snippet."""

    error_code = "not_found"
    description = "Snippet not found"
    code = HTTPStatus.NOT_FOUND


@contextmanager
def _workflow_composer_errors() -> Generator[None]:
    """Map target admission failures to the existing workflow and snippet responses."""
    try:
        yield
    except WorkflowComposerAppMissingError as exc:
        raise AppNotFoundError(*exc.args) from exc
    except WorkflowComposerSnippetMissingError as exc:
        raise SnippetNotFoundError from exc


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer")
class WorkflowAgentComposerApi(Resource):
    @error_responses(AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Workflow agent composer state", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @console_ns.doc(params=query_params_from_model(WorkflowAgentComposerQuery))
    @error_responses(AppNotFoundError)
    @console_account_admission()
    @model_validate(WorkflowAgentComposerQuery)
    def get(
        self, req_data: WorkflowAgentComposerQuery, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Return the Composer state for the admitted workflow or snippet node."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.get(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)),
                node_id=node_id,
                snapshot_id=req_data.snapshot_id,
            )
        return dump_response(WorkflowAgentComposerResponse, result)

    @error_responses(
        AgentNameConflictError,
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Workflow agent composer saved", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())]
    )
    @model_validate(ComposerSavePayload)
    def put(
        self, req_data: ComposerSavePayload, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Save the admitted workflow or snippet node’s configuration."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.save(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/copy-from-roster")
class WorkflowAgentComposerCopyFromRosterApi(Resource):
    @error_responses(
        AgentNotFoundError, AgentVersionConflictError, AgentVersionNotFoundError, InvalidComposerConfigError
    )
    @console_ns.expect(console_ns.models[WorkflowComposerCopyFromRosterPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Workflow roster agent copied to inline agent",
        console_ns.models[WorkflowAgentComposerResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())]
    )
    @model_validate(WorkflowComposerCopyFromRosterPayload)
    def post(
        self, req_data: WorkflowComposerCopyFromRosterPayload, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Copy the admitted node’s roster Agent into an inline Agent."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.copy_from_roster(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate")
class WorkflowAgentComposerValidateApi(Resource):
    @error_responses(AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError)
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Workflow agent composer validation result",
        console_ns.models[AgentComposerValidateResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission()
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Validate the configuration for the admitted workflow or snippet."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.validate(
                context, WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)), payload=req_data
            )
        return dump_response(AgentComposerValidateResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates")
class WorkflowAgentComposerCandidatesApi(Resource):
    @console_ns.response(
        HTTPStatus.OK, "Workflow agent composer candidates", console_ns.models[AgentComposerCandidatesResponse.__name__]
    )
    @error_responses(AppNotFoundError)
    @console_account_admission()
    def get(self, context: RequestContext, app_id: UUID, node_id: str) -> dict[str, object]:
        """Return candidates for the admitted workflow or snippet node."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.candidates(
                context, WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)), node_id=node_id
            )
        return dump_response(AgentComposerCandidatesResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact")
class WorkflowAgentComposerImpactApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Workflow agent composer impact", console_ns.models[AgentComposerImpactResponse.__name__]
    )
    @error_responses(AppNotFoundError)
    @console_account_admission()
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Return the number of workflow nodes using the selected snapshot."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.impact(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)),
                snapshot_id=req_data.binding.current_snapshot_id if req_data.binding else None,
            )
        return dump_response(AgentComposerImpactResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster")
class WorkflowAgentComposerSaveToRosterApi(Resource):
    @error_responses(
        AgentNameConflictError,
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Workflow agent composer saved to roster",
        console_ns.models[WorkflowAgentComposerResponse.__name__],
    )
    @error_responses(AppNotFoundError)
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())],
    )
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_CREATE, Workspace()))
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, app_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Save the admitted workflow or snippet node’s configuration."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.save(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.WORKFLOW, str(app_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer")
class SnippetAgentComposerApi(Resource):
    @error_responses(AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent composer state", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @console_ns.doc(params=query_params_from_model(WorkflowAgentComposerQuery))
    @console_account_admission()
    @model_validate(WorkflowAgentComposerQuery)
    def get(
        self, req_data: WorkflowAgentComposerQuery, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Return the Composer state for the admitted workflow or snippet node."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.get(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)),
                node_id=node_id,
                snapshot_id=req_data.snapshot_id,
            )
        return dump_response(WorkflowAgentComposerResponse, result)

    @error_responses(
        AgentNameConflictError,
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent composer saved", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.SNIPPETS_CREATE_AND_MODIFY, Workspace())],
    )
    @model_validate(ComposerSavePayload)
    def put(
        self, req_data: ComposerSavePayload, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Save the admitted workflow or snippet node’s configuration."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.save(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/copy-from-roster")
class SnippetAgentComposerCopyFromRosterApi(Resource):
    @error_responses(
        AgentNotFoundError, AgentVersionConflictError, AgentVersionNotFoundError, InvalidComposerConfigError
    )
    @console_ns.expect(console_ns.models[WorkflowComposerCopyFromRosterPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Roster agent copied into snippet", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.SNIPPETS_CREATE_AND_MODIFY, Workspace())],
    )
    @model_validate(WorkflowComposerCopyFromRosterPayload)
    def post(
        self, req_data: WorkflowComposerCopyFromRosterPayload, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Copy the admitted node’s roster Agent into an inline Agent."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.copy_from_roster(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate")
class SnippetAgentComposerValidateApi(Resource):
    @error_responses(AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError)
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent composer validation", console_ns.models[AgentComposerValidateResponse.__name__]
    )
    @console_account_admission()
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Validate the configuration for the admitted workflow or snippet."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.validate(
                context, WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)), payload=req_data
            )
        return dump_response(AgentComposerValidateResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates")
class SnippetAgentComposerCandidatesApi(Resource):
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent composer candidates", console_ns.models[AgentComposerCandidatesResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, snippet_id: UUID, node_id: str) -> dict[str, object]:
        """Return candidates for the admitted workflow or snippet node."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.candidates(
                context, WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)), node_id=node_id
            )
        return dump_response(AgentComposerCandidatesResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact")
class SnippetAgentComposerImpactApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent composer impact", console_ns.models[AgentComposerImpactResponse.__name__]
    )
    @console_account_admission()
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Return the number of workflow nodes using the selected snapshot."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.impact(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)),
                snapshot_id=req_data.binding.current_snapshot_id if req_data.binding else None,
            )
        return dump_response(AgentComposerImpactResponse, result)


@console_ns.route("/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster")
class SnippetAgentComposerSaveToRosterApi(Resource):
    @error_responses(
        AgentNameConflictError,
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Snippet agent saved to roster", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.SNIPPETS_CREATE_AND_MODIFY, Workspace())],
    )
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_CREATE, Workspace()))
    @model_validate(ComposerSavePayload)
    def post(
        self, req_data: ComposerSavePayload, context: RequestContext, snippet_id: UUID, node_id: str
    ) -> dict[str, object]:
        """Save the admitted workflow or snippet node’s configuration."""
        with _workflow_composer_errors():
            result = application_services().workflow_composer.save(
                context,
                WorkflowComposerTarget(WorkflowComposerTargetKind.SNIPPET, str(snippet_id)),
                node_id=node_id,
                payload=req_data,
            )
        return dump_response(WorkflowAgentComposerResponse, result)


@contextmanager
def _composer_errors() -> Generator[None]:
    """Map missing tenant-scoped Agent configuration to the existing Console errors."""
    try:
        yield
    except AgentComposerAgentMissingError as exc:
        raise AgentNotFoundError from exc
    except AgentComposerSnapshotMissingError as exc:
        raise AgentVersionNotFoundError from exc


@console_ns.route("/agent/<uuid:agent_id>/composer")
class AgentComposerApi(Resource):
    @error_responses(AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Agent app composer state", console_ns.models[AgentAppComposerResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the Agent's effective shared configuration without creating a draft."""
        with _composer_errors():
            state = application_services().agent_apps.composer.get(context, str(agent_id))
        return dump_response(AgentAppComposerResponse, state)

    @error_responses(
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Agent app composer saved", console_ns.models[AgentAppComposerResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_COMPOSER_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    @model_validate(ComposerSavePayload)
    def put(self, req_data: ComposerSavePayload, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Save the shared draft and return the committed state with validation findings."""
        with _composer_errors():
            result = application_services().agent_apps.composer.save(context, str(agent_id), req_data)
        response = dump_response(AgentAppComposerResponse, result.state)
        response["validation"] = dump_response(ComposerValidationFindingsResponse, result.validation)
        return response


@console_ns.route("/agent/<uuid:agent_id>/composer/validate")
class AgentComposerValidateApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AgentSoulLockedError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Agent app composer validation result", console_ns.models[AgentComposerValidateResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    @model_validate(ComposerSavePayload)
    def post(self, req_data: ComposerSavePayload, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Check publish rules for the supplied configuration and report findings without writing."""
        with _composer_errors():
            result = application_services().agent_apps.composer.validate(context, str(agent_id), req_data)
        return dump_response(AgentComposerValidateResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/composer/candidates")
class AgentComposerCandidatesApi(Resource):
    @error_responses(AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Agent app composer candidates", console_ns.models[AgentComposerCandidatesResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return mention candidates from tenant-scoped configuration and workspace tools."""
        with _composer_errors():
            result = application_services().agent_apps.composer.candidates(context, str(agent_id))
        return dump_response(AgentComposerCandidatesResponse, result)
