from datetime import timedelta
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from graphon.variables.segments import ObjectSegment
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputExternalContactProfile
from repositories.human_input_v2.form_repository import FormCreateParams
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.workflow.human_input.upload_file_references import get_referenced_upload_file_ids
from services.entities.upload_file import UploadFileReferenceCandidate


def _candidate(file_id: str, tenant_id: str) -> UploadFileReferenceCandidate:
    return UploadFileReferenceCandidate(id=file_id, key=f"upload_files/{tenant_id}/{file_id}.txt")


def test_v2_forms_and_contact_avatars_retain_only_tenant_owned_candidates(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    other_tenant_id = str(uuid4())
    app_id = str(uuid4())
    resolved_file_id = str(uuid4())
    raw_file_id = str(uuid4())
    normalized_file_id = str(uuid4())
    avatar_file_id = str(uuid4())
    foreign_avatar_file_id = str(uuid4())
    now = naive_utc_now()

    form = SQLAlchemyFormRepository(sqlite_session, TenantId(tenant_id), app_id).create_form(
        FormCreateParams(
            workflow_run_id=None,
            node_execution_id=None,
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            resolved_form=ResolvedForm(
                title="Approval",
                parts=(),
                actions=(),
                legacy_form_content=f"![attachment](/files/{resolved_file_id}/image-preview)",
            ),
            expiration_time=now + timedelta(hours=1),
            global_timeout_deadline=now + timedelta(hours=2),
        )
    )
    SQLAlchemyFormRepository(sqlite_session, TenantId(tenant_id), app_id).submit_form(
        form.id,
        submitted_by_recipient_id=RecipientId(str(uuid4())),
        submitted_by_delivery_id=str(uuid4()),
        selected_action_id="approve",
        raw_submission_inputs={"attachment": {"upload_file_id": raw_file_id}},
        normalized_submission_data={"attachment": ObjectSegment(value={"upload_file_id": normalized_file_id})},
    )
    sqlite_session.execute(
        sa.insert(HumanInputExternalContactProfile),
        [
            {
                "contact_id": str(uuid4()),
                "tenant_id": tenant_id,
                "name": "Approver",
                "normalized_name": "approver",
                "email": "approver@example.com",
                "normalized_email": "approver@example.com",
                "avatar_file_id": avatar_file_id,
            },
            {
                "contact_id": str(uuid4()),
                "tenant_id": other_tenant_id,
                "name": "Foreign",
                "normalized_name": "foreign",
                "email": "foreign@example.com",
                "normalized_email": "foreign@example.com",
                "avatar_file_id": foreign_avatar_file_id,
            },
        ],
    )
    sqlite_session.flush()

    candidates = tuple(
        _candidate(file_id, tenant_id)
        for file_id in (
            resolved_file_id,
            raw_file_id,
            normalized_file_id,
            avatar_file_id,
            foreign_avatar_file_id,
        )
    )

    referenced = get_referenced_upload_file_ids(sqlite_session, tenant_id=tenant_id, candidates=candidates)

    assert referenced == {resolved_file_id, raw_file_id, normalized_file_id, avatar_file_id}
