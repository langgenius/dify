from core.tools.entities.values import ToolLabelEnum
from core.tools.provider.builtin.slack.tools.slack_webhook import SlackWebhookTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SlackProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        SlackWebhookTool()
        pass

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SOCIAL
        ]