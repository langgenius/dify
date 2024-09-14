from typing import Optional, TypedDict

__all__ = ["DocumentEditParams"]


class DocumentEditParams(TypedDict):
    """
    知识参数类型定义

    Attributes:
        id (str): 知识ID
        knowledge_type (int): 知识类型:
                        1:文章知识: 支持pdf,url,docx
                        2.问答知识-文档:  支持pdf,url,docx
                        3.问答知识-表格:  支持xlsx
                        4.商品库-表格:  支持xlsx
                        5.自定义:  支持pdf,url,docx
        custom_separator (Optional[List[str]]): 当前知识类型为自定义(knowledge_type=5)时的切片规则，默认\n
        sentence_size (Optional[int]): 当前知识类型为自定义(knowledge_type=5)时的切片字数，取值范围: 20-2000，默认300
        callback_url (Optional[str]): 回调地址
        callback_header (Optional[dict]): 回调时携带的header
    """

    id: str
    knowledge_type: int
    custom_separator: Optional[list[str]]
    sentence_size: Optional[int]
    callback_url: Optional[str]
    callback_header: Optional[dict[str, str]]
