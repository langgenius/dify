from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import BinaryContent, ImageUrl

from dify_agent.layers.user_prompt import DifyUserPromptLayerConfig
from dify_agent.layers.user_prompt.layer import DifyUserPromptLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


def test_user_prompt_layer_restores_image_url_content() -> None:
    layer = DifyUserPromptLayer.from_config(
        DifyUserPromptLayerConfig.model_validate(
            {
                "text": "What is in this image?",
                "files": [
                    {
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
            "type": "image",
            "filename": "missing.png",
            "mime_type": "image/png",
            "format": "png",
        },
        {
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
