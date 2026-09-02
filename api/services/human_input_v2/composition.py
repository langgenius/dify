"""Production composition for shared Human Input v2 services."""

from __future__ import annotations

from core.db.session_factory import session_factory

from .node_data_migration import HumanInputNodeDataMigrationService
from .workspace_member_email_lookup import SQLAlchemyWorkspaceMemberEmailLookup


def build_human_input_node_data_migration_service() -> HumanInputNodeDataMigrationService:
    """Compose the read-only migration service for one Console request."""

    return HumanInputNodeDataMigrationService(
        member_email_lookup=SQLAlchemyWorkspaceMemberEmailLookup(session_factory.create_session),
    )


__all__ = ["build_human_input_node_data_migration_service"]
