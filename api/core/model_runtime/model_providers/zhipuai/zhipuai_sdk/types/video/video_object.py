from typing import Optional

from ...core import BaseModel

__all__ = ["VideoObject", "VideoResult"]


class VideoResult(BaseModel):
    url: str
    """视频url"""
    cover_image_url: str
    """预览图"""


class VideoObject(BaseModel):
    id: Optional[str] = None
    """智谱 AI 开放平台生成的任务订单号，调用请求结果接口时请使用此订单号"""

    model: str
    """模型名称"""

    video_result: list[VideoResult]
    """视频生成结果"""

    task_status: str
    """处理状态，PROCESSING（处理中），SUCCESS（成功），FAIL（失败）
    注：处理中状态需通过查询获取结果"""

    request_id: str
    """用户在客户端请求时提交的任务编号或者平台生成的任务编号"""
