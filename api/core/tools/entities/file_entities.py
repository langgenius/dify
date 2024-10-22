from pydantic import BaseModel

from core.file.constants import FILE_MODEL_IDENTITY


class PluginFileEntity(BaseModel):
    """
    File entity for plugin tool.
    """

    dify_model_identity: str = FILE_MODEL_IDENTITY
    url: str
