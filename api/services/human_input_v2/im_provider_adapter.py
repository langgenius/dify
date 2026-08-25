"""Unified construction of complete IM provider adapters."""

from collections.abc import Callable

from core.human_input_v2.im_integration import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    FeishuIMIntegrationCredentials,
    IMProviderAdapter,
    LarkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)

type ProviderAdapterFactory = Callable[[IMProviderCredentials], IMProviderAdapter]


def build_im_provider_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
    match credentials:
        case SlackIMIntegrationCredentials():
            return SlackIMProviderAdapter(credentials)
        case FeishuIMIntegrationCredentials():
            return FeishuIMProviderAdapter(credentials)
        case LarkIMIntegrationCredentials():
            return LarkIMProviderAdapter(credentials)
        case DingTalkIMIntegrationCredentials():
            return DingTalkIMProviderAdapter(credentials)
        case MSTeamsIMIntegrationCredentials():
            return MSTeamsIMProviderAdapter(credentials)
        case WeComIMIntegrationCredentials():
            return WeComIMProviderAdapter(credentials)
        case _:
            raise TypeError("unsupported IM provider credentials")


__all__ = ["ProviderAdapterFactory", "build_im_provider_adapter"]
