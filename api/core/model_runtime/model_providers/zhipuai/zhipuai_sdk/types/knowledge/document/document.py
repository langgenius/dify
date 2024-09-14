from typing import Optional

from ....core import BaseModel

__all__ = ["DocumentData", "DocumentObject", "DocumentSuccessinfo", "DocumentFailedInfo"]


class DocumentSuccessinfo(BaseModel):
    documentId: Optional[str] = None
    """文件id"""
    filename: Optional[str] = None
    """文件名称"""


class DocumentFailedInfo(BaseModel):
    failReason: Optional[str] = None
    """上传失败的原因，包括：文件格式不支持、文件大小超出限制、知识库容量已满、容量上限为 50 万字。"""
    filename: Optional[str] = None
    """文件名称"""
    documentId: Optional[str] = None
    """知识库id"""


class DocumentObject(BaseModel):
    """文档信息"""

    successInfos: Optional[list[DocumentSuccessinfo]] = None
    """上传成功的文件信息"""
    failedInfos: Optional[list[DocumentFailedInfo]] = None
    """上传失败的文件信息"""


class DocumentDataFailInfo(BaseModel):
    """失败原因"""

    embedding_code: Optional[int] = (
        None  # 失败码 10001：知识不可用，知识库空间已达上限 10002：知识不可用，知识库空间已达上限(字数超出限制)
    )
    embedding_msg: Optional[str] = None  # 失败原因


class DocumentData(BaseModel):
    id: str = None  # 知识唯一id
    custom_separator: list[str] = None  # 切片规则
    sentence_size: str = None  # 切片大小
    length: int = None  # 文件大小（字节）
    word_num: int = None  # 文件字数
    name: str = None  # 文件名
    url: str = None  # 文件下载链接
    embedding_stat: int = None  # 0:向量化中 1:向量化完成 2:向量化失败
    failInfo: Optional[DocumentDataFailInfo] = None  # 失败原因 向量化失败embedding_stat=2的时候 会有此值
