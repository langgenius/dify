from pydantic import BaseModel

from core.file.constants import FILE_MODEL_IDENTITY
from core.file.enums import FileType


class PluginFileEntity(BaseModel):
    """
    File entity for plugin tool.
    """

    dify_model_identity: str = FILE_MODEL_IDENTITY
    mime_type: str | None
    filename: str | None
    extension: str | None
    size: int | None
    type: FileType
    url: str
