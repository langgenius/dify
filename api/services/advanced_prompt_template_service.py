# Canonical implementation has moved to services.studio.advanced_prompt_template_service
# This barrel is kept for backwards compatibility.
from services.studio.advanced_prompt_template_service import AdvancedPromptTemplateArgs, AdvancedPromptTemplateService, get_prompt, get_common_prompt, get_completion_prompt, get_chat_prompt, get_baichuan_prompt

__all__ = ["AdvancedPromptTemplateArgs",
    "AdvancedPromptTemplateService",
    "get_prompt",
    "get_common_prompt",
    "get_completion_prompt",
    "get_chat_prompt",
    "get_baichuan_prompt"]
