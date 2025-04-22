import abc
import mimetypes
import typing as tp

from pydantic import BaseModel, field_validator
from sqlalchemy import Engine

from constants.mimetypes import DEFAULT_EXTENSION
from core.file import File, FileTransferMethod, FileType
from core.tools.signature import sign_tool_file
from core.tools.tool_file_manager import ToolFileManager
from models import db as global_db


class MultiModalFile(BaseModel):
    # user_id records t
    user_id: str
    # tenant_id
    tenant_id: str
    file_type: FileType

    # data is the contents of the file
    data: bytes

    # mime_type is the media type of the file, specified by
    # rfc6838 (https://datatracker.ietf.org/doc/html/rfc6838)
    mime_type: str

    # `extension_override` allow the user to manually specify the file extension to use
    # while saving this file.
    #
    # The default value is `None`, which means do not override the file extension and guessing it
    # from the `mime_type` attribute while saving the file.
    #
    # Setting it to values other than `None` means override the file's extension, and
    # will bypass the extension guessing when calling `get_extension`.
    # Specially, setting it to empty string (`""`) will leave the file extension empty.
    #
    # When it is not `None` or empty string (`""`), it should be a string beginning with a
    # dot (`.`). For example, `.py` and `.tar.gz` are both valid values, while `py`
    # and `tar.gz` is not.
    #
    # Users of MultiModalFile should always use `get_extension` to access
    # the files extension, instead reading this property directly.
    extension_override: str | None = None

    def get_extension(self) -> str:
        """get_extension return the extension of file.

        If the `extension_override` parameter is set, this method should honor it and
        return its value.
        """
        if (extension := self.extension_override) is not None:
            return extension
        return mimetypes.guess_extension(self.mime_type) or DEFAULT_EXTENSION

    @field_validator("extension_override")
    @classmethod
    def _validate_extension_override(cls, extension_override: str | None) -> str | None:
        # `extension_override` is allow to be `None or `""`.
        if not extension_override:
            return None
        if not extension_override.startswith("."):
            raise ValueError("extension_override should start with '.' if not None or empty.", extension_override)
        return extension_override


class MultiModalFileSaver(tp.Protocol):
    @abc.abstractmethod
    def save_file(self, mmf: MultiModalFile) -> File:
        pass


EngineFactory: tp.TypeAlias = tp.Callable[[], Engine]


class StorageFileSaver(MultiModalFileSaver):
    _engine_factory: EngineFactory

    def __init__(self, engine_factory: EngineFactory | None = None):
        if engine_factory is None:

            def _factory():
                return global_db.engine

            engine_factory = _factory
        self._engine_factory = engine_factory

    def _get_tool_file_manager(self):
        return ToolFileManager(engine=self._engine_factory())

    def save_file(self, mmf: MultiModalFile) -> File:
        tool_file_manager = self._get_tool_file_manager()
        tool_file = tool_file_manager.create_file_by_raw(
            user_id=mmf.user_id,
            tenant_id=mmf.tenant_id,
            # TODO(QuantumGhost): what is conversation id?
            conversation_id=None,
            file_binary=mmf.data,
            mimetype=mmf.mime_type,
        )
        url = sign_tool_file(tool_file.id, mmf.get_extension())

        return File(
            tenant_id=mmf.tenant_id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            filename=tool_file.name,
            extension=mmf.get_extension(),
            mime_type=mmf.mime_type,
            size=len(mmf.data),
            related_id=tool_file.id,
            url=url,
            # TODO(QuantumGhost): how should I set the following key?
            # What's the difference between `remote_url` and `url`?
            # What's the purpose of `storage_key` and `dify_model_identity`?
            storage_key=tool_file.file_key,
        )
