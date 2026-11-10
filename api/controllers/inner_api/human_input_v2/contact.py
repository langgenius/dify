"""Design-only deployment Contact reads and Organization default binding commands.

Contact availability, joined_at, current Channel scoping, and atomic binding
replacement belong to Dify services. EE supplies neither workspace nor owner IDs.
Handler bodies are empty; the runtime controller registry does not load this module.
"""

from uuid import UUID

from flask_restx import Resource
from pydantic import Field

from controllers.common.human_input_v2_contracts import (
    ContactIMIdentityDetail,
    CreateIMBindingRequest,
    ListIMIdentitiesQuery,
    ListIMIdentitiesResponse,
)
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.human_input_v2.entities import IMBindingId, IMProvider
from core.human_input_v2.shared import ContactId
from fields.base import ResponseModel
from fields.pagination import PaginationParamsMixin, PaginationResultMixin
from fields.timestamp import Timestamp

from .contracts import APIErrorResponse, RequestModel


class ListOrganizationContactsQuery(PaginationParamsMixin, RequestModel):
    """CE keyword and pagination without a workspace-relative group filter."""

    keyword: str | None = None


class OrganizationIMBinding(ResponseModel):
    """Only the Organization default is exposed; workspace overrides are excluded."""

    id: IMBindingId
    provider: IMProvider


class OrganizationIMBindingDetail(ResponseModel):
    id: IMBindingId
    provider: IMProvider
    identity: ContactIMIdentityDetail


class OrganizationContact(ResponseModel):
    """Account-backed deployment view, independent of workspace membership."""

    id: ContactId
    name: str
    email: str | None = Field(description="None follows the CE nullable email contract.")
    avatar_url: str
    joined_at: Timestamp = Field(description="Account.created_at, never Contact.created_at.")
    im_bindings: list[OrganizationIMBinding] = Field(max_length=1)


class ListOrganizationContactsResponse(PaginationResultMixin, ResponseModel):
    data: list[OrganizationContact]


class GetOrganizationContactResponse(ResponseModel):
    contact: OrganizationContact
    im_binding_details: list[OrganizationIMBindingDetail] = Field(max_length=1)


class SetOrganizationIMBindingResponse(ResponseModel):
    contact: OrganizationContact


class DeleteIMBindingResponse(ResponseModel):
    binding_id: IMBindingId = Field(
        description="Identifier of the Organization default binding deleted by this operation."
    )


register_schema_models(inner_api_ns, CreateIMBindingRequest)
register_response_schema_models(
    inner_api_ns,
    ListOrganizationContactsResponse,
    GetOrganizationContactResponse,
    ListIMIdentitiesResponse,
    SetOrganizationIMBindingResponse,
    DeleteIMBindingResponse,
)


@inner_api_ns.route("/enterprise/human-input/v2/contacts")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class OrganizationContactsApi(Resource):
    @inner_api_ns.doc(params=query_params_from_model(ListOrganizationContactsQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListOrganizationContactsResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> ListOrganizationContactsResponse:
        """Search available deployment Contacts by name or email with page-based pagination.

        GET /inner/api/enterprise/human-input/v2/contacts.

        Pre: authenticated EE caller and effective page/limit (1/20 by default).
        Post: return current available Account-backed Contacts; never initialize or repair them.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/contacts/<uuid:contact_id>")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class OrganizationContactApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[GetOrganizationContactResponse.__name__])
    @enterprise_inner_api_only
    def get(self, contact_id: UUID) -> GetOrganizationContactResponse:
        """Read an available deployment Contact and its Organization default binding details.

        GET /inner/api/enterprise/human-input/v2/contacts/{contact_id}.

        Pre: authenticated EE caller, parsed Contact ID, and empty query.
        Post: return Contact and default-binding details or 404; never repair projection.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/identities")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMIdentitiesApi(Resource):
    @inner_api_ns.doc(params=query_params_from_model(ListIMIdentitiesQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListIMIdentitiesResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> ListIMIdentitiesResponse:
        """Search synchronized identities in the current deployment IM Channel.

        GET /inner/api/enterprise/human-input/v2/identities.

        Pre: authenticated EE caller and parsed CE search query.
        Post: search the current deployment Channel; 404 if absent, empty before first sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/contacts/<uuid:contact_id>/bindings")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class OrganizationContactIMBindingsApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[CreateIMBindingRequest.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[SetOrganizationIMBindingResponse.__name__])
    @enterprise_inner_api_only
    def put(self, contact_id: UUID) -> SetOrganizationIMBindingResponse:
        """Set a Contact's Organization default binding, replacing occupied defaults atomically.

        PUT /inner/api/enterprise/human-input/v2/contacts/{contact_id}/bindings.

        Pre: authenticated EE caller, available Contact, and current synchronized identity_id.
        Post: atomically replace occupied defaults; preserve an identical binding ID and all overrides.
        Failure leaves existing defaults unchanged. Return the updated Contact, not identity details.
        """
        ...

    @inner_api_ns.response(200, "Success", inner_api_ns.models[DeleteIMBindingResponse.__name__])
    @enterprise_inner_api_only
    def delete(self, contact_id: UUID) -> DeleteIMBindingResponse:
        """Remove a Contact's Organization default binding while preserving workspace overrides.

        DELETE /inner/api/enterprise/human-input/v2/contacts/{contact_id}/bindings.

        Pre: authenticated EE caller and current default binding for this Contact.
        Post: remove only that default and return its binding_id after commit; absent binding returns 404.
        """
        ...
