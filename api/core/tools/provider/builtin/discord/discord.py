from typing import Any

from core.tools.provider.builtin.discord.tools.discord_webhook import DiscordWebhookTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DiscordProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        DiscordWebhookTool()
