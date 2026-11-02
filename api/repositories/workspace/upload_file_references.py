"""Account and workspace references to shared upload files."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account
from models.account import Tenant
from repositories.file.reference_queries import candidate_batches, payload_reference_predicate
from services.entities.upload_file import UploadFileReferenceCandidate
from services.file_reference_parser import referenced_candidate_ids


def get_referenced_upload_file_ids(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
) -> set[str]:
    """Return candidates retained by account avatars and workspace config."""

    referenced: set[str] = set()
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            avatar
            for avatar in session.scalars(
                select(Account.avatar).where(Account.avatar.in_(batch_ids)).with_for_update(read=True, nowait=True)
            )
            if avatar is not None
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue
        rows = session.scalars(
            select(Tenant.custom_config)
            .where(
                Tenant.id == tenant_id,
                payload_reference_predicate((Tenant.custom_config,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        )
        referenced.update(referenced_candidate_ids(rows, remaining))
    return referenced
