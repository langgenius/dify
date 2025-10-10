"""Simple file dispatcher tool for agents."""

from collections.abc import Generator, Sequence
from typing import TYPE_CHECKING, Any

from core.file import File
from core.plugin.entities.parameters import PluginParameterOption
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)

if TYPE_CHECKING:
    pass


class FileDispatcherTool(Tool):
    """Tool to dispatch files either to model or to other tools."""

    def __init__(
        self,
        files: Sequence[File],
        tool_file_map: dict[str, dict[str, File]] | None = None,
    ):
        """Initialize file dispatcher.

        Args:
            files: Available files
            tool_file_map: Shared map for tool files {tool_name: {param_name: file}}
        """
        self.files = files
        self.file_map = {f.filename: f for f in files}
        self.tool_file_map = tool_file_map or {}

        # Initialize entity and runtime
        self._entity = self._create_tool_entity()
        self._runtime = ToolRuntime(
            tenant_id="",  # Will be set by the node
            credentials={},
            runtime_parameters={},
        )

        # Call parent constructor
        super().__init__(entity=self._entity, runtime=self._runtime)

    def tool_provider_type(self) -> ToolProviderType:
        """Return tool provider type."""
        return ToolProviderType.BUILT_IN

    def _create_tool_entity(self) -> ToolEntity:
        """Return tool entity definition."""
        return ToolEntity(
            identity=ToolIdentity(
                name="dispatch_file",
                author="system",
                label=I18nObject(en_US="Dispatch File", zh_CN="分发文件"),
                provider="system",
            ),
            description=ToolDescription(
                llm="Dispatch a file either to yourself (for analysis) or to another tool's specific parameter. "
                "Use target='self' to load file content into your context. "
                "For other tools, use ONLY the tool name without any prefix "
                "(e.g., 'markdown_converter' not 'functions.markdown_converter').",
                human=I18nObject(en_US="Dispatch file", zh_CN="分发文件"),
            ),
            parameters=[
                ToolParameter(
                    name="file_id",
                    type=ToolParameter.ToolParameterType.SELECT,
                    required=True,
                    label=I18nObject(en_US="File", zh_CN="文件"),
                    human_description=I18nObject(en_US="Select a file", zh_CN="选择文件"),
                    llm_description="The ID of the file to dispatch",
                    form=ToolParameter.ToolParameterForm.LLM,
                    options=[
                        PluginParameterOption(
                            value=f.filename or "",
                            label=I18nObject(
                                en_US=f"{f.filename} ({f.type.value if f.type else 'unknown'}, {f.size or 0} bytes)"
                            ),
                        )
                        for f in self.files
                    ],
                ),
                ToolParameter(
                    name="target",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=True,
                    label=I18nObject(en_US="Target", zh_CN="目标"),
                    human_description=I18nObject(en_US="Target for the file", zh_CN="文件目标"),
                    llm_description=(
                        "Where to send the file. Use 'self' to analyze file content yourself, "
                        "or use the exact tool name only (e.g., 'image_analyzer', NOT 'functions.image_analyzer'). "
                        "Do not include 'functions.' prefix"
                    ),
                    form=ToolParameter.ToolParameterForm.LLM,
                ),
                ToolParameter(
                    name="parameter_name",
                    type=ToolParameter.ToolParameterType.STRING,
                    required=False,
                    label=I18nObject(en_US="Parameter Name", zh_CN="参数名称"),
                    human_description=I18nObject(en_US="Parameter name for tool", zh_CN="工具参数名"),
                    llm_description=(
                        "When target is a tool, specify which parameter accepts files "
                        "(check the system prompt for available tools and their file parameters). "
                        "Skip this for target='self'"
                    ),
                    form=ToolParameter.ToolParameterForm.LLM,
                    default="file",
                ),
            ],
        )

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """Dispatch file based on target."""
        file_id = tool_parameters.get("file_id")
        target = tool_parameters.get("target")
        parameter_name = tool_parameters.get("parameter_name", "file")

        if not file_id:
            yield self.create_text_message("File ID is required")
            return

        file = self.file_map.get(file_id)
        if not file:
            yield self.create_text_message(f"File with ID '{file_id}' not found")
            return

        if not target:
            yield self.create_text_message("Target is required")
            return

        if target == "self":
            # Dispatch to model - return FILE message for pattern to handle
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.FILE,
                message=ToolInvokeMessage.FileMessage(),
                meta={"file": file, "target": "self"},
            )
        else:
            # Dispatch to tool
            tool_name = target.strip()
            param_name = parameter_name.strip()

            # Remove 'functions.' prefix if present
            if tool_name.startswith("functions."):
                tool_name = tool_name[10:]  # Remove 'functions.' prefix
                yield self.create_text_message(f"Note: Removed 'functions.' prefix. Using tool name: '{tool_name}'")

            if not tool_name:
                yield self.create_text_message("Tool name cannot be empty")
                return

            if not param_name:
                yield self.create_text_message("Parameter name cannot be empty")
                return

            # Store file in tool_file_map
            if tool_name not in self.tool_file_map:
                self.tool_file_map[tool_name] = {}
            self.tool_file_map[tool_name][param_name] = file

            # Return a FILE type message to indicate file dispatch
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.FILE,
                message=ToolInvokeMessage.FileMessage(),
                meta={"file": file, "target_tool": tool_name, "parameter_name": param_name},
            )
