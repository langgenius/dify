from core.tools.entities.values import ToolLabelEnum
from core.tools.provider.builtin.wecom.tools.wecom_group_bot import WecomGroupBotTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class WecomProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        WecomGroupBotTool()
        pass

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SOCIAL
        ]