"""Workspace-level Human Input v2 controllers."""

from __future__ import annotations

from http import HTTPStatus

from flask import abort, request
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    AddPlatformContactsRequest,
    AddPlatformContactsResponse,
    BatchGetContactOptionsQuery,
    BatchGetContactOptionsResponse,
    BatchGetContactsQuery,
    BatchGetContactsResponse,
    ContactListQuery,
    ContactOption,
    ContactOptionsQuery,
    CreateIMBindingRequest,
    CreateIMBindingResponse,
    CreateIMSyncRunResponse,
    DeleteIMBindingQuery,
    DeleteIMBindingResponse,
    DeleteIMIntegrationQuery,
    ExternalContactCreateRequest,
    ExternalContactCreateResponse,
    ExternalContactUpdateRequest,
    ExternalContactUpdateResponse,
    GetContactResponse,
    GetIMIntegrationResponse,
    GetLatestIMSyncRunResponse,
    HumanInputContact,
    HumanInputContactType,
    IMContactSyncErrorResponse,
    IMIntegrationStatus,
    IMProvider,
    IMSyncResultType,
    IMSyncRunStatus,
    ListContactOptionsResponse,
    ListContactsResponse,
    ListIMIdentitiesQuery,
    ListIMIdentitiesResponse,
    ListLatestIMSyncRunResultsQuery,
    ListLatestIMSyncRunResultsResponse,
    ListOrganizationCandidatesResponse,
    NodeDataMigrationFailureResponse,
    NodeDataMigrationPayload,
    NodeDataMigrationResponse,
    OrganizationCandidatesQuery,
    RemoveContactsRequest,
    RemoveContactsResponse,
    ResetContactIMOverrideResponse,
    SetContactIMOverrideRequest,
    SetContactIMOverrideResponse,
    TestIMIntegrationRequest,
    TestIMIntegrationResponse,
    UpdateIMIntegrationRequest,
    UpdateIMIntegrationResponse,
)
from controllers.common.human_input_v2_migration import preflight_legacy_human_input_node_data
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    is_admin_or_owner_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.human_input_v2.im_integration import (
    ContactIMBindingView,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMSyncRun,
    SyncContactSnapshot,
    SyncResultFact,
)
from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, TenantId, WorkspaceScope
from graphon.file import helpers as file_helpers
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models.account import Account
from services.human_input_v2.composition import build_human_input_node_data_migration_service
from services.human_input_v2.im_contact_sync.composition import build_im_contact_sync_application
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.service import (
    IMIntegrationNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
)
from services.human_input_v2.node_data_migration import MigrationNode, NodeDataMigrationFailure

register_enum_models(
    console_ns,
    HumanInputContactType,
    IMIntegrationStatus,
    IMSyncRunStatus,
    IMSyncResultType,
    IMProvider,
)
register_schema_models(
    console_ns,
    ContactListQuery,
    ContactOptionsQuery,
    BatchGetContactOptionsQuery,
    OrganizationCandidatesQuery,
    AddPlatformContactsRequest,
    ExternalContactCreateRequest,
    ExternalContactUpdateRequest,
    RemoveContactsRequest,
    UpdateIMIntegrationRequest,
    DeleteIMIntegrationQuery,
    TestIMIntegrationRequest,
    ListIMIdentitiesQuery,
    ListLatestIMSyncRunResultsQuery,
    SetContactIMOverrideRequest,
    CreateIMBindingRequest,
    NodeDataMigrationPayload,
)
register_response_schema_models(
    console_ns,
    HumanInputContact,
    ContactOption,
    GetContactResponse,
    ExternalContactCreateResponse,
    ExternalContactUpdateResponse,
    AddPlatformContactsResponse,
    ListContactsResponse,
    ListContactOptionsResponse,
    BatchGetContactOptionsResponse,
    RemoveContactsResponse,
    ListIMIdentitiesResponse,
    GetIMIntegrationResponse,
    UpdateIMIntegrationResponse,
    TestIMIntegrationResponse,
    CreateIMSyncRunResponse,
    IMContactSyncErrorResponse,
    GetLatestIMSyncRunResponse,
    ListLatestIMSyncRunResultsResponse,
    ListOrganizationCandidatesResponse,
    ResetContactIMOverrideResponse,
    SetContactIMOverrideResponse,
    CreateIMBindingResponse,
    DeleteIMBindingResponse,
    BatchGetContactsResponse,
    NodeDataMigrationResponse,
    NodeDataMigrationFailureResponse,
)


def _raise_stub_not_implemented() -> None:
    abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 stub endpoint is not implemented yet.")


_IM_BINDING_ERROR_STATUS = {
    IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED: HTTPStatus.NOT_FOUND,
    IMBindingCommandErrorCode.CONTACT_NOT_FOUND: HTTPStatus.NOT_FOUND,
    IMBindingCommandErrorCode.IDENTITY_NOT_FOUND: HTTPStatus.NOT_FOUND,
    IMBindingCommandErrorCode.BINDING_NOT_FOUND: HTTPStatus.NOT_FOUND,
    IMBindingCommandErrorCode.BINDING_CONFLICT: HTTPStatus.CONFLICT,
    IMBindingCommandErrorCode.INVALID_SCOPE: HTTPStatus.UNPROCESSABLE_ENTITY,
}


def _workspace_scope(tenant_id: str) -> WorkspaceScope:
    return WorkspaceScope(id=TenantId(tenant_id))


type _IMApplicationError = (
    IMBindingCommandError
    | IMIntegrationNotConfiguredError
    | IMSyncDispatchUnavailableError
    | IMSyncRevisionChangedError
    | IMSyncRunNotFoundError
    | IMWriteUnavailableError
)


def _im_application_error_response(error: _IMApplicationError) -> tuple[dict[str, object], HTTPStatus]:
    if isinstance(error, IMBindingCommandError):
        status = _IM_BINDING_ERROR_STATUS[error.code]
        code = error.code.value
    elif isinstance(error, IMIntegrationNotConfiguredError):
        status = HTTPStatus.NOT_FOUND
        code = "im_integration_not_configured"
    elif isinstance(error, IMSyncRunNotFoundError):
        status = HTTPStatus.NOT_FOUND
        code = "im_sync_run_not_found"
    elif isinstance(error, IMSyncDispatchUnavailableError):
        status = HTTPStatus.SERVICE_UNAVAILABLE
        code = "im_sync_dispatch_unavailable"
    elif isinstance(error, IMWriteUnavailableError):
        status = HTTPStatus.SERVICE_UNAVAILABLE
        code = "im_write_unavailable"
    else:
        status = HTTPStatus.CONFLICT
        code = "im_sync_revision_changed"
    return (
        dump_response(
            IMContactSyncErrorResponse,
            {"code": code, "message": str(error), "status": status},
        ),
        status,
    )


def _sync_run_payload(run: IMSyncRun) -> dict[str, object]:
    return {
        "id": run.id,
        "status": run.status,
        "started_at": to_timestamp(run.started_at),
        "finished_at": to_timestamp(run.finished_at),
        "error_message": run.error_message,
        "result_counts": {
            "added": run.added_count,
            "not_matched": run.not_matched_count,
            "failed": run.failed_count,
            "removed": run.removed_count,
            "skipped": run.skipped_count,
        },
        "provider": run.provider,
        "integration_id": run.integration_revision.integration_id,
        "integration_config_version": run.integration_revision.config_version,
    }


def _directory_entry_payload(result: SyncResultFact) -> dict[str, object] | None:
    if result.provider_user_id is None:
        return None
    return {
        "provider_user_id": result.provider_user_id,
        "display_name": result.display_name,
        "email": result.email,
    }


def _avatar_url(avatar_file_id: str | None) -> str:
    if avatar_file_id is None:
        return ""
    return file_helpers.get_signed_file_url(upload_file_id=avatar_file_id) or ""


def _sync_contact_payload(contact: SyncContactSnapshot, fallback_created_at) -> dict[str, object]:
    # Historical result snapshots predate the Contact creation-time field.
    created_at = contact.created_at if contact.created_at is not None else fallback_created_at
    return {
        "id": contact.contact_id,
        "name": contact.name,
        "avatar_url": _avatar_url(contact.avatar_file_id),
        "created_at": to_timestamp(created_at),
    }


def _sync_result_payload(result: SyncResultFact) -> dict[str, object]:
    entry = _directory_entry_payload(result)
    if result.result_type is IMSyncResultType.NOT_MATCHED:
        return {"type": result.result_type, "entry": entry}
    if result.result_type is IMSyncResultType.FAILED:
        return {
            "type": result.result_type,
            "entry": entry,
            "reason": result.reason_message or result.reason_code or "sync_failed",
        }
    if result.result_type is IMSyncResultType.ADDED:
        if result.contact_snapshot is None or entry is None:
            raise RuntimeError("added sync result is missing its persisted display snapshot")
        return {
            "type": result.result_type,
            "contact": _sync_contact_payload(result.contact_snapshot, result.created_at),
            "entry": entry,
        }
    if result.result_type is IMSyncResultType.SKIPPED:
        if result.contact_snapshot is None:
            raise RuntimeError("skipped sync result is missing its persisted Contact snapshot")
        return {
            "type": result.result_type,
            "entry": entry,
            "contact": _sync_contact_payload(result.contact_snapshot, result.created_at),
        }
    if result.contact_snapshot is None or result.identity_snapshot is None or result.removal_reason is None:
        raise RuntimeError("removed sync result is missing its persisted display snapshot")
    return {
        "type": result.result_type,
        "contact": _sync_contact_payload(result.contact_snapshot, result.created_at),
        "last_known_identity": {
            "identity_id": result.identity_snapshot.identity_id,
            "provider_user_id": result.identity_snapshot.provider_user_id,
            "display_name": result.identity_snapshot.display_name,
            "email": result.identity_snapshot.email,
        },
        "reason": result.removal_reason,
    }


def _contact_binding_payload(contact: ContactIMBindingView) -> dict[str, object]:
    return {
        "id": contact.id,
        "type": contact.type,
        "name": contact.name,
        "email": contact.email,
        "avatar_url": _avatar_url(contact.avatar_file_id),
        "im_bindings": [
            {"id": binding.id, "provider": binding.provider, "scope": binding.scope} for binding in contact.im_bindings
        ],
        "created_at": to_timestamp(contact.created_at),
    }


@console_ns.route("/workspaces/current/human-input/contacts")
class WorkspaceContactsApi(Resource):
    @console_ns.doc(params=query_params_from_model(ContactListQuery))
    @console_ns.response(200, "Success", console_ns.models[ListContactsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        ContactListQuery.model_validate(request.args.to_dict(flat=True))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/<uuid:contact_id>")
class WorkspaceContactApi(Resource):
    """Read one contact only when it resolves in the current workspace scope."""

    @console_ns.response(200, "Success", console_ns.models[GetContactResponse.__name__])
    @console_ns.response(404, "Contact not found or absent in the current workspace")
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str, contact_id: str):
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contact-options")
class WorkspaceContactOptionsApi(Resource):
    """Search the current workspace's selectable Contact projection for workflow editors."""

    @console_ns.doc(
        params=query_params_from_model(ContactOptionsQuery),
        description=(
            "List editor-safe Contact options for static recipient selection. "
            "The projection omits email, IM bindings, and management metadata; contacts that resolve as ABSENT "
            "or are otherwise unavailable in the current workspace are omitted."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[ListContactOptionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        ContactOptionsQuery.model_validate(request.args.to_dict(flat=True))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/organization-candidates")
class WorkspaceOrganizationCandidatesApi(Resource):
    @console_ns.doc(params=query_params_from_model(OrganizationCandidatesQuery))
    @console_ns.response(200, "Success", console_ns.models[ListOrganizationCandidatesResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        OrganizationCandidatesQuery.model_validate(request.args.to_dict(flat=True))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/platform")
class WorkspacePlatformContactsApi(Resource):
    @console_ns.expect(console_ns.models[AddPlatformContactsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[AddPlatformContactsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        AddPlatformContactsRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/external")
class WorkspaceExternalContactsApi(Resource):
    @console_ns.expect(console_ns.models[ExternalContactCreateRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[ExternalContactCreateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        ExternalContactCreateRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/external/<uuid:contact_id>")
class WorkspaceExternalContactApi(Resource):
    @console_ns.expect(console_ns.models[ExternalContactUpdateRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[ExternalContactUpdateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def patch(self, tenant_id: str, contact_id: str):
        ExternalContactUpdateRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/remove")
class WorkspaceContactsRemoveApi(Resource):
    @console_ns.expect(console_ns.models[RemoveContactsRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[RemoveContactsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        RemoveContactsRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/im-integration")
class WorkspaceIMIntegrationApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[GetIMIntegrationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        _raise_stub_not_implemented()

    @console_ns.expect(console_ns.models[UpdateIMIntegrationRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[UpdateIMIntegrationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def put(self, tenant_id: str):
        UpdateIMIntegrationRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()

    @console_ns.doc(params=query_params_from_model(DeleteIMIntegrationQuery))
    @console_ns.response(204, "IM integration deleted successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def delete(self, tenant_id: str):
        query_params_from_request(DeleteIMIntegrationQuery)
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/im-integration/test")
class WorkspaceIMIntegrationTestApi(Resource):
    @console_ns.expect(console_ns.models[TestIMIntegrationRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[TestIMIntegrationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        TestIMIntegrationRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/im-sync-runs")
class WorkspaceIMSyncRunsApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[CreateIMSyncRunResponse.__name__])
    @console_ns.response(404, "IM Integration not configured", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(409, "IM Integration revision changed", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(
        503,
        "IM synchronization temporarily unavailable",
        console_ns.models[IMContactSyncErrorResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account):
        try:
            run = build_im_contact_sync_application().sync_service.create_or_get_active_run(
                _workspace_scope(tenant_id),
                AccountId(current_user.id),
            )
        except (
            IMIntegrationNotConfiguredError,
            IMSyncDispatchUnavailableError,
            IMSyncRevisionChangedError,
            IMWriteUnavailableError,
        ) as error:
            return _im_application_error_response(error)
        return dump_response(CreateIMSyncRunResponse, {"run": _sync_run_payload(run)})


@console_ns.route("/workspaces/current/human-input/im-sync-runs/latest")
class WorkspaceLatestIMSyncRunApi(Resource):
    @console_ns.doc(
        description=(
            "Return the latest IM sync run summary. The UI uses finished_at as the explicit sync time; "
            "the response does not include started_by."
        )
    )
    @console_ns.response(200, "Success", console_ns.models[GetLatestIMSyncRunResponse.__name__])
    @console_ns.response(404, "Latest IM sync run not found", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        try:
            run = build_im_contact_sync_application().sync_service.get_latest_run(_workspace_scope(tenant_id))
        except (IMIntegrationNotConfiguredError, IMSyncRunNotFoundError) as error:
            return _im_application_error_response(error)
        return dump_response(GetLatestIMSyncRunResponse, {"run": _sync_run_payload(run)})


@console_ns.route("/workspaces/current/human-input/im-sync-runs/latest/results")
class WorkspaceLatestIMSyncRunResultsApi(Resource):
    @console_ns.doc(
        params=query_params_from_model(ListLatestIMSyncRunResultsQuery),
        description=(
            "Return one required result bucket from the latest IM sync run using page and limit pagination. "
            "There is no all filter; the response contains page, limit, and total metadata without a run summary."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[ListLatestIMSyncRunResultsResponse.__name__])
    @console_ns.response(404, "Latest IM sync run not found", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query = ListLatestIMSyncRunResultsQuery.model_validate(request.args.to_dict(flat=True))
        try:
            result_page = build_im_contact_sync_application().sync_service.list_latest_results(
                _workspace_scope(tenant_id),
                query.result,
                page=query.page,
                limit=query.limit,
            )
        except (IMIntegrationNotConfiguredError, IMSyncRunNotFoundError) as error:
            return _im_application_error_response(error)
        return dump_response(
            ListLatestIMSyncRunResultsResponse,
            {
                "data": [{"id": result.id, "result": _sync_result_payload(result)} for result in result_page.items],
                "page": result_page.page,
                "limit": result_page.limit,
                "total": result_page.total,
            },
        )


@console_ns.route("/workspaces/current/human-input/im-identities")
class WorkspaceIMIdentitiesApi(Resource):
    @console_ns.doc(params=query_params_from_model(ListIMIdentitiesQuery))
    @console_ns.response(200, "Success", console_ns.models[ListIMIdentitiesResponse.__name__])
    @console_ns.response(404, "IM Integration not configured", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query = ListIMIdentitiesQuery.model_validate(request.args.to_dict(flat=True))
        try:
            identity_page = build_im_contact_sync_application().sync_service.search_identities(
                _workspace_scope(tenant_id),
                keyword=query.keyword,
                page=query.page,
                limit=query.limit,
            )
        except IMIntegrationNotConfiguredError as error:
            return _im_application_error_response(error)
        return dump_response(
            ListIMIdentitiesResponse,
            {
                "data": identity_page.items,
                "page": identity_page.page,
                "limit": identity_page.limit,
                "total": identity_page.total,
            },
        )


@console_ns.route("/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override")
class WorkspaceContactIMOverrideApi(Resource):
    @console_ns.doc(
        description=(
            "Set or reset the IM override for a contact. "
            "This endpoint is used to override the IM identity for a contact in the workspace."
        ),
    )
    @console_ns.expect(console_ns.models[SetContactIMOverrideRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[SetContactIMOverrideResponse.__name__])
    @console_ns.response(
        404,
        "Contact or IM identity not found",
        console_ns.models[IMContactSyncErrorResponse.__name__],
    )
    @console_ns.response(409, "IM binding conflict", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(422, "Invalid binding scope", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(503, "IM write unavailable", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_user
    @with_current_tenant_id
    def put(self, tenant_id: str, current_user: Account, contact_id: str):
        request_body = SetContactIMOverrideRequest.model_validate(console_ns.payload or {})
        tenant_id = TenantId(tenant_id)
        try:
            contact = build_im_contact_sync_application().binding_service.set_workspace_override(
                organization_scope=WorkspaceScope(id=tenant_id),
                tenant_id=tenant_id,
                contact_id=ContactId(contact_id),
                identity_id=IMIdentityId(request_body.identity_id),
                bound_by_account_id=AccountId(current_user.id),
            )
        except (IMBindingCommandError, IMWriteUnavailableError) as error:
            return _im_application_error_response(error)
        return dump_response(SetContactIMOverrideResponse, {"contact": _contact_binding_payload(contact)})

    @console_ns.doc(
        description=(
            "Reset the IM override for a contact. "
            "This endpoint is used to clear the IM identity override for a contact in the workspace."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[ResetContactIMOverrideResponse.__name__])
    @console_ns.response(404, "Contact not found", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(422, "Invalid binding scope", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(503, "IM write unavailable", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, contact_id: str):
        tenant_id = TenantId(tenant_id)
        try:
            contact = build_im_contact_sync_application().binding_service.reset_workspace_override(
                organization_scope=WorkspaceScope(id=tenant_id),
                tenant_id=tenant_id,
                contact_id=ContactId(contact_id),
            )
        except (IMBindingCommandError, IMWriteUnavailableError) as error:
            return _im_application_error_response(error)
        return dump_response(ResetContactIMOverrideResponse, {"contact": _contact_binding_payload(contact)})


@console_ns.route("/workspaces/current/human-input/contacts/<uuid:contact_id>/im-bindings")
class WorkspaceContactIMBindingsApi(Resource):
    @console_ns.doc(
        description=(
            "Set an IM binding for a contact. Used for binding an IM identity to a contact. "
            "This endpoint is not used for creating workspace IM override. "
            "For that purpose, use WorkspaceContactIMOverrideApi.put instead."
        ),
    )
    @console_ns.expect(console_ns.models[CreateIMBindingRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[CreateIMBindingResponse.__name__])
    @console_ns.response(
        404,
        "Contact or IM identity not found",
        console_ns.models[IMContactSyncErrorResponse.__name__],
    )
    @console_ns.response(409, "IM binding conflict", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(503, "IM write unavailable", console_ns.models[IMContactSyncErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_user
    @with_current_tenant_id
    def put(self, tenant_id: str, current_user: Account, contact_id: str):
        request_body = CreateIMBindingRequest.model_validate(console_ns.payload or {})
        tenant_id = TenantId(tenant_id)
        try:
            contact = build_im_contact_sync_application().binding_service.create_organization_binding(
                organization_scope=WorkspaceScope(id=tenant_id),
                tenant_id=tenant_id,
                contact_id=ContactId(contact_id),
                identity_id=IMIdentityId(request_body.identity_id),
                bound_by_account_id=AccountId(current_user.id),
            )
        except (IMBindingCommandError, IMWriteUnavailableError) as error:
            return _im_application_error_response(error)
        return dump_response(CreateIMBindingResponse, {"contact": _contact_binding_payload(contact)})

    @console_ns.response(200, "Success", console_ns.models[DeleteIMBindingResponse.__name__])
    @console_ns.response(404, "IM binding not found", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.response(503, "IM write unavailable", console_ns.models[IMContactSyncErrorResponse.__name__])
    @console_ns.doc(
        params=query_params_from_model(DeleteIMBindingQuery),
        description=(
            "Delete an IM binding for a contact. Used for removing contact IM binding information. "
            "This endpoint is not used for resetting workspace IM override. For that purpose, use "
            "WorkspaceContactIMOverrideApi.delete instead."
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, contact_id: str):
        query = query_params_from_request(DeleteIMBindingQuery)
        try:
            build_im_contact_sync_application().binding_service.delete_organization_binding(
                organization_scope=_workspace_scope(tenant_id),
                contact_id=ContactId(contact_id),
                binding_id=IMBindingId(query.binding_id),
            )
        except (IMBindingCommandError, IMWriteUnavailableError) as error:
            return _im_application_error_response(error)
        return dump_response(DeleteIMBindingResponse, {})


@console_ns.route("/workspaces/current/human-input/contacts/batch")
class BatchGetContactsAPI(Resource):
    @console_ns.doc(
        params=query_params_from_model(BatchGetContactsQuery),
        description=(
            "Admin-only batch lookup for Contact management clients. "
            "Workflow editors must use the editor-safe contact-options/batch projection."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[BatchGetContactsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query_params_from_request(BatchGetContactsQuery, list_fields=("contact_ids",))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contact-options/batch")
class BatchGetContactOptionsAPI(Resource):
    """Resolve persisted Contact IDs through the same editor-safe selection projection."""

    @console_ns.doc(
        params=query_params_from_model(BatchGetContactOptionsQuery),
        description=(
            "Resolve Contact IDs persisted in workflow recipient configuration. "
            "Contacts that resolve as ABSENT or are otherwise unavailable in the current workspace are omitted."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[BatchGetContactOptionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query_params_from_request(BatchGetContactOptionsQuery, list_fields=("contact_ids",))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/node-data-migration")
class NodeDataMigrationAPI(Resource):
    @console_ns.doc(
        description=(
            "Migrate node data from HITLv1 to HITLv2. "
            'A missing legacy version defaults to "1"; any other explicit version is rejected. '
            "Every legacy Email recipient becomes onetime_email, while whole_workspace becomes "
            "all_workspace_contacts. This side-effect-free endpoint only returns migrated node data; "
            "the caller owns applying it to the Draft workflow."
        ),
    )
    @console_ns.expect(console_ns.models[NodeDataMigrationPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[NodeDataMigrationResponse.__name__])
    @console_ns.response(400, "Migration failed", console_ns.models[NodeDataMigrationFailureResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        request_body = NodeDataMigrationPayload.model_validate(console_ns.payload or {})
        outcome = build_human_input_node_data_migration_service().migrate(
            tenant_id=TenantId(tenant_id),
            nodes=tuple(
                MigrationNode.from_preflight(
                    node.node_id,
                    preflight_legacy_human_input_node_data(node.node_data),
                )
                for node in request_body.nodes
            ),
        )
        if isinstance(outcome, NodeDataMigrationFailure):
            return (
                dump_response(
                    NodeDataMigrationFailureResponse,
                    {
                        "message": "Human Input node-data migration failed.",
                        "blockers": outcome.blockers,
                    },
                ),
                HTTPStatus.BAD_REQUEST,
            )
        return dump_response(NodeDataMigrationResponse, outcome)
