from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.tool_dependencies import ToolDependencies
from core.tools.entities.tool_entities import ToolProviderType


class ToolDescription(BaseModel):
    """Immutable identifier for a tool (type + provider + name)."""

    model_config = ConfigDict(frozen=True)

    tool_type: ToolProviderType
    provider: str
    tool_name: str

    def tool_id(self) -> str:
        return f"{self.tool_type.value}:{self.provider}:{self.tool_name}"


class ToolInvocationRequest(BaseModel):
    """A request to invoke a specific tool with optional credential."""

    model_config = ConfigDict(frozen=True)

    tool_type: ToolProviderType
    provider: str
    tool_name: str
    credential_id: str | None = None

    @property
    def tool_description(self) -> ToolDescription:
        return ToolDescription(tool_type=self.tool_type, provider=self.provider, tool_name=self.tool_name)


class ToolAccessPolicy(BaseModel):
    """
    Determines whether a tool invocation is allowed based on ToolDependencies.

    Rules:
    1. Tool must be declared in dependencies or references.
    2. If references exist for the tool, credential_id must match one of them.
    3. If no references exist for the tool, credential_id must be None.
    """

    model_config = ConfigDict(frozen=True)

    allowed_tools: Mapping[str, ToolDescription] = Field(default_factory=dict)
    credentials_by_tool: Mapping[str, set[str]] = Field(default_factory=dict)

    @classmethod
    def from_dependencies(cls, deps: ToolDependencies | None) -> "ToolAccessPolicy":
        """Create a ToolAccessPolicy from ToolDependencies."""
        if deps is None or deps.is_empty():
            return cls()

        allowed_tools: dict[str, ToolDescription] = {}
        credentials_by_tool: dict[str, set[str]] = {}

        # Process dependencies - tools that can be used without specific credentials
        for dep in deps.dependencies:
            tool_desc = ToolDescription(tool_type=dep.type, provider=dep.provider, tool_name=dep.tool_name)
            tool_id = tool_desc.tool_id()
            allowed_tools[tool_id] = tool_desc

        # Process references - tools that may require specific credentials
        for ref in deps.references:
            tool_desc = ToolDescription(tool_type=ref.type, provider=ref.provider, tool_name=ref.tool_name)
            tool_id = tool_desc.tool_id()
            allowed_tools[tool_id] = tool_desc

            # If reference has a credential_id, add it to the allowed credentials for this tool
            if ref.credential_id is not None:
                if tool_id not in credentials_by_tool:
                    credentials_by_tool[tool_id] = set()
                credentials_by_tool[tool_id].add(ref.credential_id)

        return cls(allowed_tools=allowed_tools, credentials_by_tool=credentials_by_tool)

    def is_empty(self) -> bool:
        return len(self.allowed_tools) == 0

    def is_allowed(self, request: ToolInvocationRequest) -> bool:
        """Check if the tool invocation request is allowed."""

        # If the policy is empty, allow any invocation.
        if self.is_empty():
            return True

        tool_id = request.tool_description.tool_id()
        if tool_id not in self.allowed_tools:
            return False

        # No special credential required, use default credentials only
        if request.credential_id is None or request.credential_id == "":
            return self.credentials_by_tool.get(tool_id) is None
        # Special credential required, check if it is allowed
        else:
            return request.credential_id in self.credentials_by_tool.get(tool_id, set())
