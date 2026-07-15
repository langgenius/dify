from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ConnectRequest(_message.Message):
    __slots__ = ("protocol_version", "argv", "metadata_json")
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    ARGV_FIELD_NUMBER: _ClassVar[int]
    METADATA_JSON_FIELD_NUMBER: _ClassVar[int]
    protocol_version: int
    argv: _containers.RepeatedScalarFieldContainer[str]
    metadata_json: str
    def __init__(self, protocol_version: _Optional[int] = ..., argv: _Optional[_Iterable[str]] = ..., metadata_json: _Optional[str] = ...) -> None: ...

class ConnectResponse(_message.Message):
    __slots__ = ("connection_id", "status")
    CONNECTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    connection_id: str
    status: str
    def __init__(self, connection_id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class FileUploadRequest(_message.Message):
    __slots__ = ("filename", "mimetype")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIMETYPE_FIELD_NUMBER: _ClassVar[int]
    filename: str
    mimetype: str
    def __init__(self, filename: _Optional[str] = ..., mimetype: _Optional[str] = ...) -> None: ...

class FileUploadResponse(_message.Message):
    __slots__ = ("upload_url",)
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    upload_url: str
    def __init__(self, upload_url: _Optional[str] = ...) -> None: ...

class FileMapping(_message.Message):
    __slots__ = ("transfer_method", "reference", "url")
    TRANSFER_METHOD_FIELD_NUMBER: _ClassVar[int]
    REFERENCE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    transfer_method: str
    reference: str
    url: str
    def __init__(self, transfer_method: _Optional[str] = ..., reference: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class FileDownloadRequest(_message.Message):
    __slots__ = ("file", "for_external")
    FILE_FIELD_NUMBER: _ClassVar[int]
    FOR_EXTERNAL_FIELD_NUMBER: _ClassVar[int]
    file: FileMapping
    for_external: bool
    def __init__(self, file: _Optional[_Union[FileMapping, _Mapping]] = ..., for_external: _Optional[bool] = ...) -> None: ...

class FileDownloadResponse(_message.Message):
    __slots__ = ("filename", "mime_type", "size", "download_url")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    filename: str
    mime_type: str
    size: int
    download_url: str
    def __init__(self, filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., size: _Optional[int] = ..., download_url: _Optional[str] = ...) -> None: ...
