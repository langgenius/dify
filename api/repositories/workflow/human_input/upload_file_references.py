"""Human-input-owned references to shared upload files."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import HumanInputFormUploadFile
from models.human_input import HumanInputForm
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
    """Return candidates retained by human-input forms and submissions."""

    referenced: set[str] = set()
    for batch in candidate_batches(candidates):
        batch_ids = tuple(candidate.id for candidate in batch)
        referenced.update(
            session.scalars(
                select(HumanInputFormUploadFile.upload_file_id)
                .where(
                    HumanInputFormUploadFile.tenant_id == tenant_id,
                    HumanInputFormUploadFile.upload_file_id.in_(batch_ids),
                )
                .with_for_update(read=True, nowait=True)
            )
        )
        remaining = tuple(candidate for candidate in batch if candidate.id not in referenced)
        if not remaining:
            continue

        form_columns = (
            HumanInputForm.form_definition,
            HumanInputForm.submitted_data,
            HumanInputForm.rendered_content,
        )
        rows = session.execute(
            select(*form_columns)
            .where(
                HumanInputForm.tenant_id == tenant_id,
                payload_reference_predicate(form_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in rows for payload in row), remaining))
    return referenced
