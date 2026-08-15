from datetime import timedelta

from sqlalchemy.orm import Session

from core.workflow.human_input_adapter import DeliveryMethodType
from libs.datetime_utils import naive_utc_now
from models.base import Base, TypeBase
from models.execution_extra_content import ExecutionContentType, ExecutionExtraContent, HumanInputContent
from models.human_input import (
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    RecipientType,
)


def test_human_input_models_use_typebase_registry_and_generate_defaults() -> None:
    models = (
        HumanInputForm,
        HumanInputDelivery,
        HumanInputFormRecipient,
        HumanInputFormUploadToken,
        HumanInputFormUploadFile,
        ExecutionExtraContent,
        HumanInputContent,
    )

    assert all(model.__mapper__.registry is TypeBase.registry for model in models)
    assert all(model.__mapper__.registry is not Base.registry for model in models)

    recipient = HumanInputFormRecipient(
        form_id="form-1",
        delivery_id="delivery-1",
        recipient_type=RecipientType.CONSOLE,
        recipient_payload="{}",
    )
    another_recipient = HumanInputFormRecipient(
        form_id="form-1",
        delivery_id="delivery-1",
        recipient_type=RecipientType.CONSOLE,
        recipient_payload="{}",
    )
    upload_token = HumanInputFormUploadToken(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        recipient_id=recipient.id,
        token="upload-token",
    )
    upload_file = HumanInputFormUploadFile(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        upload_file_id="file-1",
        upload_token_id=upload_token.id,
    )

    assert recipient.id != another_recipient.id
    assert recipient.access_token != another_recipient.access_token
    assert upload_token.id
    assert upload_file.id


def test_human_input_content_polymorphism_persists_in_sqlite(sqlite_session: Session) -> None:
    form = HumanInputForm(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        form_definition="{}",
        rendered_content="content",
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    content = HumanInputContent.new(workflow_run_id="run-1", form_id=form.id, message_id=None)
    delivery = HumanInputDelivery(
        form_id=form.id,
        delivery_method_type=DeliveryMethodType.WEBAPP,
        channel_payload="{}",
    )
    sqlite_session.add_all((form, content, delivery))
    sqlite_session.commit()

    loaded = sqlite_session.get(ExecutionExtraContent, content.id)

    assert isinstance(loaded, HumanInputContent)
    assert loaded.type == ExecutionContentType.HUMAN_INPUT
    assert loaded.form_id == form.id
