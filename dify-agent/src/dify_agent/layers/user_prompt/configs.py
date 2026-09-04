"""Serializable DTOs for one Agent App multimodal user prompt."""

from __future__ import annotations

import base64
import binascii
from typing import ClassVar, Final, Literal, Self

from pydantic import ConfigDict, Field, model_validator

from agenton.layers import LayerConfig


DIFY_USER_PROMPT_LAYER_TYPE_ID: Final[str] = "dify.user_prompt"


class DifyUserPromptFileConfig(LayerConfig):
    """One image delivered directly to the configured vision model.

    Callers provide either an HTTP(S) URL or base64 bytes. Opaque Dify file
    references belong to the sandbox download flow and are not accepted here.
    """

    type: Literal["image"] = "image"
    filename: str = Field(min_length=1)
    mime_type: str = Field(pattern=r"^image/[A-Za-z0-9.+-]+$")
    format: str = Field(min_length=1)
    url: str | None = None
    base64_data: str | None = None
    detail: Literal["low", "high"] | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _validate_transport(self) -> Self:
        if (self.url is None) == (self.base64_data is None):
            raise ValueError("exactly one of url or base64_data must be provided")
        if self.url is not None and not self.url.startswith(("http://", "https://")):
            raise ValueError("url must use http or https")
        if self.base64_data is not None:
            try:
                base64.b64decode(self.base64_data, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise ValueError("base64_data must be valid base64") from exc
        return self


class DifyUserPromptLayerConfig(LayerConfig):
    """User text plus images that should be sent in the same model turn."""

    text: str = Field(min_length=1)
    files: list[DifyUserPromptFileConfig] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "DIFY_USER_PROMPT_LAYER_TYPE_ID",
    "DifyUserPromptFileConfig",
    "DifyUserPromptLayerConfig",
]
