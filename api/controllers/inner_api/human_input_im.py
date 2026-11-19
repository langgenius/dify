"""Enterprise-authenticated deployment IM management; never exposes saved secrets."""

from base64 import b64decode
from dataclasses import asdict
from typing import override

from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from werkzeug.exceptions import BadRequest, Conflict, NotFound, ServiceUnavailable

from configs import dify_config
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.db.session_factory import session_factory
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentialsAdapter
from enums import DeploymentEdition
from repositories.human_input_v2.im_channel_repository import IMChannelId
from services.enterprise.human_input_im import DeploymentIMChannelService
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ReplacementRequiredError,
)
from services.human_input_v2.im_credential_codec import IMCredentialError


class IMManagementPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: str
    channel_id: str = ""
    expected_config_version: int = 0
    credentials: dict = Field(default_factory=dict)
    update_fields: list[str] | None = None
    reference: str = ""


@inner_api_ns.route("/enterprise/human-input/im")
class EnterpriseIMManagement(Resource):
    @override
    def dispatch_request(self, *args, **kwargs):
        """Mark all deployment IM management responses uncacheable."""
        response = make_response(super().dispatch_request(*args, **kwargs))
        response.headers["Cache-Control"] = "no-store"
        return response

    @enterprise_inner_api_only
    def post(self):
        """Mutate only deployment routes after provider validation and version checks.

        Requires Enterprise edition and inner authentication; returns safe metadata
        or confirms one active credential reference. Secrets never enter responses.
        """
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            raise NotFound()
        try:
            payload = IMManagementPayload.model_validate(request.get_json())
        except ValidationError:
            raise BadRequest("Invalid IM request") from None
        service = DeploymentIMChannelService(session_factory.get_session_maker())
        addressed = IMChannelId(payload.channel_id)
        try:
            if payload.operation == "reference":
                current = service._read_current()
                if current is None or b64decode(current.encrypted_credentials.ciphertext).decode() != payload.reference:
                    raise NotFound()
                return {"active": True, "channel_id": str(current.id), "config_version": current.config_version}
            if payload.operation == "list":
                current = service.get_current()
                return {"channels": [_summary(current)] if current else []}
            if payload.operation == "get":
                detail = service.get_detail(addressed)
                values = detail.credentials.model_dump()
                secret_fields = {
                    "app_secret",
                    "client_secret",
                    "signing_secret",
                    "bot_token",
                    "secret",
                    "encrypt_key",
                    "verification_token",
                    "app_token",
                }
                safe = {k: v for k, v in values.items() if k not in secret_fields and k != "provider"}
                safe.update(
                    {
                        "has_" + k: bool(values.get(k))
                        for k in ("verification_token", "encrypt_key", "app_token")
                        if k in values
                    }
                )
                return {"summary": _summary(detail.summary), "configuration": {detail.credentials.provider.value: safe}}
            if payload.operation == "delete":
                service.delete(addressed, payload.expected_config_version)
                return {"channel_id": payload.channel_id}
            values = payload.credentials
            if payload.update_fields is not None:
                current = service._load_addressed(addressed)
                service._require_current_version(current, payload.expected_config_version)
                saved = service._credential_codec.load(current.provider, current.encrypted_credentials).model_dump()
                if values.get("provider") != saved["provider"]:
                    raise ReplacementRequiredError("Provider replacement required")
                if not payload.update_fields or any(k not in saved or k == "provider" for k in payload.update_fields):
                    raise BadRequest("Invalid credential update mask")
                if any(k not in values for k in payload.update_fields):
                    raise BadRequest("Selected credential field is missing")
                values = {**saved, **{k: values[k] for k in payload.update_fields}}
            if payload.operation == "test_saved" and not values:
                current = service._load_addressed(addressed)
                service._require_current_version(current, payload.expected_config_version)
                values = service._credential_codec.load(current.provider, current.encrypted_credentials).model_dump()
            if payload.operation == "test_saved":
                service._require_current_version(service._load_addressed(addressed), payload.expected_config_version)
            credentials = IMProviderCredentialsAdapter.validate_python(values)
            if payload.operation in ("test", "test_saved"):
                service.test(credentials)
                return {"status": "connected"}
            if payload.operation == "create":
                result = service.create(credentials)
            elif payload.operation == "update":
                result = service.update(addressed, payload.expected_config_version, credentials)
            elif payload.operation == "replace":
                result = service.replace(addressed, payload.expected_config_version, credentials)
            else:
                raise BadRequest("Unknown IM operation")
            return {"summary": _summary(result)}
        except ChannelProviderError as error:
            if payload.operation in ("test", "test_saved"):
                return {
                    "status": "invalid_credentials"
                    if error.kind.value == "invalid_credentials"
                    else "connection_failure",
                    "status_description": "Provider credentials or connection rejected",
                }
            raise BadRequest("Provider credentials or connection rejected") from None
        except ChannelNotFoundError:
            raise NotFound("HUMAN_INPUT_CHANNEL_NOT_FOUND") from None
        except ValidationError:
            raise BadRequest("Invalid IM credentials") from None
        except IMCredentialError:
            raise ServiceUnavailable("IM credential storage unavailable") from None
        except (ChannelAlreadyConfiguredError, ProviderConfigurationUpdatedError, ReplacementRequiredError) as error:
            reason = {
                ChannelAlreadyConfiguredError: "HUMAN_INPUT_CHANNEL_ALREADY_CONFIGURED",
                ProviderConfigurationUpdatedError: "HUMAN_INPUT_PROVIDER_CONFIGURATION_UPDATED",
                ReplacementRequiredError: "HUMAN_INPUT_REPLACEMENT_REQUIRED",
            }[type(error)]
            raise Conflict(reason) from None


def _summary(view):
    """Project only nonsecret channel metadata into the Enterprise bridge wire."""
    value = asdict(view)
    value["created_at"] = view.created_at.isoformat() + "Z"
    value["updated_at"] = view.updated_at.isoformat() + "Z"
    return value
