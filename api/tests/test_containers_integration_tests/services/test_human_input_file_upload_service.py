import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import services.human_input_file_upload_service as service_module
from extensions.ext_database import db
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from libs.datetime_utils import naive_utc_now
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadToken,
    StandaloneWebAppRecipientPayload,
)
from services.human_input_file_upload_service import HITL_UPLOAD_TOKEN_PREFIX, HumanInputFileUploadService


def _create_waiting_form_recipient(
    db_session_with_containers: Session,
) -> tuple[str, str, datetime]:
    form_id = "00000000-0000-0000-0000-000000000101"
    recipient_id = "00000000-0000-0000-0000-000000000102"
    expiration_time = naive_utc_now() + timedelta(hours=1)

    db_session_with_containers.add(
        HumanInputForm(
            id=form_id,
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            workflow_run_id=None,
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            node_id="human-node",
            form_definition="{}",
            rendered_content="content",
            expiration_time=expiration_time,
        )
    )
    db_session_with_containers.add(
        HumanInputFormRecipient(
            id=recipient_id,
            form_id=form_id,
            delivery_id=str(uuid.uuid4()),
            recipient_type=StandaloneWebAppRecipientPayload().TYPE,
            recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
            access_token="form-token-1",
        )
    )
    db_session_with_containers.commit()
    return form_id, recipient_id, expiration_time


def test_issue_upload_token_returns_expiration_with_default_session_expiry(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    form_id, recipient_id, expiration_time = _create_waiting_form_recipient(db_session_with_containers)
    monkeypatch.setattr(service_module.secrets, "token_urlsafe", lambda _bytes: "random-value")

    service = HumanInputFileUploadService(
        session_factory=sessionmaker(bind=db.engine),
        workflow_run_repository=MagicMock(),
    )

    token = service.issue_upload_token("form-token-1")

    assert token.upload_token == f"{HITL_UPLOAD_TOKEN_PREFIX}random-value"
    assert token.expires_at == expiration_time

    db_session_with_containers.expire_all()
    token_model = db_session_with_containers.scalar(select(HumanInputFormUploadToken))
    assert token_model is not None
    assert token_model.form_id == form_id
    assert token_model.recipient_id == recipient_id
    assert token_model.token == token.upload_token
