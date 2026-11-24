"""Deployment IM Channel transport over the shared owner-bound application service."""

from typing import Annotated, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import Field, StringConstraints

from controllers.common.human_input_v2.config_version import (
    InvalidConfigVersionError,
    decode_im_config_version,
    encode_im_config_version,
)
from controllers.common.human_input_v2.provider_updates import IMProviderCredentialsUpdateInput
from controllers.common.human_input_v2.provider_views import IMProviderCredentialsResponse, im_credentials_response
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
from libs.credential_cipher import CredentialCipherError
from libs.exception import RelayedHTTPError
from repositories.human_input_v2.im_channel_repository import IMChannelId, IMChannelStatus
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ReplacementRequiredError,
)
from services.human_input_v2.im_channel_service import IMChannelView
from services.human_input_v2.im_channel_service_composition import build_deployment_im_channel_service
from services.human_input_v2.im_credential_codec import IMCredentialError

from .contracts import APIErrorResponse, RequestModel, parse_request

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
    def get(self) -> dict[str, object]:
        """List available IM providers for deployment Channel configuration.

        GET /inner/api/enterprise/human-input/v2/channel-providers.

        Pre: authenticated EE caller and empty query.
        Post: return supported IM providers, even without a Channel; no I/O to providers.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        providers = build_deployment_im_channel_service().available_providers()
        return ListIMChannelProvidersResponse(
            im_providers=[IMChannelProvider(provider=provider) for provider in providers]
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/channels")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelsApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListIMChannelsResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> dict[str, object]:
        """List the deployment's current IM Channel, or an empty collection if unconfigured.

        GET /inner/api/enterprise/human-input/v2/channels.

        Pre: authenticated EE caller and empty query.
        Post: return zero or one deployment Channel; no connectivity test or sync.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        current = build_deployment_im_channel_service().get_current()
        return ListIMChannelsResponse(channels=[_summary(current)] if current is not None else []).model_dump(
            mode="json"
        )

    @inner_api_ns.expect(inner_api_ns.models[IMChannelCreatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def post(self) -> dict[str, object]:
        """Create the deployment's IM Channel from complete provider credentials.

        POST /inner/api/enterprise/human-input/v2/channels.

        Pre: authenticated EE caller and complete new credentials.
        Post: create only when unconfigured; conflict otherwise; never start sync.
        """
        payload = parse_request(IMChannelCreatePayload, inner_api_ns.payload or {})
        try:
            channel = build_deployment_im_channel_service().create(payload.credentials.to_owner_credentials())
        except ChannelAlreadyConfiguredError:
            raise RelayedHTTPError(
                status=409, error_code="conflict", message="IM Channel is already configured"
            ) from None
        except ChannelProviderError:
            raise RelayedHTTPError(
                status=400, error_code="bad_request", message="The provider configuration could not be verified"
            ) from None
        except (CredentialCipherError, IMCredentialError):
            raise RelayedHTTPError(
                status=503, error_code="credential_unavailable", message="Credential configuration is unavailable"
            ) from None
        return IMChannelMutationResponse(summary=_summary(channel)).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelDetailResponse.__name__])
    @enterprise_inner_api_only
    def get(self, channel_id: UUID) -> dict[str, object]:
        """Read the current IM Channel's safe configuration and opaque version.

        GET /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller, parsed path, and empty query.
        Post: return safe current configuration or 404; no state change.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        try:
            detail = build_deployment_im_channel_service().get_detail(IMChannelId(str(channel_id)))
        except ChannelNotFoundError:
            raise RelayedHTTPError(status=404, error_code="not_found", message="IM Channel was not found") from None
        except (CredentialCipherError, IMCredentialError):
            raise RelayedHTTPError(
                status=503, error_code="credential_unavailable", message="Credential configuration is unavailable"
            ) from None
        return IMChannelDetailResponse(
            summary=_summary(detail.summary), credentials=im_credentials_response(detail.credentials)
        ).model_dump(mode="json")

    @inner_api_ns.expect(inner_api_ns.models[IMChannelUpdatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def patch(self, channel_id: UUID) -> dict[str, object]:
        """Update the current IM Channel without replacing its ID or provider namespace.

        PATCH /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller, explicit field edits, and addressed opaque version.
        Post: preserve Channel ID and bindings; 404/409 or invalid credentials leave state unchanged.
        """
        payload = parse_request(IMChannelUpdatePayload, inner_api_ns.payload or {})
        addressed_id = IMChannelId(str(channel_id))
        try:
            channel = build_deployment_im_channel_service().update(
                addressed_id,
                _revision(payload.expected_config_version, addressed_id),
                payload.credentials.to_owner_update(),
            )
        except ChannelNotFoundError:
            raise RelayedHTTPError(status=404, error_code="not_found", message="IM Channel was not found") from None
        except ProviderConfigurationUpdatedError:
            raise RelayedHTTPError(
                status=409, error_code="provider_configuration_updated", message="IM configuration was updated"
            ) from None
        except ReplacementRequiredError:
            raise RelayedHTTPError(
                status=409, error_code="replacement_required", message="Explicit IM Channel replacement is required"
            ) from None
        except ChannelProviderError:
            raise RelayedHTTPError(
                status=400, error_code="bad_request", message="The provider configuration could not be verified"
            ) from None
        except (CredentialCipherError, IMCredentialError):
            raise RelayedHTTPError(
                status=503, error_code="credential_unavailable", message="Credential configuration is unavailable"
            ) from None
        return IMChannelMutationResponse(summary=_summary(channel)).model_dump(mode="json")

    @inner_api_ns.doc(params=query_params_from_model(IMChannelDeleteQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelDeleteResponse.__name__])
    @enterprise_inner_api_only
    def delete(self, channel_id: UUID) -> dict[str, object]:
        """Delete the current IM Channel only if its configuration version still matches.

        DELETE /inner/api/enterprise/human-input/v2/channels/{channel_id}.

        Pre: authenticated EE caller and addressed opaque version.
        Post: delete current configuration; stale requests preserve all current state.
        """
        query = parse_request(IMChannelDeleteQuery, request.args.to_dict(flat=True))
        addressed_id = IMChannelId(str(channel_id))
        try:
            deleted = build_deployment_im_channel_service().delete(
                addressed_id, _revision(query.expected_config_version, addressed_id)
            )
        except ChannelNotFoundError:
            raise RelayedHTTPError(status=404, error_code="not_found", message="IM Channel was not found") from None
        except ProviderConfigurationUpdatedError:
            raise RelayedHTTPError(
                status=409, error_code="provider_configuration_updated", message="IM configuration was updated"
            ) from None
        return IMChannelDeleteResponse(channel_id=deleted).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>:replace")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelReplacementApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelReplacementPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelMutationResponse.__name__])
    @enterprise_inner_api_only
    def post(self, channel_id: UUID) -> dict[str, object]:
        """Replace the current IM Channel with a new Channel and provider configuration.

        POST /inner/api/enterprise/human-input/v2/channels/{channel_id}:replace.

        Pre: authenticated EE caller, complete credentials, and addressed opaque version.
        Post: atomically replace with a new ID; failure preserves old state; never start sync.
        """
        payload = parse_request(IMChannelReplacementPayload, inner_api_ns.payload or {})
        addressed_id = IMChannelId(str(channel_id))
        try:
            channel = build_deployment_im_channel_service().replace(
                addressed_id,
                _revision(payload.expected_config_version, addressed_id),
                payload.credentials.to_owner_credentials(),
            )
        except ChannelNotFoundError:
            raise RelayedHTTPError(status=404, error_code="not_found", message="IM Channel was not found") from None
        except ProviderConfigurationUpdatedError:
            raise RelayedHTTPError(
                status=409, error_code="provider_configuration_updated", message="IM configuration was updated"
            ) from None
        except ChannelProviderError:
            raise RelayedHTTPError(
                status=400, error_code="bad_request", message="The provider configuration could not be verified"
            ) from None
        except (CredentialCipherError, IMCredentialError):
            raise RelayedHTTPError(
                status=503, error_code="credential_unavailable", message="Credential configuration is unavailable"
            ) from None
        return IMChannelMutationResponse(summary=_summary(channel)).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/channels:test")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelTestApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelTestPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelTestResponse.__name__])
    @enterprise_inner_api_only
    def post(self) -> dict[str, object]:
        """Test complete candidate IM credentials without saving a Channel.

        POST /inner/api/enterprise/human-input/v2/channels:test.

        Pre: authenticated EE caller and complete candidate credentials.
        Post: return expected provider failure as HTTP 200; never persist or start sync.
        """
        payload = parse_request(IMChannelTestPayload, inner_api_ns.payload or {})
        try:
            build_deployment_im_channel_service().test(payload.credentials.to_owner_credentials())
        except ChannelProviderError as error:
            return _test_failure(error).model_dump(mode="json")
        return IMChannelTestResponse(status=IMChannelStatus.CONNECTED, status_description="").model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/channels/<uuid:channel_id>:test")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class IMChannelSavedTestApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[IMChannelUpdatePayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[IMChannelTestResponse.__name__])
    @enterprise_inner_api_only
    def post(self, channel_id: UUID) -> dict[str, object]:
        """Test the saved IM configuration or temporary credential edits without saving.

        POST /inner/api/enterprise/human-input/v2/channels/{channel_id}:test.

        Pre: authenticated EE caller, current ID/version, and explicit same-provider field instructions.
        Post: test merged credentials without saving, changing status/revision, or starting sync.
        """
        payload = parse_request(IMChannelUpdatePayload, inner_api_ns.payload or {})
        addressed_id = IMChannelId(str(channel_id))
        try:
            build_deployment_im_channel_service().test_saved(
                addressed_id,
                _revision(payload.expected_config_version, addressed_id),
                payload.credentials.to_owner_update(),
            )
        except ReplacementRequiredError:
            raise RelayedHTTPError(
                status=400, error_code="bad_request", message="The test provider must match the saved Channel"
            ) from None
        except ChannelProviderError as error:
            return _test_failure(error).model_dump(mode="json")
        except ChannelNotFoundError:
            raise RelayedHTTPError(status=404, error_code="not_found", message="IM Channel was not found") from None
        except ProviderConfigurationUpdatedError:
            raise RelayedHTTPError(
                status=409, error_code="provider_configuration_updated", message="IM configuration was updated"
            ) from None
        except (CredentialCipherError, IMCredentialError):
            raise RelayedHTTPError(
                status=503, error_code="credential_unavailable", message="Credential configuration is unavailable"
            ) from None
        return IMChannelTestResponse(status=IMChannelStatus.CONNECTED, status_description="").model_dump(mode="json")


def _summary(view: IMChannelView) -> IMChannelSummary:
    """Require credential-free view; serialize only permitted fields and the opaque revision."""
    return IMChannelSummary(
        id=view.id,
        created_at=view.created_at,
        updated_at=view.updated_at,
        provider=view.provider,
        status=view.status,
        status_description=view.status_reason or "",
        display_identifier=view.app_identifier,
        webhook_url=view.webhook_url,
        config_version=encode_im_config_version(view.id, view.config_version),
    )


def _revision(token: str, channel_id: IMChannelId) -> int:
    try:
        return decode_im_config_version(token, channel_id)
    except InvalidConfigVersionError:
        raise RelayedHTTPError(status=400, error_code="bad_request", message="Invalid configuration version") from None


def _test_failure(error: ChannelProviderError) -> IMChannelTestResponse:
    status = IMChannelStatus(error.kind.value)
    description = (
        "The submitted credentials are invalid."
        if status is IMChannelStatus.INVALID_CREDENTIALS
        else "The provider connection could not be established."
    )
    return IMChannelTestResponse(status=status, status_description=description)
