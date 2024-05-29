from core.tools.entities.values import ToolLabelEnum
from core.tools.provider.builtin.feishu.tools.feishu_group_bot import FeishuGroupBotTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class FeishuProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        FeishuGroupBotTool()
        pass

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SOCIAL
        ]