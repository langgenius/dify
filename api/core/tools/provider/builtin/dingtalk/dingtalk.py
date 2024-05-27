from core.tools.entities.values import ToolLabelEnum
from core.tools.provider.builtin.dingtalk.tools.dingtalk_group_bot import DingTalkGroupBotTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DingTalkProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        DingTalkGroupBotTool()
        pass

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SOCIAL
        ]