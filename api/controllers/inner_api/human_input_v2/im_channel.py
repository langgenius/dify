"""Deployment IM Channel controller stubs using the existing Inner API Namespace.

Handlers accept Flask path arguments. Their implementation will parse body/query
values with the declared Pydantic models and serialize the response DTOs.
The runtime controller registry does not load this module while its bodies are empty.
"""

from typing import Annotated, Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import Field, StringConstraints

from controllers.common.human_input_v2.provider_updates import IMProviderCredentialsUpdateInput
from controllers.common.human_input_v2.provider_views import IMProviderCredentialsResponse
from controllers.common.human_input_v2.providers import IMProviderCredentialsInput
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.human_input_v2.entities import ChannelKind, IMProvider
from fields.base import ResponseModel
from fields.timestamp import Timestamp
from repositories.human_input_v2.im_channel_repository import IMChannelStatus

from .contracts import APIErrorResponse, RequestModel

type ConfigVersion = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class IMChannelProvider(ResponseModel):
    provider: IMProvider
    connection_mode: Literal["custom_app"] = "custom_app"


class ListIMChannelProvidersResponse(ResponseModel):
    im_providers: list[IMChannelProvider]


class IMChannelSummary(ResponseModel):
    """CE Channel summary narrowed to the deployment's IM Channel."""

    id: str
    created_at: Timestamp
    updated_at: Timestamp
    kind: Literal[ChannelKind.IM] = ChannelKind.IM
    provider: IMProvider
    status: IMChannelStatus
    status_description: str
    display_identifier: str
    webhook_url: str | None = Field(description="None when no webhook configuration is required.")
    config_version: ConfigVersion


class ListIMChannelsResponse(ResponseModel):
    channels: list[IMChannelSummary] = Field(max_length=1)


class IMChannelDetailResponse(ResponseModel):
    summary: IMChannelSummary
    credentials: IMProviderCredentialsResponse


class IMChannelMutationResponse(ResponseModel):
    summary: IMChannelSummary


class IMChannelCreatePayload(RequestModel):
    credentials: IMProviderCredentialsInput


class IMChannelTestPayload(RequestModel):
    credentials: IMProviderCredentialsInput


class IMChannelUpdatePayload(RequestModel):
    """Every credential leaf is explicit: replacement, unchanged, or optional null."""

    credentials: IMProviderCredentialsUpdateInput
    expected_config_version: ConfigVersion


class IMChannelReplacementPayload(RequestModel):
    credentials: IMProviderCredentialsInput
    expected_config_version: ConfigVersion


class IMChannelDeleteQuery(RequestModel):
    expected_config_version: ConfigVersion


class IMChannelDeleteResponse(ResponseModel):
    channel_id: str


class IMChannelTestResponse(ResponseModel):
    status: IMChannelStatus
    status_description: str


register_schema_models(
    inner_api_ns,
    IMChannelCreatePayload,
    IMChannelTestPayload,
    IMChannelUpdatePayload,
    IMChannelReplacementPayload,
    IMChannelDeleteQuery,
)
register_response_schema_models(
    inner_api_ns,
    ListIMChannelProvidersResponse,
    ListIMChannelsResponse,
    IMChannelDetailResponse,
    IMChannelMutationResponse,
    IMChannelDeleteResponse,
    IMChannelTestResponse,
)


@inner_api_ns.route("/enterprise/human-input/v2/channel-providers")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelProvidersApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListIMChannelProvidersResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> ListIMChannelProvidersResponse:
        """List available IM providers for deployment Channel configuration.

        GET /inner/api/enterprise/human-input/v2/channel-providers.

        Pre: authenticated EE caller and empty query.
        Post: return supported IM providers, even without a Channel; no I/O to providers.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelsApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListIMChannelsResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> ListIMChannelsResponse:
        """List the deployment's current IM Channel, or an empty collection if unconfigured.

        GET /inner/api/enterprise/human-input/v2/channels.

        Pre: authenticated EE caller and empty query.
        Post: return zero or one deployment Channel; no connectivity test or sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelCreateApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelCreatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def post(self) -> IMChannelMutationResponse:
        """Create the deployment's IM Channel from complete provider credentials.

        POST /inner/api/enterprise/human-input/v2/channels.

        Pre: authenticated EE caller and complete new credentials.
        Post: create only when unconfigured; conflict otherwise; never start sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelDetailResponse.__name__])
    @enterprise_inner_api_only
    def get(self, channel_id: UUID) -> IMChannelDetailResponse:
        """Read the current IM Channel's safe configuration and opaque version.

        GET /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller, parsed path, and empty query.
        Post: return safe current configuration or 404; no state change.
        """
        ...

    @inner_api_ns.expect(inner_api_ns.models[IMChannelUpdatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def patch(self, channel_id: UUID) -> IMChannelMutationResponse:
        """Update the current IM Channel without replacing its ID or provider namespace.

        PATCH /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller, explicit field edits, and addressed opaque version.
        Post: preserve Channel ID and bindings; 404/409 or invalid credentials leave state unchanged.
        """
        ...

    @inner_api_ns.doc(params=query_params_from_model(IMChannelDeleteQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelDeleteResponse.__name__])
    @enterprise_inner_api_only
    def delete(self, channel_id: UUID) -> IMChannelDeleteResponse:
        """Delete the current IM Channel only if its configuration version still matches.

        DELETE /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller and addressed opaque version.
        Post: delete current configuration; stale requests preserve all current state.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>:replace")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelReplacementApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelReplacementPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def post(self, channel_id: UUID) -> IMChannelMutationResponse:
        """Replace the current IM Channel with a new Channel and provider configuration.

        POST /inner/api/enterprise/human-input/v2/channels/{channel_id}:replace.

        Pre: authenticated EE caller, complete credentials, and addressed opaque version.
        Post: atomically replace with a new ID; failure preserves old state; never start sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels:test")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelTestApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelTestPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelTestResponse.__name__])
    @enterprise_inner_api_only
    def post(self) -> IMChannelTestResponse:
        """Test complete candidate IM credentials without saving a Channel.

        POST /inner/api/enterprise/human-input/v2/channels:test.

        Pre: authenticated EE caller and complete candidate credentials.
        Post: return expected provider failure as HTTP 200; never persist or start sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>:test")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelSavedTestApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelUpdatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelTestResponse.__name__])
    @enterprise_inner_api_only
    def post(self, channel_id: UUID) -> IMChannelTestResponse:
        """Test the saved IM configuration or temporary credential edits without saving.

        POST /inner/api/enterprise/human-input/v2/channels/{channel_id}:test.

        Pre: authenticated EE caller, current ID/version, and explicit same-provider field instructions.
        Post: test merged credentials without saving, changing status/revision, or starting sync.
        """
        ...
