from typing import Optional

from pydantic import BaseModel


class I18nObject(BaseModel):
    """
    Model class for i18n object.
    """

    zh_Hans: Optional[str] = None
    en_US: str

    def __init__(self, **data):
        super().__init__(**data)
        if not self.zh_Hans:
            self.zh_Hans = self.en_US
