"""Construction of complete IM provider adapters from canonical credentials."""

from .credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from .dingtalk import DingTalkIMProviderAdapter
from .feishu_lark import FeishuIMProviderAdapter, LarkIMProviderAdapter
from .ms_teams import MSTeamsIMProviderAdapter
from .protocols import IMProviderAdapter
from .slack import SlackIMProviderAdapter
from .wecom import WeComIMProviderAdapter


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


__all__ = ["build_im_provider_adapter"]
