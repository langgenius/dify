"""Agent-owned references to shared upload files."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigSnapshot,
    AgentIconType,
    AgentWorkspaceBinding,
    WorkflowAgentNodeBinding,
)
from repositories.file.reference_queries import (
    candidate_batches,
    payload_reference_predicate,
)
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by agent configuration and session state."""

    referenced: set[str] = set()
    payload_owners = (
        (AgentConfigDraft, AgentConfigDraft.config_snapshot),
        (AgentConfigSnapshot, AgentConfigSnapshot.config_snapshot),
        (AgentWorkspaceBinding, AgentWorkspaceBinding.session_snapshot),
        (WorkflowAgentNodeBinding, WorkflowAgentNodeBinding.node_job_config),
    )
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(Agent.icon)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.icon_type == AgentIconType.IMAGE,
                    Agent.icon.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        for model, column in payload_owners:
            if not remaining:
                break
            rows = session.scalars(
                select(column)
                .where(
                    model.tenant_id == tenant_id,
                    payload_reference_predicate((column,), remaining),
                )
                .with_for_update(read=True, nowait=True)
            )
            referenced.update(referenced_candidate_ids(rows, remaining))
            remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
    return referenced
