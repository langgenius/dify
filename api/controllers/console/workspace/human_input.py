"""Workspace-level Human Input v2 controller stubs."""

from __future__ import annotations

from http import HTTPStatus

from flask import abort, request
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    AddPlatformContactsRequest,
    AddPlatformContactsResponse,
    BatchGetContactsQuery,
    BatchGetContactsResponse,
    ContactListQuery,
    CreateHITLMigrationResponse,
    CreateIMBindingRequest,
    CreateIMBindingResponse,
    CreateIMSyncRunResponse,
    CreateNodeDataMigrationRequest,
    DeleteIMBindingQuery,
    DeleteIMBindingResponse,
    ExternalContactCreateRequest,
    ExternalContactCreateResponse,
    ExternalContactUpdateRequest,
    ExternalContactUpdateResponse,
    GetIMIntegrationResponse,
    GetLatestIMSyncRunResponse,
    HumanInputContact,
    HumanInputContactType,
    IMIntegrationStatus,
    IMProvider,
    IMSyncReason,
    IMSyncResultType,
    IMSyncRunStatus,
    ListContactsResponse,
    ListIMIdentitiesQuery,
    ListIMIdentitiesResponse,
    ListLatestIMSyncRunResultsQuery,
    ListLatestIMSyncRunResultsResponse,
    ListOrganizationCandidatesResponse,
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
from controllers.common.schema import (
    query_params_from_model,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
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
    IMSyncReason,
    IMSyncResultType,
    IMProvider,
)
register_schema_models(
    console_ns,
    ContactListQuery,
    OrganizationCandidatesQuery,
    AddPlatformContactsRequest,
    ExternalContactCreateRequest,
    RemoveContactsRequest,
    UpdateIMIntegrationRequest,
    TestIMIntegrationRequest,
    ListIMIdentitiesQuery,
    ListLatestIMSyncRunResultsQuery,
    SetContactIMOverrideRequest,
)
register_response_schema_models(
    console_ns,
    HumanInputContact,
    ExternalContactCreateResponse,
    ExternalContactUpdateResponse,
    AddPlatformContactsResponse,
    ListContactsResponse,
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
    @with_current_tenant_id
    def get(self, tenant_id: str):
        ContactListQuery.model_validate(request.args.to_dict(flat=True))
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
        ExternalContactCreateRequest.model_validate(console_ns.payload or {})
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
    @console_ns.doc(params=query_params_from_model(ListLatestIMSyncRunResultsQuery))
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
        SetContactIMOverrideRequest.model_validate(console_ns.payload or {})
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
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/contacts/batch")
class BatchGetContactsAPI(Resource):
    @console_ns.doc(
        params=query_params_from_model(BatchGetContactsQuery),
        description=(
            "Batch get contacts by their IDs. Used for retrieving contact information for workflow orchestration."
        ),
    )
    @console_ns.response(200, "Success", console_ns.models[BatchGetContactsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        _raise_stub_not_implemented()


@console_ns.route("/workspaces/current/human-input/node-data-migration")
class NodeDataMigrationAPI(Resource):
    @console_ns.doc(
        description=(
            "Migrate node data from HITLv1 to HITLv2. "
            "This endpoint only returns the migrated Human Input v2 node data to the client."
            "It does not update the workflow DSL."
        ),
    )
    @console_ns.expect(console_ns.models[CreateNodeDataMigrationRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[CreateHITLMigrationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        _raise_stub_not_implemented()
