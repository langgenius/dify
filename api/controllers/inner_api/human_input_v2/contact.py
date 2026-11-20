"""Deployment Contact queries and Organization default binding transport."""

from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import Field
from sqlalchemy.orm import Session

from controllers.common.human_input_v2_contracts import (
    ContactIMIdentityDetail,
    CreateIMBindingRequest,
    IMIdentity,
    ListIMIdentitiesQuery,
    ListIMIdentitiesResponse,
)
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.common.session import with_session
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.human_input_v2.entities import IMBindingId, IMProvider
from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode
from core.human_input_v2.shared import ContactId, DeploymentScope, IMIdentityId
from fields.base import ResponseModel
from fields.pagination import PaginationParamsMixin, PaginationResultMixin
from fields.timestamp import Timestamp
from libs.exception import RelayedHTTPError
from libs.helper import build_avatar_url
from repositories.human_input_v2.contact import OrganizationContact as OrganizationContactRecord
from services.human_input_v2.contact_service import ContactWithIMBindings
from services.human_input_v2.contact_service_composition import build_deployment_contact_service
from services.human_input_v2.im_contact_sync.composition import build_im_sync_service
from services.human_input_v2.im_contact_sync.service import IMChannelNotConfiguredError

from .contracts import APIErrorResponse, RequestModel, parse_request


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
    @with_session(write=False)
    def get(self, session: Session) -> dict[str, object]:
        """Search available deployment Contacts by name or email with page-based pagination.

        GET /inner/api/enterprise/human-input/v2/contacts.

        Pre: authenticated EE caller and effective page/limit (1/20 by default).
        Post: return current available Account-backed Contacts; never initialize or repair them.
        """
        query = parse_request(ListOrganizationContactsQuery, request.args.to_dict(flat=True))
        service = build_deployment_contact_service(session, for_update=False)
        contacts = service.list_organization_contacts(
            DeploymentScope(), page=query.page, limit=query.limit, keyword=query.keyword or ""
        )
        total = service.count_organization_contacts(DeploymentScope(), query.keyword or "")
        return ListOrganizationContactsResponse(
            data=[_contact(view) for view in contacts.items],
            page=contacts.page,
            limit=contacts.limit,
            total=total,
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/contacts/<uuid:contact_id>")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class OrganizationContactApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[GetOrganizationContactResponse.__name__])
    @enterprise_inner_api_only
    @with_session(write=False)
    def get(self, session: Session, contact_id: UUID) -> dict[str, object]:
        """Read an available deployment Contact and its Organization default binding details.

        GET /inner/api/enterprise/human-input/v2/contacts/{contact_id}.

        Pre: authenticated EE caller, parsed Contact ID, and empty query.
        Post: return Contact and default-binding details or 404; never repair projection.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        details = build_deployment_contact_service(session, for_update=False).get_organization_contact_details(
            DeploymentScope(), ContactId(str(contact_id))
        )
        if details is None:
            raise RelayedHTTPError(status=404, error_code="contact_not_found", message="Contact was not found")
        return GetOrganizationContactResponse(
            contact=_contact(details.contact),
            im_binding_details=[
                OrganizationIMBindingDetail(
                    id=detail.binding.id,
                    provider=detail.binding.provider,
                    identity=ContactIMIdentityDetail.model_validate(detail.identity, from_attributes=True),
                )
                for detail in details.im_binding_details
            ],
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/identities")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMIdentitiesApi(Resource):
    @inner_api_ns.doc(params=query_params_from_model(ListIMIdentitiesQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListIMIdentitiesResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> dict[str, object]:
        """Search synchronized identities in the current deployment IM Channel.

        GET /inner/api/enterprise/human-input/v2/identities.

        Pre: authenticated EE caller and parsed CE search query.
        Post: search the current deployment Channel; 404 if absent, empty before first sync.
        """
        query = parse_request(ListIMIdentitiesQuery, request.args.to_dict(flat=True))
        try:
            identities = build_im_sync_service().search_identities(
                DeploymentScope(),
                keyword=query.keyword,
                page=query.page,
                limit=query.limit,
            )
        except IMChannelNotConfiguredError:
            raise RelayedHTTPError(
                status=404, error_code="im_integration_not_configured", message="IM Channel is not configured"
            ) from None
        return ListIMIdentitiesResponse(
            data=[IMIdentity.model_validate(identity, from_attributes=True) for identity in identities.items],
            page=identities.page,
            limit=identities.limit,
            total=identities.total,
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/contacts/<uuid:contact_id>/bindings")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class OrganizationContactIMBindingsApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[CreateIMBindingRequest.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[SetOrganizationIMBindingResponse.__name__])
    @enterprise_inner_api_only
    @with_session
    def put(self, session: Session, contact_id: UUID) -> dict[str, object]:
        """Set a Contact's Organization default binding, replacing occupied defaults atomically.

        PUT /inner/api/enterprise/human-input/v2/contacts/{contact_id}/bindings.

        Pre: authenticated EE caller, available Contact, and current synchronized identity_id.
        Post: atomically replace occupied defaults; preserve an identical binding ID and all overrides.
        Failure leaves existing defaults unchanged. Return the updated Contact, not identity details.
        """
        payload = parse_request(CreateIMBindingRequest, inner_api_ns.payload or {})
        try:
            view = build_deployment_contact_service(session, for_update=True).set_organization_im_binding(
                DeploymentScope(), ContactId(str(contact_id)), IMIdentityId(payload.identity_id)
            )
        except IMBindingCommandError as error:
            status = 409 if error.code is IMBindingCommandErrorCode.BINDING_CONFLICT else 404
            raise RelayedHTTPError(status=status, error_code=error.code.value, message=str(error)) from None
        return SetOrganizationIMBindingResponse(contact=_contact(view)).model_dump(mode="json")

    @inner_api_ns.response(200, "Success", inner_api_ns.models[DeleteIMBindingResponse.__name__])
    @enterprise_inner_api_only
    @with_session
    def delete(self, session: Session, contact_id: UUID) -> dict[str, object]:
        """Remove a Contact's Organization default binding while preserving workspace overrides.

        DELETE /inner/api/enterprise/human-input/v2/contacts/{contact_id}/bindings.

        Pre: authenticated EE caller and current default binding for this Contact.
        Post: remove only that default and return its binding_id after commit; absent binding returns 404.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        try:
            binding_id = build_deployment_contact_service(session, for_update=True).delete_organization_im_binding(
                DeploymentScope(), ContactId(str(contact_id))
            )
        except IMBindingCommandError as error:
            raise RelayedHTTPError(status=404, error_code=error.code.value, message=str(error)) from None
        return DeleteIMBindingResponse(binding_id=binding_id).model_dump(mode="json")


def _contact(view: ContactWithIMBindings[OrganizationContactRecord]) -> OrganizationContact:
    """Require current Account projection; expose only Organization defaults and Account join time."""
    return OrganizationContact(
        id=view.contact.id,
        name=view.contact.name,
        email=view.contact.email,
        avatar_url=build_avatar_url(view.contact.avatar_file_id) or "",
        joined_at=view.contact.joined_at,
        im_bindings=[OrganizationIMBinding(id=binding.id, provider=binding.provider) for binding in view.im_bindings],
    )
