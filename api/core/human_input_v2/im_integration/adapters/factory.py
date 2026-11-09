"""Construction of complete IM provider adapters from canonical credentials.

Provider adapters are imported inside each branch because their vendor SDKs
(notably ``lark_oapi``) take seconds to import, and this module is reachable
from ``create_app()``.
"""

from .credentials import (
    DingTalkCredentials,
    FeishuCredentials,
    IMProviderCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
)
from .protocols import IMProviderAdapter


def build_im_provider_adapter(credentials: IMProviderCredentials) -> IMProviderAdapter:
    match credentials:
        case SlackCredentials():
            from .slack import SlackIMProviderAdapter

            return SlackIMProviderAdapter(credentials)
        case FeishuCredentials():
            from .feishu_lark import FeishuIMProviderAdapter

            return FeishuIMProviderAdapter(credentials)
        case LarkCredentials():
            from .feishu_lark import LarkIMProviderAdapter

            return LarkIMProviderAdapter(credentials)
        case DingTalkCredentials():
            from .dingtalk import DingTalkIMProviderAdapter

            return DingTalkIMProviderAdapter(credentials)
        case MSTeamsCredentials():
            from .ms_teams import MSTeamsIMProviderAdapter

            return MSTeamsIMProviderAdapter(credentials)
        case WeComCredentials():
            from .wecom import WeComIMProviderAdapter

            return WeComIMProviderAdapter(credentials)
        case _:
            raise TypeError("unsupported IM provider credentials")


__all__ = ["build_im_provider_adapter"]
