import pytest

from controllers.console.app.advanced_prompt_template import AdvancedPromptTemplateResponse
from core.prompt.prompt_templates.advanced_prompt_templates import (
    CHAT_APP_CHAT_PROMPT_CONFIG,
    CHAT_APP_COMPLETION_PROMPT_CONFIG,
    COMPLETION_APP_CHAT_PROMPT_CONFIG,
    COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
)


@pytest.mark.parametrize(
    "template",
    [
        CHAT_APP_CHAT_PROMPT_CONFIG,
        CHAT_APP_COMPLETION_PROMPT_CONFIG,
        COMPLETION_APP_CHAT_PROMPT_CONFIG,
        COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    ],
)
def test_prompt_templates_keep_their_shape(template: dict[str, object]) -> None:
    dumped = AdvancedPromptTemplateResponse.model_validate(template).model_dump(mode="json", exclude_unset=True)

    assert dumped == template


def test_completion_templates_keep_their_stop_words() -> None:
    dumped = AdvancedPromptTemplateResponse.model_validate(CHAT_APP_COMPLETION_PROMPT_CONFIG).model_dump(
        mode="json", exclude_unset=True
    )

    assert dumped["stop"] == ["Human:"]
