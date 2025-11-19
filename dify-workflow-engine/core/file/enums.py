from enum import StrEnum

class FileType(StrEnum):
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"
    CUSTOM = "custom"

class FileTransferMethod(StrEnum):
    REMOTE_URL = "remote_url"
    LOCAL_FILE = "local_file"
    TOOL_FILE = "tool_file"
