"""Strict transport contracts and mappers for Human Input channel management."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self, cast

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from controllers.common.human_input_v2_contracts import PreserveOriginalValue
from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelCollectionResult,
    ChannelFailure,
    ChannelFailureCategory,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    DeleteChannelCommand,
    DingTalkIMCandidate,
    FeishuIMCandidate,
    GetChannelCommand,
    IMChannelSummary,
    NewSecret,
    PreserveSlackSecret,
    ResendChannelSummary,
    ResendChannelTestSummary,
    SaveEmailChannelCommand,
    SaveIMChannelCommand,
    SlackIMCandidate,
    TestEmailChannelCommand,
    TestIMChannelCommand,
)
from core.human_input_v2.email_channel import (
    NewAPIKey,
    ResendCandidate,
    RetainExistingAPIKey,
)
from core.human_input_v2.shared import NormalizedEmail
from fields.base import ResponseModel
from libs.helper import EmailStr


def _utc_isoformat(value: datetime) -> str:
    return f"{value.isoformat()}Z"


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _validate_secret_value(value: str) -> str:
    stripped = value.strip()
    normalized = stripped.casefold().replace("-", "_")
    if not stripped:
        raise ValueError("secret must not be blank")
    if normalized in {"masked", "preserve_existing", "preserve_original_value"}:
        raise ValueError("secret placeholders are not accepted")
    if set(stripped) <= {"*", "•"}:
        raise ValueError("masked secrets are not accepted")
    return value


SecretValue = Annotated[str, Field(min_length=1), AfterValidator(_validate_secret_value)]
type SlackSecretValue = SecretValue | PreserveOriginalValue
IdentifierValue = Annotated[str, Field(min_length=1)]


class ResendChannelCandidateRequest(_StrictRequest):
    provider: Literal[ChannelProvider.RESEND]
    sender_email: EmailStr
    sender_name: str = Field(default="", max_length=255)
    api_key: str | None = Field(
        default=None,
        description="Omit or submit blank only to retain an existing Resend key.",
    )

    @field_validator("api_key")
    @classmethod
    def normalize_blank_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        return _validate_secret_value(value)


class SlackChannelCandidateRequest(_StrictRequest):
    provider: Literal[ChannelProvider.SLACK]
    client_id: IdentifierValue
    client_secret: SlackSecretValue
    signing_secret: SlackSecretValue
    bot_token: SlackSecretValue
    app_token: SlackSecretValue


class FeishuChannelCandidateRequest(_StrictRequest):
    provider: Literal[ChannelProvider.FEISHU]
    app_id: IdentifierValue
    app_secret: SecretValue
    verification_token: SecretValue | None = None
    encrypt_key: SecretValue | None = None


class DingTalkChannelCandidateRequest(_StrictRequest):
    provider: Literal[ChannelProvider.DING_TALK]
    corp_id: IdentifierValue
    client_id: IdentifierValue
    client_secret: SecretValue = Field(repr=False)


ChannelCandidateRequest = Annotated[
    ResendChannelCandidateRequest
    | SlackChannelCandidateRequest
    | FeishuChannelCandidateRequest
    | DingTalkChannelCandidateRequest,
    Field(discriminator="provider"),
]


class SaveChannelRequest(_StrictRequest):
    candidate: ChannelCandidateRequest
    expected_integration_id: str | None = Field(default=None, min_length=1)
    expected_config_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_complete_cas_token(self) -> Self:
        if (self.expected_integration_id is None) != (self.expected_config_version is None):
            raise ValueError("expected_integration_id and expected_config_version must be provided together")
        if isinstance(self.candidate, ResendChannelCandidateRequest) and self.expected_integration_id is not None:
            raise ValueError("Email channel writes do not accept an IM revision token")
        return self


class TestChannelRequest(_StrictRequest):
    candidate: ChannelCandidateRequest


class DeleteChannelQuery(_StrictRequest):
    expected_integration_id: str | None = Field(default=None, min_length=1)
    expected_config_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_complete_cas_token(self) -> Self:
        if (self.expected_integration_id is None) != (self.expected_config_version is None):
            raise ValueError("expected_integration_id and expected_config_version must be provided together")
        return self


class ChannelScopeResponse(ResponseModel):
    kind: ChannelScopeKind
    id: str


class ResendChannelSummaryResponse(ResponseModel):
    provider: Literal[ChannelProvider.RESEND] = ChannelProvider.RESEND
    sender_email: str | None
    sender_name: str | None
    api_key_configured: bool


class IMChannelSummaryResponse(ResponseModel):
    provider: Literal[ChannelProvider.SLACK, ChannelProvider.FEISHU, ChannelProvider.DING_TALK]
    provider_tenant_id: str | None
    integration_id: str | None
    config_version: int | None


PersistedChannelSummaryResponse = Annotated[
    ResendChannelSummaryResponse | IMChannelSummaryResponse,
    Field(discriminator="provider"),
]

type IMChannelProvider = Literal[
    ChannelProvider.SLACK,
    ChannelProvider.FEISHU,
    ChannelProvider.DING_TALK,
]


class ChannelViewResponse(ResponseModel):
    kind: ChannelKind
    provider: ChannelProvider
    scope: ChannelScopeResponse
    configured: bool
    status: ChannelStatus
    capabilities: list[ChannelCapability]
    summary: PersistedChannelSummaryResponse
    safe_status_reason: str | None = None
    last_checked_at: str | None = None


class ResendChannelTestSummaryResponse(ResponseModel):
    provider: Literal[ChannelProvider.RESEND] = ChannelProvider.RESEND
    recipient_email: str
    sender_email: str
    sender_name: str


class IMChannelTestSummaryResponse(ResponseModel):
    provider: Literal[ChannelProvider.SLACK, ChannelProvider.FEISHU, ChannelProvider.DING_TALK]
    provider_tenant_id: str


ChannelTestSummaryResponse = Annotated[
    ResendChannelTestSummaryResponse | IMChannelTestSummaryResponse,
    Field(discriminator="provider"),
]


class ChannelTestResultResponse(ResponseModel):
    kind: ChannelKind
    provider: ChannelProvider
    scope: ChannelScopeResponse
    status: ChannelStatus
    summary: ChannelTestSummaryResponse
    safe_status_reason: str | None = None
    checked_at: str


class ChannelFailureResponse(ResponseModel):
    category: ChannelFailureCategory
    code: str | None = None


class ChannelCollectionFailureResponse(ResponseModel):
    kind: ChannelKind
    provider: ChannelProvider
    error: ChannelFailureResponse


class ChannelCollectionResponse(ResponseModel):
    channels: list[ChannelViewResponse]
    failures: list[ChannelCollectionFailureResponse]


class ChannelErrorResponse(ResponseModel):
    error: ChannelFailureResponse


class ChannelRequestMappingError(ValueError):
    """Safe route/body mismatch that can be mapped without facade work."""

    def __init__(
        self,
        category: ChannelFailureCategory,
        code: str | None = None,
    ) -> None:
        super().__init__(code or category.value)
        self.failure = ChannelFailure(category, code)


def channel_ref_from_path(kind: str, provider: str) -> ChannelRef:
    try:
        return ChannelRef(ChannelKind(kind), ChannelProvider(provider))
    except (TypeError, ValueError) as error:
        raise ChannelRequestMappingError(ChannelFailureCategory.UNSUPPORTED_CHANNEL) from error


def get_channel_command(ref: ChannelRef) -> GetChannelCommand:
    return GetChannelCommand(ref)


def save_channel_command(ref: ChannelRef, request: SaveChannelRequest):
    candidate = _candidate_from_request(ref, request.candidate)
    if isinstance(candidate, ResendCandidate):
        return SaveEmailChannelCommand(ref, candidate)
    return SaveIMChannelCommand(
        ref,
        candidate,
        expected_integration_id=request.expected_integration_id,
        expected_config_version=request.expected_config_version,
    )


def test_channel_command(ref: ChannelRef, request: TestChannelRequest):
    candidate = _candidate_from_request(ref, request.candidate)
    if isinstance(candidate, ResendCandidate):
        return TestEmailChannelCommand(ref, candidate)
    return TestIMChannelCommand(ref, candidate)


def delete_channel_command(ref: ChannelRef, query: DeleteChannelQuery) -> DeleteChannelCommand:
    if ref.kind is ChannelKind.EMAIL and query.expected_integration_id is not None:
        raise ChannelRequestMappingError(
            ChannelFailureCategory.VALIDATION_FAILURE,
            "email_revision_token_not_allowed",
        )
    return DeleteChannelCommand(
        ref,
        expected_integration_id=query.expected_integration_id,
        expected_config_version=query.expected_config_version,
    )


def _candidate_from_request(ref: ChannelRef, request: ChannelCandidateRequest):
    if request.provider is not ref.provider:
        raise ChannelRequestMappingError(
            ChannelFailureCategory.VALIDATION_FAILURE,
            "channel_candidate_mismatch",
        )
    if isinstance(request, ResendChannelCandidateRequest):
        if ref.kind is not ChannelKind.EMAIL:
            raise ChannelRequestMappingError(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        api_key = NewAPIKey(request.api_key) if request.api_key is not None else RetainExistingAPIKey()
        return ResendCandidate(
            sender_email=NormalizedEmail(request.sender_email),
            sender_name=request.sender_name.strip(),
            api_key=api_key,
        )
    if ref.kind is not ChannelKind.IM:
        raise ChannelRequestMappingError(
            ChannelFailureCategory.VALIDATION_FAILURE,
            "channel_candidate_mismatch",
        )
    if isinstance(request, SlackChannelCandidateRequest):
        return SlackIMCandidate(
            client_id=request.client_id.strip(),
            client_secret=_slack_secret_directive(request.client_secret),
            signing_secret=_slack_secret_directive(request.signing_secret),
            bot_token=_slack_secret_directive(request.bot_token),
            app_token=_slack_secret_directive(request.app_token),
        )
    if isinstance(request, FeishuChannelCandidateRequest):
        return FeishuIMCandidate(
            app_id=request.app_id.strip(),
            app_secret=NewSecret(request.app_secret),
            verification_token=NewSecret(request.verification_token) if request.verification_token else None,
            encrypt_key=NewSecret(request.encrypt_key) if request.encrypt_key else None,
        )
    return DingTalkIMCandidate(
        corp_id=request.corp_id.strip(),
        client_id=request.client_id.strip(),
        client_secret=NewSecret(request.client_secret),
    )


def _slack_secret_directive(value: SlackSecretValue) -> NewSecret | PreserveSlackSecret:
    if isinstance(value, PreserveOriginalValue):
        return PreserveSlackSecret()
    return NewSecret(value)


def channel_view_response(view: ChannelView) -> ChannelViewResponse:
    if isinstance(view.summary, ResendChannelSummary):
        summary: ResendChannelSummaryResponse | IMChannelSummaryResponse = ResendChannelSummaryResponse(
            sender_email=str(view.summary.sender_email) if view.summary.sender_email is not None else None,
            sender_name=view.summary.sender_name,
            api_key_configured=view.summary.api_key_configured,
        )
    else:
        assert isinstance(view.summary, IMChannelSummary)
        summary = IMChannelSummaryResponse(
            provider=cast(IMChannelProvider, view.ref.provider),
            provider_tenant_id=view.summary.provider_tenant_id,
            integration_id=str(view.summary.integration_id) if view.summary.integration_id is not None else None,
            config_version=view.summary.config_version,
        )
    return ChannelViewResponse(
        kind=view.ref.kind,
        provider=view.ref.provider,
        scope=ChannelScopeResponse(kind=view.scope.kind, id=view.scope.scope_id),
        configured=view.configured,
        status=view.status,
        capabilities=sorted(view.capabilities, key=str),
        summary=summary,
        safe_status_reason=view.safe_status_reason,
        last_checked_at=_utc_isoformat(view.last_checked_at) if view.last_checked_at is not None else None,
    )


def channel_test_response(result: ChannelTestResult) -> ChannelTestResultResponse:
    if isinstance(result.summary, ResendChannelTestSummary):
        summary: ResendChannelTestSummaryResponse | IMChannelTestSummaryResponse = ResendChannelTestSummaryResponse(
            recipient_email=str(result.summary.recipient_email),
            sender_email=str(result.summary.sender_email),
            sender_name=result.summary.sender_name,
        )
    else:
        summary = IMChannelTestSummaryResponse(
            provider=cast(IMChannelProvider, result.ref.provider),
            provider_tenant_id=result.summary.provider_tenant_id,
        )
    return ChannelTestResultResponse(
        kind=result.ref.kind,
        provider=result.ref.provider,
        scope=ChannelScopeResponse(kind=result.scope.kind, id=result.scope.scope_id),
        status=result.status,
        summary=summary,
        safe_status_reason=result.safe_status_reason,
        checked_at=_utc_isoformat(result.checked_at),
    )


def channel_collection_response(result: ChannelCollectionResult) -> ChannelCollectionResponse:
    return ChannelCollectionResponse(
        channels=[channel_view_response(view) for view in result.channels],
        failures=[
            ChannelCollectionFailureResponse(
                kind=ref.kind,
                provider=ref.provider,
                error=ChannelFailureResponse(category=failure.category, code=failure.code),
            )
            for ref, failure in result.failures
        ],
    )


def channel_error_response(failure: ChannelFailure) -> ChannelErrorResponse:
    return ChannelErrorResponse(
        error=ChannelFailureResponse(category=failure.category, code=failure.code),
    )


def require_view(result: ChannelOperationResult) -> ChannelViewResponse:
    if result.view is None:
        assert result.failure is not None
        raise ChannelRequestMappingError(result.failure.category, result.failure.code)
    return channel_view_response(result.view)


def require_test_result(result: ChannelOperationResult) -> ChannelTestResultResponse:
    if result.test_result is None:
        assert result.failure is not None
        raise ChannelRequestMappingError(result.failure.category, result.failure.code)
    return channel_test_response(result.test_result)


__all__ = [
    "ChannelCollectionFailureResponse",
    "ChannelCollectionResponse",
    "ChannelErrorResponse",
    "ChannelRequestMappingError",
    "ChannelTestResultResponse",
    "ChannelViewResponse",
    "DeleteChannelQuery",
    "DingTalkChannelCandidateRequest",
    "FeishuChannelCandidateRequest",
    "ResendChannelCandidateRequest",
    "SaveChannelRequest",
    "SlackChannelCandidateRequest",
    "TestChannelRequest",
    "channel_collection_response",
    "channel_error_response",
    "channel_ref_from_path",
    "delete_channel_command",
    "get_channel_command",
    "require_test_result",
    "require_view",
    "save_channel_command",
    "test_channel_command",
]
