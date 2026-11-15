from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class I18nObject(BaseModel):
    """Model class for i18n object."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    zh_hans: str | None = Field(default=None, alias="zh_Hans")
    en_us: str = Field(alias="en_US")

    @model_validator(mode="after")
    def _fill_missing_zh_hans(self) -> Self:
        if not self.zh_hans:
            self.zh_hans = self.en_us
        return self
