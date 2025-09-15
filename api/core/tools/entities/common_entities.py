from typing import Optional

from pydantic import BaseModel, Field


class I18nObject(BaseModel):
    """
    Model class for i18n object.
    """

    en_US: str
    zh_Hans: str | None = Field(default=None)
    pt_BR: str | None = Field(default=None)
    ja_JP: str | None = Field(default=None)

    def __init__(self, **data):
        super().__init__(**data)
        self.zh_Hans = self.zh_Hans or self.en_US
        self.pt_BR = self.pt_BR or self.en_US
        self.ja_JP = self.ja_JP or self.en_US

    def to_dict(self):
        return {"zh_Hans": self.zh_Hans, "en_US": self.en_US, "pt_BR": self.pt_BR, "ja_JP": self.ja_JP}
