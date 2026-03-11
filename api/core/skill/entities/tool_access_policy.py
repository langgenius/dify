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


class ToolAccessDescription(BaseModel):
    """
    Per-tool access descriptor that bundles identity with allowed credentials.

    Each allowed tool is represented by exactly one ``ToolAccessDescription``.
    ``allowed_credentials`` captures the set of credential IDs that may be used
    when invoking this tool:

    * **empty set** – the tool requires no special credential; only requests
      *without* a ``credential_id`` are accepted.
    * **non-empty set** – the tool requires an explicit credential; the
      request's ``credential_id`` must be a member of this set.
    """

    model_config = ConfigDict(frozen=True)

    tool_type: ToolProviderType
    provider: str
    tool_name: str
    allowed_credentials: frozenset[str] = Field(default_factory=frozenset)

    def tool_id(self) -> str:
        return f"{self.tool_type.value}:{self.provider}:{self.tool_name}"

    def is_credential_allowed(self, credential_id: str | None) -> bool:
        """Check whether *credential_id* satisfies this tool's credential policy.

        * No credentials registered (``allowed_credentials`` is empty) →
          only requests *without* a credential are accepted.
        * Credentials registered → the supplied ``credential_id`` must be in
          the set.
        """
        if credential_id is None or credential_id == "":
            return True

        return credential_id in self.allowed_credentials


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

    The policy is built exclusively from ``ToolDependencies.references`` – each
    ``ToolReference`` declares both the tool identity *and* the credential that
    may be used.  ``ToolDependencies.dependencies`` is a de-duplicated identity
    list and does not participate in access-control decisions.

    Rules:
    1. The tool must appear in at least one reference.
    2. If references for the tool carry credential IDs, the request must supply
       one of those exact IDs.
    3. If no reference for the tool carries a credential ID, the request must
       *not* supply one (use default/ambient credentials).
    """

    model_config = ConfigDict(frozen=True)

    access_map: Mapping[str, ToolAccessDescription] = Field(default_factory=dict)

    @classmethod
    def from_dependencies(cls, deps: ToolDependencies | None) -> "ToolAccessPolicy":
        """Build a policy from ``ToolDependencies``.

        Only ``deps.references`` are used.  Multiple references to the same
        tool are merged – their credential IDs are unioned into a single
        ``ToolAccessDescription.allowed_credentials`` set.
        """
        if deps is None or deps.is_empty():
            return cls()

        # Accumulate credential sets keyed by tool_id so that multiple
        # references to the same tool are merged correctly.
        credentials_by_tool: dict[str, set[str]] = {}
        first_seen: dict[str, tuple[ToolProviderType, str, str]] = {}

        for ref in deps.references:
            tool_id = f"{ref.type.value}:{ref.provider}:{ref.tool_name}"
            if tool_id not in first_seen:
                first_seen[tool_id] = (ref.type, ref.provider, ref.tool_name)
                credentials_by_tool[tool_id] = set()
            if ref.credential_id is not None:
                credentials_by_tool[tool_id].add(ref.credential_id)

        access_map: dict[str, ToolAccessDescription] = {}
        for tool_id, (tool_type, provider, tool_name) in first_seen.items():
            access_map[tool_id] = ToolAccessDescription(
                tool_type=tool_type,
                provider=provider,
                tool_name=tool_name,
                allowed_credentials=frozenset(credentials_by_tool[tool_id]),
            )

        return cls(access_map=access_map)

    def is_empty(self) -> bool:
        return len(self.access_map) == 0

    def is_allowed(self, request: ToolInvocationRequest) -> bool:
        """Check if the tool invocation request is allowed."""
        # An empty policy (no references declared) permits any invocation.
        if self.is_empty():
            return True

        tool_id = request.tool_description.tool_id()
        access_desc = self.access_map.get(tool_id)
        if access_desc is None:
            return False

        return access_desc.is_credential_allowed(request.credential_id)
