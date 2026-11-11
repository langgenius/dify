"""Application-owned references to shared upload files."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import App
from models.model import IconType, Site
from models.snippet import CustomizedSnippet
from models.tools import MCPToolProvider
from repositories.file.reference_queries import candidate_batches, payload_reference_predicate
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by app, tool, and snippet assets."""

    referenced: set[str] = set()
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(App.icon)
                .where(App.tenant_id == tenant_id, App.icon_type == IconType.IMAGE, App.icon.in_(batch_ids))
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(Site.icon)
                .join(App, App.id == Site.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    Site.icon_type == IconType.IMAGE,
                    Site.icon.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(MCPToolProvider.icon)
                .where(MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.icon.in_(batch_ids))
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue
        rows = session.scalars(
            select(CustomizedSnippet.icon_info)
            .where(
                CustomizedSnippet.tenant_id == tenant_id,
                payload_reference_predicate((CustomizedSnippet.icon_info,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        )
        referenced.update(referenced_candidate_ids(rows, remaining))
    return referenced
