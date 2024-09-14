from __future__ import annotations

from typing import Optional, Union

from typing_extensions import TypedDict

__all__ = ["WebSearchParams"]


class WebSearchParams(TypedDict):
    """
    工具名：web-search-pro参数类型定义

    Attributes:
        :param model: str, 模型名称
        :param request_id: Optional[str], 请求ID
        :param stream: Optional[bool], 是否流式
        :param messages: Union[str, List[str], List[int], object, None],
                        包含历史对话上下文的内容，按照 {"role": "user", "content": "你好"} 的json 数组形式进行传参
                        当前版本仅支持 User Message 单轮对话，工具会理解User Message并进行搜索，
                        请尽可能传入不带指令格式的用户原始提问，以提高搜索准确率。
        :param scope: Optional[str], 指定搜索范围，全网、学术等，默认全网
        :param location: Optional[str], 指定搜索用户地区 location 提高相关性
        :param recent_days: Optional[int],支持指定返回 N 天（1-30）更新的搜索结果


    """

    model: str
    request_id: Optional[str]
    stream: Optional[bool]
    messages: Union[str, list[str], list[int], object, None]
    scope: Optional[str] = None
    location: Optional[str] = None
    recent_days: Optional[int] = None
