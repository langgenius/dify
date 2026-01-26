from pydantic import BaseModel, ConfigDict, Field

from core.skill.entities.tool_dependencies import ToolDependencies
from core.tools.entities.tool_entities import ToolProviderType


class ToolKey(BaseModel):
    """Immutable identifier for a tool (type + provider + name)."""

    model_config = ConfigDict(frozen=True)

    tool_type: ToolProviderType
    provider: str
    tool_name: str


class ToolInvocationRequest(BaseModel):
    """A request to invoke a specific tool with optional credential."""

    model_config = ConfigDict(frozen=True)

    tool_type: ToolProviderType
    provider: str
    tool_name: str
    credential_id: str | None = None

    @property
    def key(self) -> ToolKey:
        return ToolKey(tool_type=self.tool_type, provider=self.provider, tool_name=self.tool_name)


class ToolAccessPolicy(BaseModel):
    """
    Determines whether a tool invocation is allowed based on ToolDependencies.

    Rules:
    1. Tool must be declared in dependencies or references.
    2. If references exist for the tool, credential_id must match one of them.
    3. If no references exist for the tool, credential_id must be None.
    """

    model_config = ConfigDict(frozen=True)

    allowed_tools: frozenset[ToolKey] = Field(default_factory=frozenset)
    credential_ids_by_tool: dict[ToolKey, frozenset[str | None]] = Field(default_factory=dict)

    @classmethod
    def from_dependencies(cls, deps: ToolDependencies | None) -> "ToolAccessPolicy":
        if deps is None or deps.is_empty():
            return cls()

        def to_key(t: ToolProviderType, p: str, n: str) -> ToolKey:
            return ToolKey(tool_type=t, provider=p, tool_name=n)

        tools: set[ToolKey] = set()
        tools.update(to_key(dep.type, dep.provider, dep.tool_name) for dep in deps.dependencies)
        tools.update(to_key(ref.type, ref.provider, ref.tool_name) for ref in deps.references)

        creds: dict[ToolKey, set[str | None]] = {}
        for ref in deps.references:
            key = to_key(ref.type, ref.provider, ref.tool_name)
            creds.setdefault(key, set()).add(ref.credential_id)

        return cls(
            allowed_tools=frozenset(tools),
            credential_ids_by_tool={k: frozenset(v) for k, v in creds.items()},
        )

    def is_empty(self) -> bool:
        return len(self.allowed_tools) == 0

    def is_allowed(self, request: ToolInvocationRequest) -> bool:
        """Check if the tool invocation request is allowed."""

        # If the policy is empty, allow any invocation.
        if self.is_empty():
            return True

        if request.key not in self.allowed_tools:
            return False

        allowed_credentials = self.credential_ids_by_tool.get(request.key)
        if not allowed_credentials:
            # No references for this tool: only allow invocation without credential.
            return request.credential_id is None

        return request.credential_id in allowed_credentials
