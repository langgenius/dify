from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import BinaryContent, ImageUrl

from dify_agent.layers.user_prompt import DifyUserPromptLayerConfig
from dify_agent.layers.user_prompt.layer import DifyUserPromptLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


@pytest.mark.parametrize("include_image", [False, True])
@pytest.mark.parametrize("download_type", ["image", "document"])
def test_user_prompt_layer_injects_file_locators(include_image: bool, download_type: str) -> None:
    config = DifyUserPromptLayerConfig.model_validate(
        {
            "text": "Inspect these files.",
            "files": [
                {
                    "delivery": "download",
                    "type": download_type,
                    "transfer_method": "local_file",
                    "reference": "dify-file-ref:upload-file-1",
                },
                {
                    "delivery": "download",
                    "type": "document",
                    "transfer_method": "remote_url",
                    "url": "https://example.com/说明.pdf",
                },
                {
                    "delivery": "download",
                    "type": "document",
                    "transfer_method": "tool_file",
                    "reference": "dify-file-ref:tool-file-1",
                },
                {
                    "delivery": "download",
                    "type": "document",
                    "transfer_method": "datasource_file",
                    "reference": "dify-file-ref:datasource-file-1",
                },
                *(
                    [
                        {
                            "delivery": "multimodal",
                            "type": "image",
                            "filename": "earth.png",
                            "mime_type": "image/png",
                            "format": "png",
                            "url": "https://files.example.com/earth.png",
                        }
                    ]
                    if include_image
                    else []
                ),
            ],
        }
    )
    layer = DifyUserPromptLayer.from_config(DifyUserPromptLayerConfig.model_validate_json(config.model_dump_json()))

    prompts = layer.user_prompts

    assert prompts[0] == (
        "Inspect these files.\n"
        "User provided files: use dify-agent file download with the listed transfer_method and reference/url "
        "to get the files and investigate them\n"
        '[{"transfer_method":"local_file","reference":"dify-file-ref:upload-file-1"},'
        '{"transfer_method":"remote_url","url":"https://example.com/说明.pdf"},'
        '{"transfer_method":"tool_file","reference":"dify-file-ref:tool-file-1"},'
        '{"transfer_method":"datasource_file","reference":"dify-file-ref:datasource-file-1"}]'
    )
    assert layer.config.text == "Inspect these files."
    assert "locators" not in layer.config.model_dump()
    assert layer.user_prompts == prompts
    assert len(prompts) == (2 if include_image else 1)
    if include_image:
        assert isinstance(prompts[1], ImageUrl)
        assert prompts[1].url == "https://files.example.com/earth.png"


@pytest.mark.parametrize(
    "locator",
    [
        {"transfer_method": "remote_url", "reference": "file-1"},
        {"transfer_method": "local_file", "url": "https://example.com/file.pdf"},
        {"transfer_method": "unsupported", "reference": "file-1"},
        {"transfer_method": "local_file"},
        {"transfer_method": "remote_url"},
        {"transfer_method": "local_file", "reference": ""},
        {"transfer_method": "remote_url", "url": ""},
        {"transfer_method": "remote_url", "url": "https://example.com/file.pdf", "reference": "file-1"},
        {"transfer_method": "tool_file", "url": "https://example.com/file.pdf", "reference": "file-1"},
    ],
)
def test_user_prompt_layer_rejects_invalid_locators(locator: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        DifyUserPromptLayerConfig.model_validate(
            {"text": "Inspect it.", "files": [{"delivery": "download", "type": "document", **locator}]}
        )


def test_user_prompt_layer_preserves_text_without_locators() -> None:
    layer = DifyUserPromptLayer.from_config(DifyUserPromptLayerConfig(text="  Original prompt.\n"))

    assert layer.user_prompts == ["  Original prompt.\n"]


def test_user_prompt_layer_restores_image_url_content() -> None:
    layer = DifyUserPromptLayer.from_config(
        DifyUserPromptLayerConfig.model_validate(
            {
                "text": "What is in this image?",
                "files": [
                    {
                        "delivery": "multimodal",
                        "type": "image",
                        "filename": "earth.png",
                        "mime_type": "image/png",
                        "format": "png",
                        "url": "https://files.example.com/earth.png?sign=secret",
                        "detail": "high",
                    }
                ],
            }
        )
    )

    prompts = layer.user_prompts

    assert prompts[0] == "What is in this image?"
    assert isinstance(prompts[1], ImageUrl)
    assert prompts[1].url == "https://files.example.com/earth.png?sign=secret"
    assert prompts[1].media_type == "image/png"
    assert prompts[1].vendor_metadata == {"filename": "earth.png", "detail": "high"}


def test_user_prompt_layer_restores_inline_binary_content() -> None:
    payload = base64.b64encode(b"image-bytes").decode()
    layer = DifyUserPromptLayer.from_config(
        DifyUserPromptLayerConfig.model_validate(
            {
                "text": "Describe it.",
                "files": [
                    {
                        "delivery": "multimodal",
                        "type": "image",
                        "filename": "inline.png",
                        "mime_type": "image/png",
                        "format": "png",
                        "base64_data": payload,
                    }
                ],
            }
        )
    )

    content = layer.user_prompts[1]

    assert isinstance(content, BinaryContent)
    assert content.data == b"image-bytes"
    assert content.media_type == "image/png"


@pytest.mark.parametrize(
    "file_payload",
    [
        {
            "delivery": "multimodal",
            "type": "image",
            "filename": "missing.png",
            "mime_type": "image/png",
            "format": "png",
        },
        {
            "delivery": "multimodal",
            "type": "image",
            "filename": "ambiguous.png",
            "mime_type": "image/png",
            "format": "png",
            "url": "https://files.example.com/ambiguous.png",
            "base64_data": "aW1hZ2U=",
        },
    ],
)
def test_user_prompt_file_requires_exactly_one_transport(file_payload: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="exactly one"):
        DifyUserPromptLayerConfig.model_validate({"text": "Describe it.", "files": [file_payload]})


def test_default_compositor_registers_user_prompt_layer() -> None:
    provider = next(provider for provider in create_default_layer_providers() if provider.type_id == "dify.user_prompt")

    layer = provider.create_layer({"text": "Describe it."})

    assert isinstance(layer, DifyUserPromptLayer)
