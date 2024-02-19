from __future__ import annotations

from typing import Any, ClassVar, Union

from httpx import Timeout
from pydantic import ConfigDict
from typing_extensions import TypedDict, Unpack

from ._base_type import Body, Headers, HttpxRequestFiles, NotGiven, Query
from ._utils import remove_notgiven_indict


class UserRequestInput(TypedDict, total=False):
    max_retries: int
    timeout: float | Timeout | None
    headers: Headers
    params: Query | None


class ClientRequestParam:
    method: str
    url: str
    max_retries: Union[int, NotGiven] = NotGiven()
    timeout: Union[float, NotGiven] = NotGiven()
    headers: Union[Headers, NotGiven] = NotGiven()
    json_data: Union[Body, None] = None
    files: Union[HttpxRequestFiles, None] = None
    params: Query = {}
    model_config: ClassVar[ConfigDict] = ConfigDict(arbitrary_types_allowed=True)

    def get_max_retries(self, max_retries) -> int:
        if isinstance(self.max_retries, NotGiven):
            return max_retries
        return self.max_retries

    @classmethod
    def construct(  # type: ignore
            cls,
            _fields_set: set[str] | None = None,
            **values: Unpack[UserRequestInput],
    ) -> ClientRequestParam :
        kwargs: dict[str, Any] = {
            key: remove_notgiven_indict(value) for key, value in values.items()
        }
        client = cls()
        client.__dict__.update(kwargs)

        return client

    model_construct = construct

