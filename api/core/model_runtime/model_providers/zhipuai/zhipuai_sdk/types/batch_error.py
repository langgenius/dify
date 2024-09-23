# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Optional

from ..core import BaseModel

__all__ = ["BatchError"]


class BatchError(BaseModel):
    code: Optional[str] = None
    """定义的业务错误码"""

    line: Optional[int] = None
    """文件中的行号"""

    message: Optional[str] = None
    """关于对话文件中的错误的描述"""

    param: Optional[str] = None
    """参数名称，如果有的话"""
