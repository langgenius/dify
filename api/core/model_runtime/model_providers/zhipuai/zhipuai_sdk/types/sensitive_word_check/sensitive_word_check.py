from typing import Optional

from typing_extensions import TypedDict


class SensitiveWordCheckRequest(TypedDict, total=False):
    type: Optional[str]
    """敏感词类型，当前仅支持ALL"""
    status: Optional[str]
    """敏感词启用禁用状态
        启用：ENABLE
        禁用：DISABLE
       备注：默认开启敏感词校验，如果要关闭敏感词校验，需联系商务获取对应权限，否则敏感词禁用不生效。
    """
