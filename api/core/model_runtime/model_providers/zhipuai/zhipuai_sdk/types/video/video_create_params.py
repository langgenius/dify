from __future__ import annotations

from typing import Optional

from typing_extensions import TypedDict

__all__ = ["VideoCreateParams"]

from ..sensitive_word_check import SensitiveWordCheckRequest


class VideoCreateParams(TypedDict, total=False):
    model: str
    """模型编码"""
    prompt: str
    """所需视频的文本描述"""
    image_url: str
    """所需视频的文本描述"""
    sensitive_word_check: Optional[SensitiveWordCheckRequest]
    """支持 URL 或者 Base64、传入 image 奖进行图生视频
     * 图片格式：
     *   图片大小："""
    request_id: str
    """由用户端传参，需保证唯一性；用于区分每次请求的唯一标识，用户端不传时平台会默认生成。"""

    user_id: str
    """用户端。"""
