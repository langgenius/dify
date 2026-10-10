"""Agent configuration values needed to prepare and execute an Agent App turn."""

from dataclasses import dataclass
from typing import Literal, Protocol

from models.agent_config_entities import AgentSoulConfig


@dataclass(frozen=True)
class AgentAppConfiguration:
    agent_id: str
    version_id: str
    version_kind: Literal["snapshot", "draft", "build_draft"]
    soul: AgentSoulConfig
    home_snapshot_id: str | None


class AgentAppConfigurations(Protocol):
    def resolve(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str | None,
        debug: bool,
        draft_type: str | None,
        conversation_id: str | None,
        form_id: str | None = None,
    ) -> AgentAppConfiguration: ...

    def version(
        self,
        *,
        tenant_id: str,
        app_id: str,
        agent_id: str,
        version_id: str,
        version_kind: Literal["snapshot", "draft", "build_draft"],
        account_id: str | None,
    ) -> AgentAppConfiguration: ...
