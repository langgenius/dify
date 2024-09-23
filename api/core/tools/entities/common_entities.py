from typing import Optional

from pydantic import BaseModel


class I18nObject(BaseModel):
    """
    Model class for i18n object.
    """

    zh_Hans: Optional[str] = None
    pt_BR: Optional[str] = None
    ja_JP: Optional[str] = None
    en_US: str

    def __init__(self, **data):
        super().__init__(**data)
        if not self.zh_Hans:
            self.zh_Hans = self.en_US
        if not self.pt_BR:
            self.pt_BR = self.en_US
        if not self.ja_JP:
            self.ja_JP = self.en_US

    def to_dict(self) -> dict:
        return {"zh_Hans": self.zh_Hans, "en_US": self.en_US, "pt_BR": self.pt_BR, "ja_JP": self.ja_JP}
