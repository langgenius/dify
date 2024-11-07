from pydantic import BaseModel, Field, ConfigDict

from .raw_response import RawResponse


class BaseResponse(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    raw: RawResponse | None = None
    code: int | None = Field(default=None, exclude=True)
    msg: str | None = Field(default=None, exclude=True)

    @property
    def success(self):
        return self.code is not None and self.code == 0
