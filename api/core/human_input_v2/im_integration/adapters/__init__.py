"""Stable types owned by the IM provider adapter boundary."""

from typing import TYPE_CHECKING

from .credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    IMProviderCredentialsAdapter,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from .entities import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecodeResult,
    IMCardEventDecodingError,
    IMEventIngressKind,
    IMStreamStartError,
    IMStreamStopError,
    MessageAccepted,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
    WebhookResponse,
)
from .message_locator import MessageLocator
from .protocols import (
    IMCardEventDecoder,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMProviderAdapter,
    IMWebhookHandler,
)

if TYPE_CHECKING:
    from .dingtalk import DingTalkIMProviderAdapter
    from .dingtalk_redis import RedisCacheAccessTokenProvider
    from .factory import build_im_provider_adapter
    from .ms_teams import MSTeamsIMProviderAdapter
    from .slack import SlackIMProviderAdapter
    from .wecom import WeComIMProviderAdapter


def __getattr__(name: str) -> object:
    """Load SDK-bound adapter exports only when callers request them."""

    match name:
        case "DingTalkIMProviderAdapter":
            from .dingtalk import DingTalkIMProviderAdapter

            return DingTalkIMProviderAdapter
        case "RedisCacheAccessTokenProvider":
            from .dingtalk_redis import RedisCacheAccessTokenProvider

            return RedisCacheAccessTokenProvider
        case "build_im_provider_adapter":
            from .factory import build_im_provider_adapter

            return build_im_provider_adapter
        case "MSTeamsIMProviderAdapter":
            from .ms_teams import MSTeamsIMProviderAdapter

            return MSTeamsIMProviderAdapter
        case "SlackIMProviderAdapter":
            from .slack import SlackIMProviderAdapter

            return SlackIMProviderAdapter
        case "WeComIMProviderAdapter":
            from .wecom import WeComIMProviderAdapter

            return WeComIMProviderAdapter
        case _:
            raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "AuthenticatedIMEvent",
    "CardAssessment",
    "CorrelationToken",
    "CredentialTestFailure",
    "CredentialTestFailureKind",
    "CredentialTestSuccess",
    "DingTalkCredentials",
    "DingTalkIMProviderAdapter",
    "Directory",
    "DirectoryEntry",
    "DirectoryReadFailure",
    "DynamicCardMessagingError",
    "EventAcceptance",
    "FeishuCredentials",
    "IMCardEvent",
    "IMCardEventDecodeResult",
    "IMCardEventDecoder",
    "IMCardEventDecodingError",
    "IMDirectory",
    "IMDynamicCardMessaging",
    "IMEventConsumer",
    "IMEventIngressKind",
    "IMEventStream",
    "IMMessaging",
    "IMProviderAdapter",
    "IMProviderCredentials",
    "IMProviderCredentialsAdapter",
    "IMStreamStartError",
    "IMStreamStopError",
    "IMWebhookHandler",
    "LarkCredentials",
    "MSTeamsCredentials",
    "MSTeamsIMProviderAdapter",
    "MessageAccepted",
    "MessageLocator",
    "MessageSendingError",
    "MessageSendingResult",
    "ProviderUserId",
    "RedisCacheAccessTokenProvider",
    "ReplacementError",
    "ReplacementErrorKind",
    "SlackCredentials",
    "SlackIMProviderAdapter",
    "StaticCardIntent",
    "UnrecognizedIMEvent",
    "WeComCredentials",
    "WeComIMProviderAdapter",
    "WebhookRequest",
    "WebhookResponse",
    "build_im_provider_adapter",
]
