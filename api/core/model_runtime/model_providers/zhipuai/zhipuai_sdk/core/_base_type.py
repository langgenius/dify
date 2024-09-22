from __future__ import annotations

from collections.abc import Mapping, Sequence
from os import PathLike
from typing import IO, TYPE_CHECKING, Any, Literal, TypeVar, Union

import pydantic
from typing_extensions import override

Query = Mapping[str, object]
Body = object
AnyMapping = Mapping[str, object]
PrimitiveData = Union[str, int, float, bool, None]
Data = Union[PrimitiveData, list[Any], tuple[Any], "Mapping[str, Any]"]
ModelT = TypeVar("ModelT", bound=pydantic.BaseModel)
_T = TypeVar("_T")

if TYPE_CHECKING:
    NoneType: type[None]
else:
    NoneType = type(None)


# Sentinel class used until PEP 0661 is accepted
class NotGiven(pydantic.BaseModel):
    """
    A sentinel singleton class used to distinguish omitted keyword arguments
    from those passed in with the value None (which may have different behavior).

    For example:

    ```py
    def get(timeout: Union[int, NotGiven, None] = NotGiven()) -> Response: ...

    get(timeout=1) # 1s timeout
    get(timeout=None) # No timeout
    get() # Default timeout behavior, which may not be statically known at the method definition.
    ```
    """

    def __bool__(self) -> Literal[False]:
        return False

    @override
    def __repr__(self) -> str:
        return "NOT_GIVEN"


NotGivenOr = Union[_T, NotGiven]
NOT_GIVEN = NotGiven()


class Omit(pydantic.BaseModel):
    """In certain situations you need to be able to represent a case where a default value has
    to be explicitly removed and `None` is not an appropriate substitute, for example:

    ```py
    # as the default `Content-Type` header is `application/json` that will be sent
    client.post('/upload/files', files={'file': b'my raw file content'})

    # you can't explicitly override the header as it has to be dynamically generated
    # to look something like: 'multipart/form-data; boundary=0d8382fcf5f8c3be01ca2e11002d2983'
    client.post(..., headers={'Content-Type': 'multipart/form-data'})

    # instead you can remove the default `application/json` header by passing Omit
    client.post(..., headers={'Content-Type': Omit()})
    ```
    """

    def __bool__(self) -> Literal[False]:
        return False


Headers = Mapping[str, Union[str, Omit]]

ResponseT = TypeVar(
    "ResponseT",
    bound="Union[str, None, BaseModel, list[Any], Dict[str, Any], Response, UnknownResponse, ModelBuilderProtocol,"
    " BinaryResponseContent]",
)

# for user input files
if TYPE_CHECKING:
    FileContent = Union[IO[bytes], bytes, PathLike[str]]
else:
    FileContent = Union[IO[bytes], bytes, PathLike]

FileTypes = Union[
    FileContent,  # file content
    tuple[str, FileContent],  # (filename, file)
    tuple[str, FileContent, str],  # (filename, file , content_type)
    tuple[str, FileContent, str, Mapping[str, str]],  # (filename, file , content_type, headers)
]

RequestFiles = Union[Mapping[str, FileTypes], Sequence[tuple[str, FileTypes]]]

# for httpx client supported files

HttpxFileContent = Union[bytes, IO[bytes]]
HttpxFileTypes = Union[
    FileContent,  # file content
    tuple[str, HttpxFileContent],  # (filename, file)
    tuple[str, HttpxFileContent, str],  # (filename, file , content_type)
    tuple[str, HttpxFileContent, str, Mapping[str, str]],  # (filename, file , content_type, headers)
]

HttpxRequestFiles = Union[Mapping[str, HttpxFileTypes], Sequence[tuple[str, HttpxFileTypes]]]
