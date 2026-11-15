from enum import StrEnum
from typing import Self


class FileType(StrEnum):
    IMAGE = "image"
    DOCUMENT = "document"
    AUDIO = "audio"
    VIDEO = "video"
    CUSTOM = "custom"

    @classmethod
    def value_of(cls, value: str) -> Self:
        return cls(value)


class FileTransferMethod(StrEnum):
    REMOTE_URL = "remote_url"
    LOCAL_FILE = "local_file"
    TOOL_FILE = "tool_file"
    DATASOURCE_FILE = "datasource_file"

    @classmethod
    def value_of(cls, value: str) -> Self:
        return cls(value)


class FileBelongsTo(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"

    @classmethod
    def value_of(cls, value: str) -> Self:
        return cls(value)


class FileAttribute(StrEnum):
    TYPE = "type"
    SIZE = "size"
    NAME = "name"
    MIME_TYPE = "mime_type"
    TRANSFER_METHOD = "transfer_method"
    URL = "url"
    EXTENSION = "extension"
    RELATED_ID = "related_id"


class ArrayFileAttribute(StrEnum):
    LENGTH = "length"
