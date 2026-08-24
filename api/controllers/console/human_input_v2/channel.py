"""Canonical Console transport for Human Input Email and IM Channels."""

from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum
from http import HTTPStatus
from typing import Annotated, Literal
from uuid import UUID

from flask import request
from flask.typing import ResponseReturnValue
from flask_restx import Resource
from pydantic import Field, StringConstraints

from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import with_current_tenant_id, with_current_user
from core.human_input_v2.email_channel import EmailChannelView, EmailConfigurationSnapshot
from core.human_input_v2.entities import (
    EmailProviderType,
    HumanInputDeliveryChannel,
    IMIntegrationStatus,
    IMProvider,
)
from core.human_input_v2.im_integration import IMIntegrationView, IntegrationRevisionToken
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from fields.base import ResponseModel
from fields.timestamp import Timestamp
from models.account import Account
from services.human_input_v2.email_channel_management_composition import (
    build_human_input_email_channel_management_service,
)
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ReplacementRequiredError,
)
from services.human_input_v2.im_integration_management_composition import (
    build_human_input_im_integration_management_service,
)

from ._common import StrictModel
from ._decorators import require_admin_or_owner
from .config_version import (
    InvalidConfigVersionError,
    decode_email_config_version,
    decode_im_config_version,
    encode_email_config_version,
    encode_im_config_version,
)
from .errors import (
    ChannelAlreadyConfiguredHttpError,
    ChannelNotFoundHttpError,
    ChannelProviderBadRequestHttpError,
    ChannelProviderConfigurationUpdatedHttpError,
    ChannelReplacementRequiredHttpError,
)
from .providers import EmailProviderCredentials, IMProviderCredentials

type ChannelId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
type ConfigVersion = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ChannelStatus(StrEnum):
    CONNECTED = "connected"
    INVALID_CREDENTIALS = "invalid_credentials"
    CONNECTION_FAILURE = "connection_failure"


class ConnectionMode(StrEnum):
    CUSTOM_APP = "custom_app"


class ChannelTestResponse(ResponseModel):
    status: ChannelStatus
    status_description: str


class ChannelDeleteResponse(ResponseModel):
    channel_id: ChannelId


class ChannelConflictResponse(ResponseModel):
    code: Literal["replacement_required", "provider_configuration_updated"]
    message: str
    status: Literal[HTTPStatus.CONFLICT] = HTTPStatus.CONFLICT


class ChannelProvider(ResponseModel):
    provider: EmailProviderType | IMProvider
    connection_mode: Literal[ConnectionMode.CUSTOM_APP] = ConnectionMode.CUSTOM_APP


class ListChannelProvidersResponse(ResponseModel):
    email_providers: Sequence[ChannelProvider]
    im_providers: Sequence[ChannelProvider]


class ChannelSummary(ResponseModel):
    id: ChannelId
    created_at: Timestamp
    updated_at: Timestamp
    kind: Literal[HumanInputDeliveryChannel.EMAIL, HumanInputDeliveryChannel.IM]
    provider: EmailProviderType | IMProvider = Field(
        description="The provider of the Channel. The concrete provider type depends on the `kind` field."
    )
    status: ChannelStatus
    status_description: str = Field(
        description="Human-readable status description. Empty when the status is `connected`."
    )
    display_identifier: str = Field(description="The display identifier of the Channel.")
    webhook_url: str | None = Field(
        description=(
            "Webhook URL to configure on the provider side. None when webhook configuration is not required "
            "or the provider does not support webhooks."
        )
    )
    config_version: ConfigVersion = Field(
        description="The current opaque configuration version used for optimistic concurrency control."
    )


class ListChannelsResponse(ResponseModel):
    channels: Sequence[ChannelSummary]


class EmailChannelTestPayload(StrictModel):
    credentials: EmailProviderCredentials


class EmailChannelCreatePayload(StrictModel):
    credentials: EmailProviderCredentials


class EmailChannelMutationResponse(ResponseModel):
    summary: ChannelSummary


class EmailChannelDetailResponse(ResponseModel):
    summary: ChannelSummary
    sender_name: str
    sender_email: str


class EmailChannelUpdatePayload(StrictModel):
    credentials: EmailProviderCredentials
    expected_config_version: ConfigVersion


class ChannelDeleteQuery(StrictModel):
    expected_config_version: ConfigVersion


class IMChannelTestPayload(StrictModel):
    credentials: IMProviderCredentials


class IMChannelCreatePayload(StrictModel):
    credentials: IMProviderCredentials


class IMChannelMutationResponse(ResponseModel):
    summary: ChannelSummary


class IMChannelDetailResponse(ResponseModel):
    summary: ChannelSummary


class IMChannelUpdatePayload(StrictModel):
    credentials: IMProviderCredentials
    expected_config_version: ConfigVersion


class IMChannelReplacementPayload(StrictModel):
    credentials: IMProviderCredentials
    expected_config_version: ConfigVersion


register_schema_models(
    console_ns,
    ChannelDeleteQuery,
    EmailChannelTestPayload,
    EmailChannelCreatePayload,
    EmailChannelUpdatePayload,
    IMChannelTestPayload,
    IMChannelCreatePayload,
    IMChannelUpdatePayload,
    IMChannelReplacementPayload,
)
register_response_schema_models(
    console_ns,
    ChannelTestResponse,
    ChannelDeleteResponse,
    ChannelConflictResponse,
    ChannelProvider,
    ListChannelProvidersResponse,
    ChannelSummary,
    ListChannelsResponse,
    EmailChannelMutationResponse,
    EmailChannelDetailResponse,
    IMChannelMutationResponse,
    IMChannelDetailResponse,
)


def _workspace_scope(tenant_id: str) -> WorkspaceScope:
    return WorkspaceScope(id=TenantId(tenant_id))


def _actor_id(account: Account) -> AccountId:
    return AccountId(account.id)


def _channel_provider_response(provider: EmailProviderType | IMProvider) -> ChannelProvider:
    return ChannelProvider(provider=provider)


def _email_channel_summary_response(view: EmailChannelView) -> ChannelSummary:
    return ChannelSummary(
        id=view.id,
        created_at=view.created_at,
        updated_at=view.updated_at,
        kind=HumanInputDeliveryChannel.EMAIL,
        provider=view.provider,
        status=ChannelStatus.CONNECTED,
        status_description="",
        display_identifier=" ".join(part for part in (view.sender_name, view.sender_email) if part),
        webhook_url=None,
        config_version=encode_email_config_version(view.revision),
    )


def _im_channel_summary_response(view: IMIntegrationView) -> ChannelSummary:
    status, status_description = _im_channel_status(view)
    return ChannelSummary(
        id=view.id,
        created_at=view.created_at,
        updated_at=view.updated_at,
        kind=HumanInputDeliveryChannel.IM,
        provider=view.provider,
        status=status,
        status_description=status_description,
        display_identifier=" ".join(part for part in (view.app_identifier, view.provider_tenant_display) if part),
        webhook_url=view.webhook_url,
        config_version=encode_im_config_version(view.revision),
    )


def _im_channel_status(view: IMIntegrationView) -> tuple[ChannelStatus, str]:
    if view.status in (IMIntegrationStatus.CONFIGURED, IMIntegrationStatus.CONNECTED):
        return ChannelStatus.CONNECTED, ""
    if view.status is IMIntegrationStatus.PERMISSION_ISSUE:
        return (
            ChannelStatus.INVALID_CREDENTIALS,
            view.safe_status_reason or "The configured credentials are no longer accepted.",
        )
    return (
        ChannelStatus.CONNECTION_FAILURE,
        view.safe_status_reason or "The configured provider connection is unavailable.",
    )


def _email_revision(value: str, channel_id: EmailProviderId) -> EmailConfigurationSnapshot:
    try:
        return decode_email_config_version(value, channel_id)
    except InvalidConfigVersionError as error:
        raise ChannelProviderConfigurationUpdatedHttpError() from error


def _im_revision(value: str, channel_id: IntegrationId) -> IntegrationRevisionToken:
    try:
        return decode_im_config_version(value, channel_id)
    except InvalidConfigVersionError as error:
        raise ChannelProviderConfigurationUpdatedHttpError() from error


@console_ns.route("/workspace/current/human-input/v2/channel-providers")
class ListChannelProvidersApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ListChannelProvidersResponse.__name__])
    @require_admin_or_owner
    def get(self) -> ResponseReturnValue:
        email_providers = build_human_input_email_channel_management_service().available_providers()
        im_providers = build_human_input_im_integration_management_service().available_providers()
        return ListChannelProvidersResponse(
            email_providers=[_channel_provider_response(provider) for provider in email_providers],
            im_providers=[_channel_provider_response(provider) for provider in im_providers],
        ).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels")
class ListChannelsApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ListChannelsResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def get(self, tenant_id: str) -> ResponseReturnValue:
        workspace_scope = _workspace_scope(tenant_id)
        email = build_human_input_email_channel_management_service().get_current(workspace_scope)
        im = build_human_input_im_integration_management_service().get_current(workspace_scope)
        channels: list[ChannelSummary] = []
        if email is not None:
            channels.append(_email_channel_summary_response(email))
        if im is not None:
            channels.append(_im_channel_summary_response(im))
        return ListChannelsResponse(channels=channels).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/email/test")
class EmailChannelTestApi(Resource):
    @console_ns.expect(console_ns.models[EmailChannelTestPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[ChannelTestResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def post(self, tenant_id: str) -> ResponseReturnValue:
        request_body = EmailChannelTestPayload.model_validate(console_ns.payload or {})
        candidate = request_body.credentials.to_owner_candidate()
        try:
            build_human_input_email_channel_management_service().test(
                _workspace_scope(tenant_id),
                candidate,
                candidate.sender_email,
            )
        except ChannelProviderError as error:
            return ChannelTestResponse(
                status=ChannelStatus(error.kind.value),
                status_description=error.status_description,
            ).model_dump(mode="json")
        return ChannelTestResponse(
            status=ChannelStatus.CONNECTED,
            status_description="",
        ).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/email")
class EmailChannelCreateApi(Resource):
    @console_ns.expect(console_ns.models[EmailChannelCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[EmailChannelMutationResponse.__name__])
    @require_admin_or_owner
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account) -> ResponseReturnValue:
        request_body = EmailChannelCreatePayload.model_validate(console_ns.payload or {})
        try:
            snapshot = build_human_input_email_channel_management_service().create(
                _workspace_scope(tenant_id),
                _actor_id(current_user),
                request_body.credentials.to_owner_candidate(),
            )
        except ChannelAlreadyConfiguredError as error:
            raise ChannelAlreadyConfiguredHttpError() from error
        except ChannelProviderError as error:
            raise ChannelProviderBadRequestHttpError(error.status_description) from error
        return EmailChannelMutationResponse(summary=_email_channel_summary_response(snapshot)).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/email/<uuid:channel_id>")
class EmailChannelApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[EmailChannelDetailResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def get(self, tenant_id: str, channel_id: UUID) -> ResponseReturnValue:
        try:
            snapshot = build_human_input_email_channel_management_service().get(
                _workspace_scope(tenant_id),
                EmailProviderId(str(channel_id)),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        return EmailChannelDetailResponse(
            summary=_email_channel_summary_response(snapshot),
            sender_name=snapshot.sender_name,
            sender_email=snapshot.sender_email,
        ).model_dump(mode="json")

    @console_ns.expect(console_ns.models[EmailChannelUpdatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[EmailChannelMutationResponse.__name__])
    @console_ns.response(409, "Configuration conflict", console_ns.models[ChannelConflictResponse.__name__])
    @require_admin_or_owner
    @with_current_user
    @with_current_tenant_id
    def put(self, tenant_id: str, current_user: Account, channel_id: UUID) -> ResponseReturnValue:
        request_body = EmailChannelUpdatePayload.model_validate(console_ns.payload or {})
        addressed_id = EmailProviderId(str(channel_id))
        try:
            snapshot = build_human_input_email_channel_management_service().update(
                _workspace_scope(tenant_id),
                addressed_id,
                _email_revision(request_body.expected_config_version, addressed_id),
                _actor_id(current_user),
                request_body.credentials.to_owner_candidate(),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        except ProviderConfigurationUpdatedError as error:
            raise ChannelProviderConfigurationUpdatedHttpError() from error
        except ChannelProviderError as error:
            raise ChannelProviderBadRequestHttpError(error.status_description) from error
        return EmailChannelMutationResponse(summary=_email_channel_summary_response(snapshot)).model_dump(mode="json")

    @console_ns.doc(params=query_params_from_model(ChannelDeleteQuery))
    @console_ns.response(200, "Success", console_ns.models[ChannelDeleteResponse.__name__])
    @console_ns.response(409, "Configuration conflict", console_ns.models[ChannelConflictResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def delete(self, tenant_id: str, channel_id: UUID) -> ResponseReturnValue:
        query = ChannelDeleteQuery.model_validate(request.args.to_dict(flat=True))
        addressed_id = EmailProviderId(str(channel_id))
        try:
            deleted_id = build_human_input_email_channel_management_service().delete(
                _workspace_scope(tenant_id),
                addressed_id,
                _email_revision(query.expected_config_version, addressed_id),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        except ProviderConfigurationUpdatedError as error:
            raise ChannelProviderConfigurationUpdatedHttpError() from error
        return ChannelDeleteResponse(channel_id=deleted_id).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/im/test")
class IMChannelTestApi(Resource):
    @console_ns.expect(console_ns.models[IMChannelTestPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[ChannelTestResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def post(self, tenant_id: str) -> ResponseReturnValue:
        request_body = IMChannelTestPayload.model_validate(console_ns.payload or {})
        try:
            build_human_input_im_integration_management_service().test(
                _workspace_scope(tenant_id),
                request_body.credentials.to_owner_credentials(),
            )
        except ChannelProviderError as error:
            return ChannelTestResponse(
                status=ChannelStatus(error.kind.value),
                status_description=error.status_description,
            ).model_dump(mode="json")
        return ChannelTestResponse(
            status=ChannelStatus.CONNECTED,
            status_description="",
        ).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/im")
class IMChannelCreateApi(Resource):
    @console_ns.expect(console_ns.models[IMChannelCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[IMChannelMutationResponse.__name__])
    @require_admin_or_owner
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account) -> ResponseReturnValue:
        request_body = IMChannelCreatePayload.model_validate(console_ns.payload or {})
        try:
            snapshot = build_human_input_im_integration_management_service().create(
                _workspace_scope(tenant_id),
                _actor_id(current_user),
                request_body.credentials.to_owner_credentials(),
            )
        except ChannelAlreadyConfiguredError as error:
            raise ChannelAlreadyConfiguredHttpError() from error
        except ChannelProviderError as error:
            raise ChannelProviderBadRequestHttpError(error.status_description) from error
        return IMChannelMutationResponse(summary=_im_channel_summary_response(snapshot)).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/im/<uuid:channel_id>")
class IMChannelApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[IMChannelDetailResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def get(self, tenant_id: str, channel_id: UUID) -> ResponseReturnValue:
        try:
            snapshot = build_human_input_im_integration_management_service().get(
                _workspace_scope(tenant_id),
                IntegrationId(str(channel_id)),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        return IMChannelDetailResponse(summary=_im_channel_summary_response(snapshot)).model_dump(mode="json")

    @console_ns.expect(console_ns.models[IMChannelUpdatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[IMChannelMutationResponse.__name__])
    @console_ns.response(409, "Configuration conflict", console_ns.models[ChannelConflictResponse.__name__])
    @require_admin_or_owner
    @with_current_user
    @with_current_tenant_id
    def put(self, tenant_id: str, current_user: Account, channel_id: UUID) -> ResponseReturnValue:
        request_body = IMChannelUpdatePayload.model_validate(console_ns.payload or {})
        addressed_id = IntegrationId(str(channel_id))
        try:
            snapshot = build_human_input_im_integration_management_service().update(
                _workspace_scope(tenant_id),
                addressed_id,
                _im_revision(request_body.expected_config_version, addressed_id),
                _actor_id(current_user),
                request_body.credentials.to_owner_credentials(),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        except ReplacementRequiredError as error:
            raise ChannelReplacementRequiredHttpError() from error
        except ProviderConfigurationUpdatedError as error:
            raise ChannelProviderConfigurationUpdatedHttpError() from error
        except ChannelProviderError as error:
            raise ChannelProviderBadRequestHttpError(error.status_description) from error
        return IMChannelMutationResponse(summary=_im_channel_summary_response(snapshot)).model_dump(mode="json")

    @console_ns.doc(params=query_params_from_model(ChannelDeleteQuery))
    @console_ns.response(200, "Success", console_ns.models[ChannelDeleteResponse.__name__])
    @console_ns.response(409, "Configuration conflict", console_ns.models[ChannelConflictResponse.__name__])
    @require_admin_or_owner
    @with_current_tenant_id
    def delete(self, tenant_id: str, channel_id: UUID) -> ResponseReturnValue:
        query = ChannelDeleteQuery.model_validate(request.args.to_dict(flat=True))
        addressed_id = IntegrationId(str(channel_id))
        try:
            deleted_id = build_human_input_im_integration_management_service().delete(
                _workspace_scope(tenant_id),
                addressed_id,
                _im_revision(query.expected_config_version, addressed_id),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        except ProviderConfigurationUpdatedError as error:
            raise ChannelProviderConfigurationUpdatedHttpError() from error
        return ChannelDeleteResponse(channel_id=deleted_id).model_dump(mode="json")


@console_ns.route("/workspace/current/human-input/v2/channels/im/<uuid:channel_id>/replacement")
class IMChannelReplacementApi(Resource):
    @console_ns.expect(console_ns.models[IMChannelReplacementPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[IMChannelMutationResponse.__name__])
    @console_ns.response(409, "Configuration conflict", console_ns.models[ChannelConflictResponse.__name__])
    @require_admin_or_owner
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, channel_id: UUID) -> ResponseReturnValue:
        request_body = IMChannelReplacementPayload.model_validate(console_ns.payload or {})
        addressed_id = IntegrationId(str(channel_id))
        try:
            snapshot = build_human_input_im_integration_management_service().replace(
                _workspace_scope(tenant_id),
                addressed_id,
                _im_revision(request_body.expected_config_version, addressed_id),
                _actor_id(current_user),
                request_body.credentials.to_owner_credentials(),
            )
        except ChannelNotFoundError as error:
            raise ChannelNotFoundHttpError() from error
        except ProviderConfigurationUpdatedError as error:
            raise ChannelProviderConfigurationUpdatedHttpError() from error
        except ChannelProviderError as error:
            raise ChannelProviderBadRequestHttpError(error.status_description) from error
        return IMChannelMutationResponse(summary=_im_channel_summary_response(snapshot)).model_dump(mode="json")


__all__ = [
    "ChannelConflictResponse",
    "ChannelDeleteQuery",
    "ChannelDeleteResponse",
    "ChannelProvider",
    "ChannelSummary",
    "ChannelTestResponse",
    "EmailChannelCreatePayload",
    "EmailChannelDetailResponse",
    "EmailChannelTestPayload",
    "EmailChannelUpdatePayload",
    "IMChannelCreatePayload",
    "IMChannelDetailResponse",
    "IMChannelReplacementPayload",
    "IMChannelTestPayload",
    "IMChannelUpdatePayload",
    "ListChannelProvidersResponse",
    "ListChannelsResponse",
]
