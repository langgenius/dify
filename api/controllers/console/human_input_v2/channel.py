from __future__ import annotations

from http import HTTPStatus
from typing import Annotated, Literal, Self, Union

from pydantic import BaseModel, ConfigDict, Discriminator, Field, JsonValue, model_validator
from fields.base import ResponseModel
from fields.pagination import PaginationParamsMixin, PaginationResultMixin
from fields.timestamp import Timestamp
from libs.helper import EmailStr
from controllers.common.session import with_session

from ._common import StrictModel
from ._decorator import require_admin_or_owner

from .providers import (
    ChannelKind,
    IMProviderCredentials,
)

type ChannelId = Annotated[NewType("ChannelId", str), StringConstraints(strip_whitespace=True, min_length=1)]

# An opaque string to represent a specific config version. It must be stored it and returnd it exactly as provided.
# The client MUST NOT parse, parse, decode, modify, attempt to interpret it or synthesize it.
#
# The ConfigVersion is not a cryptography-protected text. It is used as a means for information hiding.
type ConfigVersion = NewType("ConfigVersion", str)


class ChannelTestResponse(ResponseModel):
    pass


class ChannelDeleteResponse(ResponseModel):
    # identifier for the channel deleted.
    channel_id: ChannelId


class ChannelStatus(StrEnum):
    # CONNECTED means that the channel is properly connected and ready for use.
    # The credentials is valid and no errors has occurred.
    CONNECTED = "connected"



    # The supplied credentials are invalid. (Wrong client_id / client_secret ete.)
    INVALID_CREDENTIALS = "invalid_credentials"

    #
    CONNECTION_FAILURE = "connection_failure"


class ConnectionMode(StrEnum):
    """ConnectionMode record how should the provider be configred."""
    # CUSTOM_APP corresponds to IM / Email applications managed by the user. When configureing
    # the provider, all credentials (including but not limited to `client_id` and `client_secret`)
    # must be provided by the user.
    CUSTOM_APP = "custom_app"

    # CUSTOM_APP corresponds to IM applications managed by the Dify platform. Generally the user only
    # needs to go through the OAuth procedure to connect corresponding IM / Email providers.
    # MANAGED_APP = "managed_app"


class DeletionQuery(BaseModel):
    """Query arguments used for concurrency control."""
    expected_config_version: ConfigVersion


class ConflictResponse(ResponseModel):
    code: Literal[
        # replacement_required signals that it is not possible to update the channel configuration inplace, and
        # an explicit IM provider replacement is required.
        # This code is only returned for IM channel updates.
        #
        # When this error code is returned, the caller should send a POST request to IMChannelReplaceApi
        # instead.
        "replacement_required",

        # rprovider_configuration_updated is returned when the specified version in the request
        # does not match the state in the server.
        "provider_configuration_updated"
    ]
    message: str
    status: Literal[HTTPStatus.CONFLICT] = HTTPStatus.CONFLICT


class ChannelProvider(StrictModel):
    provider: IMProvider | EmailProvider
    # currently, only `CUSTOM_APP` is returned.
    connection_mode: ConnectionMode


class ListChannelProvidersResponse(ResponseModel):
    email_providers: Sequence[ChannelProvider]
    im_providers: Sequence[ChannelProvider]


@console_ns.route("/workspace/current/human-input/v2/channel-providers")
class ListChannelProvidersApi(Resource):
    @console_ns.doc("list_channel_providers")
    @console_ns.doc(description="List available IM and email sending providers")
    @console_ns.response(200, "Success", console_ns.models[ListChannelProvidersResponse.__name__])
    @setup_required
    @require_admin_or_owner
    def get(self) -> ListChannelProvidersResponse:
        ...


class ChannelSummary(StrictModel):
    # Channel Identifiers, correspond to
    id: ChannelId
    created_at: Timestamp
    updated_at: Timestamp
    kind: ChannelKind
    provider: EmailProvider | IMProvider = Field(..., "The provider of the channel. The actual type depend on the `kind` field.")
    status: ChannelStatus
    status_description: str = Field(..., "Human-readable status description text. Empty if status is CONECTED.")
    display_identifier: str = Field(..., description="The display identifier of the channel")
    webhook_url: str | None = Field(None, description=(
        "webhook url to be configured on the provider side. None if no webhook configuration required. "
        "(E.G. using persisted connection to retrieve event, or webhook is not supported."
    ))
    config_version: ConfigVersion  = Field(..., description="The current configuration version. Use to serialize concurrent update.")


class ListChannelsResponse(ResponseModel):
    channels: Sequence[ChannelSummary]


@console_ns.route("/workspace/current/human-input/v2/channels")
class ListChannelsApi(Resource):
    @console_ns.doc("list_channels")
    @console_ns.doc(description="list configured channels. Currently only one email and one IM channels can be configured.")
    @console_ns.response(200, "Success", console_ns.models[ListChannelsResponse.__name__])
    @require_admin_or_owner
    @with_session(write=False)
    def get(self, session: Session) -> ListChannelsResponse:
        ...


class EmailChannelTestRequest(StrictModel):
    credentials: EmailProviderCredentials


@console_ns.route("/workspace/current/human-input/v2/channels/email/test")
class EmailChannelTestApi(Resource):
    @console_ns.doc("test_email_channel")
    @console_ns.doc(description=(
        "Test email channel credentials. This API does not persist the provided credentials. "
        "Nor does it mutate the existing configured email channels."
    ))
    @console_ns.response(200, "Success", console_ns.models[ChannelTestResponse.__name__])
    @console_ns.expect(console_ns.models[EmailChannelTestRequest.__name__])
    @console_ns.response(400, "Invalid credentials")
    @require_admin_or_owner
    @with_session()
    def post(self, session: Session) -> ChannelTestResponse:
        ...

class EmailChannelCreationRequest(StrictModel):
    credentials: EmailProviderCredentials


class EmailChannelCreationResponse(ResponseModel):
    summary: ChannelSummary


@console_ns.route("/workspace/current/human-input/v2/channels/email")
class EmailChannelCreationApi(Resource):
    @console_ns.doc("create_email_channel")
    @console_ns.doc(description="Create a email channel for sending emails")
    @console_ns.response(200, "Success", console_ns.models[EmailChannelCreationResponse.__name__])
    @console_ns.expect(console_ns.models[EmailChannelCreationRequest.__name__])
    @require_admin_or_owner
    @with_session()
    def post(self, session: Session) -> EmailChannelCreationResponse:
        payload = EmailChannelCreationRequest.model_validate(console_ns.payload or {})
        ...


class EmailChannelGetResponse(ResponseModel):
    summary: ChannelSummary
    sender_name: str
    sender_email: str


class EmailChannelUpdateRequest(StrictModel):
    credentials: EmailProviderCredentials
    expected_config_version: ConfigVersion = Field(..., description="config_version used to ensure updates are serialized.")


class EmailChannelUpdateResponse(ResponseModel):
    summary: ChannelSummary


@console_ns.route("/workspace/current/human-input/v2/channels/email/<uuid:channel_id>")
class EmailChannel(Resource):
    @console_ns.doc("get_email_channel")
    @console_ns.doc(description="Retrieve email channel summary")
    @console_ns.response(200, "Success", console_ns.models[EmailChannelGetResponse.__name__])
    @require_admin_or_owner
    @with_session(write=False)
    def get(self, channel_id: ChannelId, session: Session) -> EmailChannelGetResponse:
        ...

    @console_ns.doc("update_email_channel")
    @console_ns.doc(description="Update a previously configured email channel")
    @console_ns.response(200, "Success", console_ns.models[EmailChannelUpdateResponse.__name__])
    @console_ns.expect(console_ns.models[EmailChannelUpdateRequest.__name__])
    @require_admin_or_owner
    @with_session()
    def put(self, channel_id: ChannelId, session: Session) -> EmailChannelUpdateResponse:
        ...

    @console_ns.doc("delete_email_channel")
    @console_ns.doc(description="delete a previously configured email channel")
    @console_ns.response(200, "Success", console_ns.models[EmailChannelDeleteResponse.__name__])
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "The configuration has already been updated on the server side",
        console_ns.models[ConflictResponse.__name__],
    )
    @console_ns.doc(params=query_params_from_model(DeletionQuery))
    @require_admin_or_owner
    @with_session()
    def delete(self, channel_id: ChannelId, session: Session) -> ChannelDeleteResponse:
        ...



class IMChannelTestRequest(StrictModel):
    credentials: IMProviderCredentials


@console_ns.route("/workspace/current/human-input/v2/channels/im/test")
class IMChannelTestApi(Resource):
    @console_ns.doc("test_im_channel")
    @console_ns.doc(description=(
        "Test IM channel credentials. This API does not persist the provided credentials. "
        "Nor does it mutate the existing configured IM channels."
    ))
    @console_ns.response(200, "Success", console_ns.models[ChannelTestResponse.__name__])
    @console_ns.response(400, "Invalid credentials")
    @require_admin_or_owner
    @with_session()
    def post(self, session: Session) -> ChannelTestResponse:
        ...



class IMChannelCreationRequest(StrictModel):
    credentials: IMProviderCredentials


class IMChannelCreationResponse(ResponseModel):
    summary: ChannelSummary


@console_ns.route("/workspace/current/human-input/v2/channels/im")
class IMChannelCreationApi(Resource):
    @console_ns.doc("create_im_channel")
    @console_ns.doc(description="create IM channel")
    @console_ns.response(200, "Success", console_ns.models[IMChannelCreationResponse.__name__])
    @console_ns.expect(console_ns.models[IMChannelCreationRequest.__name__])
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "The configuration has already been updated on the server side, or a IM channel has already been created.",
        console_ns.models[ConflictResponse.__name__],
    )
    @require_admin_or_owner
    @with_session()
    def post(self, session: Session) -> IMChannelCreationResponse:
        ...


class IMChannelGetResponse(ResponseModel):
    summary: ChannelSummary


class IMChannelUpdateRequest(StrictModel):
    credentials: IMProviderCredentials

    expected_config_version: ConfigVersion = Field(..., description="config_version used to ensure updates are serialized.")


class IMChannelUpdateResponse(ResponseModel):
    summary: ChannelSummary


@console_ns.route("/workspace/current/human-input/v2/channels/im/<uuid:channel_id>")
class IMChannelUpdateApi(Resource):
    @console_ns.doc("get_im_channele")
    @console_ns.doc(description="get IM channel")
    @console_ns.response(200, "Success", console_ns.models[IMChannelGetResponse.__name__])
    @require_admin_or_owner
    @with_session()
    def get(self, channel_id: ChannelId, session: Session) -> IMChannelGetResponse:
        ...

    @console_ns.doc("update_im_channele")
    @console_ns.doc(description="update IM channel")
    @console_ns.response(200, "Success", console_ns.models[IMChannelUpdateResponse.__name__])
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "The configuration has already been updated on the server side, or a replacement is required.",
        console_ns.models[ConflictResponse.__name__],
    )
    @console_ns.expect(console_ns.models[IMChannelUpdateRequest.__name__])
    @require_admin_or_owner
    @with_session()
    def put(self, channel_id: ChannelId, session: Session) -> IMChannelUpdateResponse:
        ...

    @console_ns.doc("delete_im_channel")
    @console_ns.doc(description="delete IM channel")
    @console_ns.doc(params=query_params_from_model(DeletionQuery))
    @console_ns.response(200, "Success", console_ns.models[ChannelDeleteResponse.__name__])
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "The configuration has already been updated on the server side",
        console_ns.models[ConflictResponse.__name__],
    )
    @require_admin_or_owner
    @with_session()
    def delete(self, channel_id: ChannelId, session: Session) -> ChannelDeleteResponse:
        ...


class IMChannelReplaceRequest(StrictModel):
    credentials: IMProviderCredentials
    expected_config_version: ConfigVersion


class IMChannelReplaceResponse(ResponseModel):
    summary: ChannelSummary


@console_ns.route("/workspace/current/human-input/v2/channels/im/<uuid:channel_id>/replacement")
class IMChannelReplaceApi(Resource):
    @console_ns.doc("replace_im_channel")
    @console_ns.doc(description=(
        "replace an exisiting IM channel. A replacement also dissociates exisiting IM bindings "
        "and IM identities. Fresh IM synchronizaiton and reconciliation are required to use "
        "bind IM accounts to contacts."
    ))
    @console_ns.response(200, "Success", console_ns.models[IMChannelReplaceResponse.__name__])
    @console_ns.expect(console_ns.models[IMChannelReplaceRequest.__name__])
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "The configuration has already been updated on the server side",
        console_ns.models[ConflictResponse.__name__],
    )
    @require_admin_or_owner
    @with_session()
    def post(self, session: Session) -> IMChannelReplaceResponse:
        ...
