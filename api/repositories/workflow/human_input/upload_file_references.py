"""Human-input-owned references to shared upload files."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import HumanInputFormUploadFile
from models.human_input import HumanInputForm as LegacyHumanInputForm
from models.human_input_v2 import (
    HumanInputExternalContactProfile,
    HumanInputForm,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMSyncResult,
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

        legacy_form_columns = (
            LegacyHumanInputForm.form_definition,
            LegacyHumanInputForm.submitted_data,
            LegacyHumanInputForm.rendered_content,
        )
        rows = session.execute(
            select(*legacy_form_columns)
            .where(
                LegacyHumanInputForm.tenant_id == tenant_id,
                payload_reference_predicate(legacy_form_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in rows for payload in row), remaining))

        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue
        remaining_ids = tuple(candidate.id for candidate in remaining)

        referenced.update(
            file_id
            for file_id in session.scalars(
                select(HumanInputExternalContactProfile.avatar_file_id)
                .where(
                    HumanInputExternalContactProfile.tenant_id == tenant_id,
                    HumanInputExternalContactProfile.avatar_file_id.in_(remaining_ids),
                )
                .order_by(HumanInputExternalContactProfile.avatar_file_id)
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )
        workspace_owner_key = f"workspace:{tenant_id}"
        referenced.update(
            file_id
            for file_id in session.scalars(
                select(HumanInputIMIdentity.avatar_file_id)
                .join(HumanInputIMChannel, HumanInputIMChannel.id == HumanInputIMIdentity.channel_id)
                .where(
                    HumanInputIMChannel.owner_key == workspace_owner_key,
                    HumanInputIMIdentity.avatar_file_id.in_(remaining_ids),
                )
                .order_by(HumanInputIMIdentity.avatar_file_id)
                .with_for_update(read=True, nowait=True)
            )
            if file_id is not None
        )

        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue
        v2_form_columns = (
            sa.cast(HumanInputForm.resolved_form, sa.String),
            HumanInputForm.raw_submission_inputs,
            HumanInputForm.normalized_submission_data,
        )
        rows = session.execute(
            select(*v2_form_columns)
            .where(
                HumanInputForm.tenant_id == tenant_id,
                payload_reference_predicate(v2_form_columns, remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids((payload for row in rows for payload in row), remaining))

        remaining = tuple(candidate for candidate in remaining if candidate.id not in referenced)
        if not remaining:
            continue
        contact_snapshot = sa.cast(HumanInputIMSyncResult.contact_snapshot, sa.String)
        rows = session.scalars(
            select(contact_snapshot)
            .join(HumanInputIMChannel, HumanInputIMChannel.id == HumanInputIMSyncResult.channel_id)
            .where(
                HumanInputIMChannel.owner_key == workspace_owner_key,
                payload_reference_predicate((contact_snapshot,), remaining),
            )
            .with_for_update(read=True, nowait=True)
        ).all()
        referenced.update(referenced_candidate_ids(rows, remaining))
    return referenced
