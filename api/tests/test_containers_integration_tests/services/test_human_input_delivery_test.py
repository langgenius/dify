import json
import uuid
from io import BytesIO
from unittest.mock import MagicMock

import httpx
import pytest
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

import controllers.web.human_input_file_upload as human_input_file_upload_module
from core.workflow.human_input import FileInputConfig, HumanInputFormKind, HumanInputNodeData
from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
)
from graphon.enums import BuiltinNodeTypes
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input import HumanInputForm, HumanInputFormRecipient, HumanInputFormUploadFile
from models.model import App, AppMode, UploadFile
from models.workflow import Workflow, WorkflowType
from services.workflow_service import WorkflowService


def _create_app_with_draft_workflow(
    session: Session,
    *,
    delivery_method_id: uuid.UUID,
    include_file_input: bool = False,
) -> tuple[App, Account]:
    tenant = Tenant(name="Test Tenant")
    account = Account(name="Tester", email="tester@example.com")
    session.add_all([tenant, account])
    session.flush()

    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.OWNER.value,
        )
    )

    app = App(
        tenant_id=tenant.id,
        name="Test App",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type="emoji",
        icon="app",
        icon_background="#ffffff",
        enable_site=True,
        enable_api=True,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()

    email_method = EmailDeliveryMethod(
        id=delivery_method_id,
        enabled=True,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                include_bound_group=False,
                items=[ExternalRecipient(email="recipient@example.com")],
            ),
            subject="Test {{recipient_email}}",
            body="Body {{#url#}} {{form_content}}",
        ),
    )
    node_data = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[email_method],
        form_content="Hello Human Input",
        inputs=[FileInputConfig(output_variable_name="attachment")] if include_file_input else [],
        user_actions=[],
    ).model_dump(mode="json")
    node_data["type"] = BuiltinNodeTypes.HUMAN_INPUT
    graph = json.dumps({"nodes": [{"id": "human-node", "data": node_data}], "edges": []})

    workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version=Workflow.VERSION_DRAFT,
        graph=graph,
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add(workflow)
    session.commit()

    return app, account


def test_human_input_delivery_test_sends_email(
    db_session_with_containers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivery_method_id = uuid.uuid4()
    app, account = _create_app_with_draft_workflow(db_session_with_containers, delivery_method_id=delivery_method_id)

    send_mock = MagicMock()
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.is_inited", lambda: True)
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.send", send_mock)

    service = WorkflowService()
    service.test_human_input_delivery(
        app_model=app,
        account=account,
        node_id="human-node",
        delivery_method_id=str(delivery_method_id),
    )

    assert send_mock.call_count == 1
    assert send_mock.call_args.kwargs["to"] == "recipient@example.com"


def test_human_input_delivery_test_form_accepts_file_upload(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivery_method_id = uuid.uuid4()
    app, account = _create_app_with_draft_workflow(
        db_session_with_containers,
        delivery_method_id=delivery_method_id,
        include_file_input=True,
    )

    monkeypatch.setattr("services.human_input_delivery_test_service.mail.is_inited", lambda: True)
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.send", MagicMock())

    WorkflowService().test_human_input_delivery(
        app_model=app,
        account=account,
        node_id="human-node",
        delivery_method_id=str(delivery_method_id),
    )

    form = db_session_with_containers.scalar(
        select(HumanInputForm)
        .where(
            HumanInputForm.app_id == app.id,
            HumanInputForm.form_kind == HumanInputFormKind.DELIVERY_TEST,
            HumanInputForm.workflow_run_id.is_(None),
        )
        .limit(1)
    )
    assert form is not None
    recipient = db_session_with_containers.scalar(
        select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form.id).limit(1)
    )
    assert recipient is not None
    assert recipient.access_token is not None

    token_response = test_client_with_containers.post(f"/api/form/human_input/{recipient.access_token}/upload-token")
    assert token_response.status_code == 200
    upload_token = token_response.get_json()["upload_token"]

    upload_response = test_client_with_containers.post(
        "/api/human-input-forms/files",
        data={"file": (BytesIO(b"delivery test content"), "evidence.txt")},
        content_type="multipart/form-data",
        headers={"Authorization": f"Bearer {upload_token}"},
    )

    assert upload_response.status_code == 201, upload_response.get_data(as_text=True)
    upload_file_id = upload_response.get_json()["id"]

    db_session_with_containers.expire_all()
    upload_file = db_session_with_containers.get(UploadFile, upload_file_id)
    assert upload_file is not None
    assert upload_file.tenant_id == app.tenant_id
    assert upload_file.created_by == account.id
    link = db_session_with_containers.scalar(
        select(HumanInputFormUploadFile)
        .where(
            HumanInputFormUploadFile.form_id == form.id,
            HumanInputFormUploadFile.upload_file_id == upload_file_id,
        )
        .limit(1)
    )
    assert link is not None


def test_human_input_delivery_test_form_accepts_remote_file_upload(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivery_method_id = uuid.uuid4()
    app, account = _create_app_with_draft_workflow(
        db_session_with_containers,
        delivery_method_id=delivery_method_id,
        include_file_input=True,
    )

    monkeypatch.setattr("services.human_input_delivery_test_service.mail.is_inited", lambda: True)
    monkeypatch.setattr("services.human_input_delivery_test_service.mail.send", MagicMock())

    WorkflowService().test_human_input_delivery(
        app_model=app,
        account=account,
        node_id="human-node",
        delivery_method_id=str(delivery_method_id),
    )

    form = db_session_with_containers.scalar(
        select(HumanInputForm)
        .where(
            HumanInputForm.app_id == app.id,
            HumanInputForm.form_kind == HumanInputFormKind.DELIVERY_TEST,
            HumanInputForm.workflow_run_id.is_(None),
        )
        .limit(1)
    )
    assert form is not None
    recipient = db_session_with_containers.scalar(
        select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form.id).limit(1)
    )
    assert recipient is not None
    assert recipient.access_token is not None

    token_response = test_client_with_containers.post(f"/api/form/human_input/{recipient.access_token}/upload-token")
    assert token_response.status_code == 200
    upload_token = token_response.get_json()["upload_token"]

    remote_url = "https://example.com/evidence.txt"
    remote_content = b"delivery test remote content"
    head_response = httpx.Response(
        200,
        request=httpx.Request("HEAD", remote_url),
        headers={
            "Content-Length": str(len(remote_content)),
            "Content-Type": "text/plain",
        },
    )
    get_response = httpx.Response(
        200,
        request=httpx.Request("GET", remote_url),
        headers={
            "Content-Length": str(len(remote_content)),
            "Content-Type": "text/plain",
        },
        content=remote_content,
    )
    head_mock = MagicMock(return_value=head_response)
    get_mock = MagicMock(return_value=get_response)
    monkeypatch.setattr(human_input_file_upload_module.ssrf_proxy, "head", head_mock)
    monkeypatch.setattr(human_input_file_upload_module.ssrf_proxy, "get", get_mock)

    upload_response = test_client_with_containers.post(
        "/api/human-input-forms/files",
        data={"url": remote_url},
        content_type="multipart/form-data",
        headers={"Authorization": f"Bearer {upload_token}"},
    )

    assert upload_response.status_code == 201, upload_response.get_data(as_text=True)
    upload_file_id = upload_response.get_json()["id"]
    assert upload_response.get_json()["url"]
    head_mock.assert_called_once_with(url=remote_url)
    get_mock.assert_called_once_with(remote_url)

    db_session_with_containers.expire_all()
    upload_file = db_session_with_containers.get(UploadFile, upload_file_id)
    assert upload_file is not None
    assert upload_file.tenant_id == app.tenant_id
    assert upload_file.created_by == account.id
    assert upload_file.source_url == remote_url
    link = db_session_with_containers.scalar(
        select(HumanInputFormUploadFile)
        .where(
            HumanInputFormUploadFile.form_id == form.id,
            HumanInputFormUploadFile.upload_file_id == upload_file_id,
        )
        .limit(1)
    )
    assert link is not None
