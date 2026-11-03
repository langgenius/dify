"""Turn serialized Agent App images into pydantic-ai user content."""

from __future__ import annotations

import base64
import json
from typing import assert_never

from pydantic_ai.messages import BinaryContent, ImageUrl, UserContent

from pydantic import BaseModel, ConfigDict
from pydantic_ai.capabilities import AbstractCapability
from dify_agent.runtime.context import Deps
from dify_agent.layers.user_prompt.configs import (
    DifyUserPromptDownloadConfig,
    DifyUserPromptImageConfig,
    DifyUserPromptLayerConfig,
)


class Config(DifyUserPromptLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    """Resolve current user content before calling Agent.run."""

    def __init__(self, name: str):
        self.id = name
        self.name = name

    def build_user_content(self, deps: Deps) -> list[UserContent]:
        config = Config.model_validate(deps.layers[self.name]["config"])
        images: list[UserContent] = []
        downloads: list[DifyUserPromptDownloadConfig] = []
        for file in config.files:
            match file.delivery:
                case "multimodal":
                    images.append(_to_image_content(file))
                case "download":
                    downloads.append(file)
                case _:
                    assert_never(file)
        return [_append_file_downloads(config.text, downloads), *images]


def _append_file_downloads(text: str, files: list[DifyUserPromptDownloadConfig]) -> str:
    if not files:
        return text
    locators = [file.model_dump(mode="json", exclude={"delivery", "type"}, exclude_none=True) for file in files]
    payload = json.dumps(locators, ensure_ascii=False, separators=(",", ":"))
    return (
        f"{text}\n"
        "User provided files: use dify-agent file download with the listed transfer_method and reference/url "
        "to get the files and investigate them\n"
        f"{payload}"
    )


def _to_image_content(file: DifyUserPromptImageConfig) -> ImageUrl | BinaryContent:
    vendor_metadata: dict[str, str] = {"filename": file.filename}
    if file.detail is not None:
        vendor_metadata["detail"] = file.detail
    identifier = _identifier_from_filename(file.filename, file.format)
    if file.url is not None:
        return ImageUrl(
            url=file.url,
            media_type=file.mime_type,
            identifier=identifier,
            vendor_metadata=vendor_metadata,
        )
    assert file.base64_data is not None
    return BinaryContent(
        data=base64.b64decode(file.base64_data, validate=True),
        media_type=file.mime_type,
        identifier=identifier,
        vendor_metadata=vendor_metadata,
    )


def _identifier_from_filename(filename: str, file_format: str) -> str:
    suffix = f".{file_format}"
    if filename.lower().endswith(suffix.lower()):
        return filename[: -len(suffix)] or "image"
    return filename


__all__ = ["Config", "State", "Capability"]
