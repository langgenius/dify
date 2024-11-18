from enum import Enum


class FileType(str, Enum):
    IMAGE = "image"
    DOCUMENT = "document"
    AUDIO = "audio"
    VIDEO = "video"
    CUSTOM = "custom"

    @staticmethod
    def value_of(value):
        for member in FileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileTransferMethod(str, Enum):
    REMOTE_URL = "remote_url"
    LOCAL_FILE = "local_file"
    TOOL_FILE = "tool_file"

    @staticmethod
    def value_of(value):
        for member in FileTransferMethod:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileBelongsTo(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"

    @staticmethod
    def value_of(value):
        for member in FileBelongsTo:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class FileAttribute(str, Enum):
    TYPE = "type"
    SIZE = "size"
    NAME = "name"
    MIME_TYPE = "mime_type"
    TRANSFER_METHOD = "transfer_method"
    URL = "url"
    EXTENSION = "extension"


class ArrayFileAttribute(str, Enum):
    LENGTH = "length"
