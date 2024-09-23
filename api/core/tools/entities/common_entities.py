from typing import Optional

from pydantic import BaseModel, Field


class I18nObject(BaseModel):
    """
    Model class for i18n object.
    """

    en_US: str
    zh_Hans: Optional[str] = Field(default=None)
    pt_BR: Optional[str] = Field(default=None)
    ja_JP: Optional[str] = Field(default=None)

    def __init__(self, **data):
        super().__init__(**data)
        self.zh_Hans = self.zh_Hans or self.en_US
        self.pt_BR = self.pt_BR or self.en_US
        self.ja_JP = self.ja_JP or self.en_US

    def to_dict(self) -> dict:
        return {"zh_Hans": self.zh_Hans, "en_US": self.en_US, "pt_BR": self.pt_BR, "ja_JP": self.ja_JP}
