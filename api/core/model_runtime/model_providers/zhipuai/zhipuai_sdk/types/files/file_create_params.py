from __future__ import annotations

from typing import Literal, Optional

from typing_extensions import Required, TypedDict

__all__ = ["FileCreateParams"]

from ...core import FileTypes
from . import UploadDetail


class FileCreateParams(TypedDict, total=False):
    file: FileTypes
    """file和 upload_detail二选一必填"""

    upload_detail: list[UploadDetail]
    """file和 upload_detail二选一必填"""

    purpose: Required[Literal["fine-tune", "retrieval", "batch"]]
    """ 
    上传文件的用途，支持 "fine-tune和 "retrieval"
    retrieval支持上传Doc、Docx、PDF、Xlsx、URL类型文件，且单个文件的大小不超过 5MB。
    fine-tune支持上传.jsonl文件且当前单个文件的大小最大可为 100 MB ，文件中语料格式需满足微调指南中所描述的格式。
    """
    custom_separator: Optional[list[str]]
    """ 
    当 purpose 为 retrieval 且文件类型为 pdf, url, docx 时上传，切片规则默认为 `\n`。
    """
    knowledge_id: str
    """ 
        当文件上传目的为  retrieval 时，需要指定知识库ID进行上传。
    """

    sentence_size: int
    """ 
        当文件上传目的为  retrieval 时，需要指定知识库ID进行上传。
    """
