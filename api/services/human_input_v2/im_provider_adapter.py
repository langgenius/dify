"""Unified construction of complete IM provider adapters."""

from collections.abc import Callable

from core.human_input_v2.im_integration.adapters.credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter

type ProviderAdapterFactory = Callable[[IMProviderCredentials], IMProviderAdapter]


def build_im_provider_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
    match credentials:
        case SlackCredentials():
            return SlackIMProviderAdapter(credentials)
        case FeishuCredentials():
            return FeishuIMProviderAdapter(credentials)
        case LarkCredentials():
            return LarkIMProviderAdapter(credentials)
        case DingTalkCredentials():
            return DingTalkIMProviderAdapter(credentials)
        case MSTeamsCredentials():
            return MSTeamsIMProviderAdapter(credentials)
        case WeComCredentials():
            return WeComIMProviderAdapter(credentials)
        case _:
            raise TypeError("unsupported IM provider credentials")


__all__ = ["ProviderAdapterFactory", "build_im_provider_adapter"]
