from __future__ import annotations

from fields.base import ResponseModel


class DataSetTag(ResponseModel):
    id: str
    name: str
    type: str
    binding_count: str | None = None
