from __future__ import annotations

from pydantic import BaseModel


class UploadFileBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> UploadFileBodyBuilder:
        return UploadFileBodyBuilder()


class UploadFileBodyBuilder(object):
    def __init__(self):
        self._upload_file_body = UploadFileBody()

    def build(self):
        return self._upload_file_body

    def user(self, user: str) -> UploadFileBodyBuilder:
        self._upload_file_body.user = user
        return self
