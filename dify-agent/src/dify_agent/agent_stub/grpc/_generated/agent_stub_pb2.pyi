from __future__ import annotations

from collections.abc import Iterable

from google.protobuf.message import Message


class ConnectRequest(Message):
    protocol_version: int
    argv: list[str]
    metadata_json: str

    def __init__(
        self,
        *,
        protocol_version: int = ...,
        argv: Iterable[str] = ...,
        metadata_json: str = ...,
    ) -> None: ...


class ConnectResponse(Message):
    connection_id: str
    status: str

    def __init__(self, *, connection_id: str = ..., status: str = ...) -> None: ...


class FileUploadRequest(Message):
    filename: str
    mimetype: str

    def __init__(self, *, filename: str = ..., mimetype: str = ...) -> None: ...


class FileUploadResponse(Message):
    upload_url: str

    def __init__(self, *, upload_url: str = ...) -> None: ...


class FileMapping(Message):
    transfer_method: str
    reference: str
    url: str

    def __init__(self, *, transfer_method: str = ..., reference: str = ..., url: str = ...) -> None: ...
    def HasField(self, field_name: str) -> bool: ...


class FileDownloadRequest(Message):
    file: FileMapping

    def __init__(self, *, file: FileMapping | None = ...) -> None: ...


class FileDownloadResponse(Message):
    filename: str
    mime_type: str
    size: int
    download_url: str

    def __init__(
        self,
        *,
        filename: str = ...,
        mime_type: str = ...,
        size: int = ...,
        download_url: str = ...,
    ) -> None: ...
    def HasField(self, field_name: str) -> bool: ...
