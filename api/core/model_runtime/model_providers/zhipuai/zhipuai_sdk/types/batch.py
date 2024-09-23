# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import builtins
from typing import Literal, Optional

from ..core import BaseModel
from .batch_error import BatchError
from .batch_request_counts import BatchRequestCounts

__all__ = ["Batch", "Errors"]


class Errors(BaseModel):
    data: Optional[list[BatchError]] = None

    object: Optional[str] = None
    """这个类型，一直是`list`。"""


class Batch(BaseModel):
    id: str

    completion_window: str
    """用于执行请求的地址信息。"""

    created_at: int
    """这是 Unix timestamp (in seconds) 表示的创建时间。"""

    endpoint: str
    """这是ZhipuAI endpoint的地址。"""

    input_file_id: str
    """标记为batch的输入文件的ID。"""

    object: Literal["batch"]
    """这个类型，一直是`batch`."""

    status: Literal[
        "validating", "failed", "in_progress", "finalizing", "completed", "expired", "cancelling", "cancelled"
    ]
    """batch 的状态。"""

    cancelled_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的取消时间。"""

    cancelling_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示发起取消的请求时间 """

    completed_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的完成时间。"""

    error_file_id: Optional[str] = None
    """这个文件id包含了执行请求失败的请求的输出。"""

    errors: Optional[Errors] = None

    expired_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的将在过期时间。"""

    expires_at: Optional[int] = None
    """Unix timestamp (in seconds) 触发过期"""

    failed_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的失败时间。"""

    finalizing_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的最终时间。"""

    in_progress_at: Optional[int] = None
    """Unix timestamp (in seconds) 表示的开始处理时间。"""

    metadata: Optional[builtins.object] = None
    """ 
    key:value形式的元数据，以便将信息存储
        结构化格式。键的长度是64个字符，值最长512个字符
    """

    output_file_id: Optional[str] = None
    """完成请求的输出文件的ID。"""

    request_counts: Optional[BatchRequestCounts] = None
    """批次中不同状态的请求计数"""
