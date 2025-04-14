from typing import Optional

from pydantic import BaseModel


class IconInfo(BaseModel):
    icon: str
    icon_background: Optional[str] = None
    icon_type: Optional[str] = None
    icon_url: Optional[str] = None


class PipelineTemplateInfoEntity(BaseModel):
    name: str
    description: str
    icon_info: IconInfo
