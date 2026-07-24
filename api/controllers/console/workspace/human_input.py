"""Workspace-level Human Input v2 controller stubs."""

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
    CreateHITLMigrationResponse,
    CreateIMBindingRequest,
    CreateIMBindingResponse,
    CreateIMSyncRunResponse,
    CreateNodeDataMigrationRequest,
    DeleteIMBindingQuery,
    DeleteIMBindingResponse,
    DeleteIMIntegrationQuery,
    ExternalContactCreateRequest,
    ExternalContactCreateResponse,
    ExternalContactUpdateRequest,
    ExternalContactUpdateResponse,
    GetContactResponse,
    GetEmailProviderResponse,
    GetIMIntegrationResponse,
    GetLatestIMSyncRunResponse,
    HumanInputContact,
    HumanInputContactType,
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
    NodeMigrationFailure,
    OrganizationCandidatesQuery,
    RemoveContactsRequest,
    RemoveContactsResponse,
    ResetContactIMOverrideResponse,
    SetContactIMOverrideRequest,
    SetContactIMOverrideResponse,
    SetEmailProviderRequest,
    SetEmailProviderResponse,
    TestIMIntegrationRequest,
    TestIMIntegrationResponse,
    UpdateIMIntegrationRequest,
    UpdateIMIntegrationResponse,
)
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
)
from libs.login import login_required

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
    CreateNodeDataMigrationRequest,
    SetEmailProviderRequest,
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
    GetLatestIMSyncRunResponse,
    ListLatestIMSyncRunResultsResponse,
    ListOrganizationCandidatesResponse,
    ResetContactIMOverrideResponse,
    SetContactIMOverrideResponse,
    CreateIMBindingResponse,
    DeleteIMBindingResponse,
    BatchGetContactsResponse,
    CreateHITLMigrationResponse,
    NodeMigrationFailure,
    GetEmailProviderResponse,
    SetEmailProviderResponse,
)


def _raise_stub_not_implemented() -> None:
    abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 stub endpoint is not implemented yet.")


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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/im-sync-runs/latest")
class WorkspaceLatestIMSyncRunApi(Resource):
    @console_ns.doc(
        description=(
            "Return the latest IM sync run summary. The UI uses finished_at as the explicit sync time; "
            "the response does not include started_by."
        )
    )
    @console_ns.response(200, "Success", console_ns.models[GetLatestIMSyncRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        _raise_stub_not_implemented()


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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        ListLatestIMSyncRunResultsQuery.model_validate(request.args.to_dict(flat=True))
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/im-identities")
class WorkspaceIMIdentitiesApi(Resource):
    @console_ns.doc(params=query_params_from_model(ListIMIdentitiesQuery))
    @console_ns.response(200, "Success", console_ns.models[ListIMIdentitiesResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        ListIMIdentitiesQuery.model_validate(request.args.to_dict(flat=True))
        _raise_stub_not_implemented()


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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def put(self, tenant_id: str, contact_id: str):
        # This API only works in EE.
        SetContactIMOverrideRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()

    @console_ns.doc(
        description=(
            "Reset the IM override for a contact. "
            "This endpoint is used to clear the IM identity override for a contact in the workspace."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[ResetContactIMOverrideResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, contact_id: str):
        # This API only works in EE.
        _raise_stub_not_implemented()


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
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def put(self, tenant_id: str, contact_id: str):
        CreateIMBindingRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()

    @console_ns.response(200, "Success", console_ns.models[DeleteIMBindingResponse.__name__])
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
        query_params_from_request(DeleteIMBindingQuery)
        _raise_stub_not_implemented()


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
            "This endpoint only returns the migrated Human Input v2 node data to the client. "
            "It does not update the workflow DSL."
        ),
    )
    @console_ns.expect(console_ns.models[CreateNodeDataMigrationRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[CreateHITLMigrationResponse.__name__])
    @console_ns.response(400, "Migration failed", console_ns.models[NodeMigrationFailure.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        CreateNodeDataMigrationRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/email-provider")
class HumanInputEmailProviderAPI(Resource):
    @console_ns.doc(description="Retrieve the current email provider settings for human input")
    @console_ns.response(200, "Success", console_ns.models[GetEmailProviderResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        _raise_stub_not_implemented()

    @console_ns.doc(description="update the current email provider settings for human input")
    @console_ns.expect(console_ns.models[SetEmailProviderRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[SetEmailProviderResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @with_current_tenant_id
    def put(self, tenant_id: str):
        SetEmailProviderRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()
