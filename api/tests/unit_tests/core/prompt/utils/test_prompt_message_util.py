from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from graphon.model_runtime.entities import (
    AudioPromptMessageContent,
    ImagePromptMessageContent,
    UserPromptMessage,
)


def test_short_image_url_is_preserved_when_saving_prompt():
    # `data` is a property that returns `url` when set. A short url makes the
    # saved `data` short enough that the old `data[:10] + mark + data[-10:]`
    # truncation would have duplicated it (e.g. "abc" -> "abc...[TRUNCATED]...abc").
    prompt = UserPromptMessage(
        content=[
            ImagePromptMessageContent(
                url="abc",
                format="jpg",
                mime_type="image/jpeg",
                detail=ImagePromptMessageContent.DETAIL.LOW,
            )
        ]
    )

    saved = PromptMessageUtil.prompt_messages_to_prompt_for_saving(ModelMode.CHAT, [prompt])

    assert saved[0]["files"][0]["data"] == "abc"


def test_short_audio_url_is_preserved_when_saving_prompt():
    prompt = UserPromptMessage(
        content=[
            AudioPromptMessageContent(
                url="abc",
                format="mp3",
                mime_type="audio/mpeg",
            )
        ]
    )

    saved = PromptMessageUtil.prompt_messages_to_prompt_for_saving(ModelMode.CHAT, [prompt])

    assert saved[0]["files"][0]["data"] == "abc"


def test_long_media_data_is_still_truncated_when_saving_prompt():
    long_url = "https://example.com/image.jpg"
    prompt = UserPromptMessage(
        content=[
            ImagePromptMessageContent(
                url=long_url,
                format="jpg",
                mime_type="image/jpeg",
                detail=ImagePromptMessageContent.DETAIL.LOW,
            )
        ]
    )

    saved = PromptMessageUtil.prompt_messages_to_prompt_for_saving(ModelMode.CHAT, [prompt])

    truncated = saved[0]["files"][0]["data"]
    assert "...[TRUNCATED]..." in truncated
    assert truncated == long_url[:10] + "...[TRUNCATED]..." + long_url[-10:]
