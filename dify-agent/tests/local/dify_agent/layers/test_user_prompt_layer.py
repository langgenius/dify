from __future__ import annotations

from typing import cast

from pydantic_ai.messages import BinaryContent

from dify_agent.layers.user_prompt.configs import DIFY_USER_PROMPT_LAYER_TYPE_ID, DifyUserPromptLayerConfig
from dify_agent.layers.user_prompt.layer import DifyUserPromptLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


def test_user_prompt_layer_restores_text_only_prompt() -> None:
    layer = DifyUserPromptLayer.from_config(DifyUserPromptLayerConfig(text="hello"))

    assert layer.type_id == DIFY_USER_PROMPT_LAYER_TYPE_ID
    assert layer.user_prompts == ["hello"]


def test_user_prompt_layer_restores_binary_file_prompt() -> None:
    layer = DifyUserPromptLayer.from_config(
        DifyUserPromptLayerConfig.model_validate(
            {
                "text": "what is in this image?",
                "files": [
                    {
                        "filename": "red.png",
                        "mime_type": "image/png",
                        "format": "png",
                        "type": "image",
                        "base64_data": "cmVk",
                        "detail": "high",
                    }
                ],
            }
        )
    )

    prompts = layer.user_prompts

    assert len(prompts) == 2
    file_part = prompts[0]
    assert isinstance(file_part, BinaryContent)
    assert file_part.data == b"red"
    assert file_part.media_type == "image/png"
    assert file_part.vendor_metadata == {"filename": "red.png", "detail": "high"}
    assert prompts[1] == "what is in this image?"


def test_default_layer_providers_register_user_prompt_layer() -> None:
    provider = next(
        provider for provider in create_default_layer_providers() if provider.type_id == DIFY_USER_PROMPT_LAYER_TYPE_ID
    )

    layer = cast(DifyUserPromptLayer, provider.create_layer({"text": "hello"}))

    assert isinstance(layer, DifyUserPromptLayer)
