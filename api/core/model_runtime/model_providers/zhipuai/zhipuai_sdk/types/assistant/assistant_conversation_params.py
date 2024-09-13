from typing import TypedDict, List, Optional, Union


class ConversationParameters(TypedDict, total=False):
    assistant_id: str  # 智能体 ID
    page: int  # 当前分页
    page_size: int  # 分页数量
