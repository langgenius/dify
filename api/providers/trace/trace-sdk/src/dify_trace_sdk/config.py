"""Provider configuration models.

A provider declares its configuration once, as a pydantic model. Field
metadata marks which values are secrets (encrypted at rest, never returned),
which are derived (resolved by ``verify``, never accepted from users), and
which name the destination secrets are sent to.
"""

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

_SECRET = "x-dify-secret"
_DERIVED = "x-dify-derived"
_DESTINATION = "x-dify-destination"


def secret(*, default: Any = PydanticUndefined) -> Any:
    """Declare a credential field: encrypted at rest and write-only through the API."""
    return Field(default=default, json_schema_extra={_SECRET: True})


def derived() -> Any:
    """Declare a field that ``verify`` resolves from the destination; users cannot set it."""
    return Field(default=None, json_schema_extra={_DERIVED: True})


def destination(*, default: Any = PydanticUndefined) -> Any:
    """Declare a field naming where secrets are sent; changing it requires entering the secrets again."""
    return Field(default=default, json_schema_extra={_DESTINATION: True})


def _flag(field: FieldInfo, name: str) -> bool:
    extra = field.json_schema_extra
    return isinstance(extra, dict) and extra.get(name) is True


@dataclass(frozen=True)
class FormField:
    name: str
    secret: bool
    required: bool


class ProviderConfig(BaseModel):
    """Base class for provider configuration.

    Validation errors never echo input values: users paste credentials into
    endpoint fields, and these errors reach logs and API responses.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, hide_input_in_errors=True)

    @classmethod
    def secret_fields(cls) -> frozenset[str]:
        return frozenset(name for name, field in cls.model_fields.items() if _flag(field, _SECRET))

    @classmethod
    def derived_fields(cls) -> frozenset[str]:
        return frozenset(name for name, field in cls.model_fields.items() if _flag(field, _DERIVED))

    @classmethod
    def destination_fields(cls) -> frozenset[str]:
        return frozenset(name for name, field in cls.model_fields.items() if _flag(field, _DESTINATION))

    @classmethod
    def form_fields(cls) -> tuple[FormField, ...]:
        """The user-editable fields, in declaration order."""
        return tuple(
            FormField(name=name, secret=_flag(field, _SECRET), required=field.is_required())
            for name, field in cls.model_fields.items()
            if not _flag(field, _DERIVED)
        )


def http_url(value: str, *, allowed_schemes: tuple[str, ...]) -> str:
    """Validate a destination URL, keeping its path; reject credentials in the authority."""
    url = value.strip()
    parsed = urlsplit(url)
    if parsed.scheme not in allowed_schemes:
        raise ValueError("URL must start with " + " or ".join(f"{scheme}://" for scheme in allowed_schemes))
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise ValueError("URL must name a host and must not contain credentials")
    return url


def name_or_default(value: str | None, default: str) -> str:
    return value.strip() if value and value.strip() else default


def integer_id(value: str) -> str:
    stripped = value.strip()
    if not (stripped.isascii() and stripped.isdigit()):
        raise ValueError("ID must be a valid integer")
    return stripped
