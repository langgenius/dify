from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from services.credentials.query import (
    CredentialQuery,
    DatasourceCredentialListItem,
    ModelCredentialRecord,
    ToolCredentialMetadata,
    ToolCredentialRecord,
    TriggerSubscriptionRecord,
)


@dataclass(frozen=True)
class DatasourceCredentialLookup:
    workspace_id: str
    provider: str
    plugin_id: str
    actor_id: str | None


@dataclass
class DatasourceCredentialQuery(CredentialQuery):
    """Answers datasource credential lookups from a fixed list and records each lookup."""

    credentials: Sequence[DatasourceCredentialListItem] = ()
    lookups: list[DatasourceCredentialLookup] = field(default_factory=list)

    def list_datasources(
        self, *, workspace_id: str, provider: str, plugin_id: str, actor_id: str | None
    ) -> Sequence[DatasourceCredentialListItem]:
        self.lookups.append(
            DatasourceCredentialLookup(
                workspace_id=workspace_id, provider=provider, plugin_id=plugin_id, actor_id=actor_id
            )
        )
        return self.credentials

    # Datasource credential tests never read the other credential kinds.
    def list_visible_tool_provider_ids(self, *, workspace_id: str, actor_id: str | None) -> set[str]:
        raise AssertionError(f"unexpected tool provider lookup: {workspace_id=} {actor_id=}")

    def resolve_tool_credential_metadata(
        self,
        *,
        workspace_id: str,
        provider: str,
        legacy_provider: str | None,
        actor_id: str | None,
        credential_id: str | None,
    ) -> ToolCredentialMetadata | None:
        raise AssertionError(
            "unexpected tool credential metadata lookup: "
            f"{workspace_id=} {provider=} {legacy_provider=} {actor_id=} {credential_id=}"
        )

    def list_models(self, *, workspace_id: str, provider: str, actor_id: str | None) -> Sequence[ModelCredentialRecord]:
        raise AssertionError(f"unexpected model credential lookup: {workspace_id=} {provider=} {actor_id=}")

    def list_tools(
        self,
        *,
        workspace_id: str,
        provider: str,
        actor_id: str | None,
        include_credential_ids: Sequence[str] = (),
    ) -> Sequence[ToolCredentialRecord]:
        raise AssertionError(
            f"unexpected tool credential lookup: {workspace_id=} {provider=} {actor_id=} {include_credential_ids=}"
        )

    def list_trigger_subscriptions(
        self, *, workspace_id: str, provider: str, actor_id: str | None
    ) -> Sequence[TriggerSubscriptionRecord]:
        raise AssertionError(f"unexpected trigger subscription lookup: {workspace_id=} {provider=} {actor_id=}")


@dataclass(frozen=True)
class CredentialServices:
    """The part of the application services registry that credential controllers read."""

    credential_queries: CredentialQuery
