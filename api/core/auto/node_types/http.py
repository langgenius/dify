from enum import Enum
from typing import Optional, Union

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ValueSelector, Variable

# Import previously defined CommonNodeType, ValueSelector, and Variable
# Assume they are defined in the same module


class Method(str, Enum):
    """HTTP request methods."""

    get = "get"
    post = "post"
    head = "head"
    patch = "patch"
    put = "put"
    delete = "delete"


class BodyType(str, Enum):
    """HTTP request body types."""

    none = "none"
    formData = "form-data"
    xWwwFormUrlencoded = "x-www-form-urlencoded"
    rawText = "raw-text"
    json = "json"
    binary = "binary"


class BodyPayloadValueType(str, Enum):
    """Types of values in body payload."""

    text = "text"
    file = "file"


class BodyPayload(BaseModel):
    """Body payload item for HTTP requests."""

    id: Optional[str] = None
    key: Optional[str] = None
    type: BodyPayloadValueType
    file: Optional[ValueSelector] = None  # Used when type is file
    value: Optional[str] = None  # Used when type is text


class Body(BaseModel):
    """HTTP request body configuration."""

    type: BodyType
    data: Union[str, list[BodyPayload]]  # string is deprecated, will convert to BodyPayload


class AuthorizationType(str, Enum):
    """HTTP authorization types."""

    none = "no-auth"
    apiKey = "api-key"


class APIType(str, Enum):
    """API key types."""

    basic = "basic"
    bearer = "bearer"
    custom = "custom"


class AuthConfig(BaseModel):
    """Authorization configuration."""

    type: APIType
    api_key: str
    header: Optional[str] = None


class Authorization(BaseModel):
    """HTTP authorization settings."""

    type: AuthorizationType
    config: Optional[AuthConfig] = None


class Timeout(BaseModel):
    """HTTP request timeout settings."""

    connect: Optional[int] = None
    read: Optional[int] = None
    write: Optional[int] = None
    max_connect_timeout: Optional[int] = None
    max_read_timeout: Optional[int] = None
    max_write_timeout: Optional[int] = None


class HttpNodeType(CommonNodeType):
    """HTTP request node type implementation."""

    variables: list[Variable]
    method: Method
    url: str
    headers: str
    params: str
    body: Body
    authorization: Authorization
    timeout: Timeout


# Example usage
if __name__ == "__main__":
    example_node = HttpNodeType(
        title="Example HTTP Node",
        desc="An HTTP request node example",
        type=BlockEnum.http_request,
        variables=[Variable(variable="var1", value_selector=["node1", "key1"])],
        method=Method.get,
        url="https://api.example.com/data",
        headers="{}",
        params="{}",
        body=Body(type=BodyType.none, data=[]),
        authorization=Authorization(type=AuthorizationType.none),
        timeout=Timeout(connect=30, read=30, write=30),
    )
    print(example_node)
