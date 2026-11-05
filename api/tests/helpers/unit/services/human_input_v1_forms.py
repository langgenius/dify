"""Human Input v1 forms in the SQLite store, each reachable by one recipient's token."""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from core.workflow.nodes.human_input.entities import FormDefinition
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType


def persist_v1_form_token(session: Session, recipient_type: RecipientType) -> str:
    """The token of a new v1 form's only recipient, of `recipient_type`."""
    expiration_time = datetime(2099, 1, 1)
    definition = FormDefinition(form_content="Review", rendered_content="Review", expiration_time=expiration_time)
    form = HumanInputForm(
        tenant_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        node_id="n1",
        form_definition=definition.model_dump_json(),
        rendered_content="Review",
        expiration_time=expiration_time,
    )
    session.add(form)
    session.flush()
    token = f"v1-{recipient_type.value}-{uuid.uuid4().hex}"
    session.add(
        HumanInputFormRecipient(
            form_id=form.id,
            delivery_id=str(uuid.uuid4()),
            recipient_type=recipient_type,
            recipient_payload="{}",
            access_token=token,
        )
    )
    session.commit()
    return token
