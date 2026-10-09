"""Exercise human input through the real console runtime and injected SQLite store."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.human_input import build_human_input_debug_service
from factories.file_factory import builders
from graphon.variables import StringVariable
from models.human_input import HumanInputForm, HumanInputFormRecipient
from models.human_input_delivery import EmailDeliveryConfig, EmailDeliveryMethod, EmailRecipients, ExternalRecipient
from models.human_input_entities import (
    FileInputConfig,
    HumanInputNodeData,
    ParagraphInputConfig,
    UserActionConfig,
)
from models.workflow import Workflow, WorkflowDraftVariable
from repositories.human_input import form_repository
from services import human_input_delivery_test_service as delivery_module
from services import workflow_service as workflow_module
from services.entities.feature_entities import FeatureModel
from services.human_input.debug_service import HumanInputDebugService
from services.workflow.runtime_gateway import WorkflowRuntimeGateway
from tests.unit_tests.model_factories import make_upload_file
from tests.unit_tests.services.workflow.test_runtime_gateway import CONTEXT, RecordingSession, runtime_gateway  # noqa: F401


@pytest.fixture
def human_debug(
    runtime: tuple[WorkflowRuntimeGateway, list[RecordingSession]],
) -> tuple[HumanInputDebugService, list[RecordingSession]]:
    gateway, sessions = runtime
    return build_human_input_debug_service(database_client=gateway._sessions), sessions


def save_human_input_draft(factory: sessionmaker[Session], *, enabled: bool, debug: bool) -> str:
    method = EmailDeliveryMethod(
        id=uuid4(),
        enabled=enabled,
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                include_bound_group=False, items=[ExternalRecipient(email="recipient@example.com")]
            ),
            subject="Test {{recipient_email}}",
            body="{{form_content}} {{#url#}}",
            debug_mode=debug,
        ),
    )
    node = HumanInputNodeData(
        title="Human Input",
        delivery_methods=[method],
        form_content="{{#conversation.greeting#}} {{#upstream.output#}}",
        inputs=[ParagraphInputConfig(output_variable_name="answer")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    with factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == Workflow.VERSION_DRAFT))
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "human",
                        "data": {
                            **node.model_dump(mode="json"),
                            "type": "human-input",
                        },
                    }
                ],
                "edges": [],
            }
        )
        draft.conversation_variables = [StringVariable(name="greeting", value="Hello")]
    return str(method.id)


def forbid_global_database(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fail if any step falls back to a process-global database instead of the
    # injected factory, including form persistence and email member lookup.
    monkeypatch.setattr(workflow_module, "db", object())
    monkeypatch.setattr(delivery_module, "db", object())
    monkeypatch.setattr(form_repository, "session_factory", object())
    monkeypatch.setattr(builders, "session_factory", object())


def test_preview_and_submission_use_injected_database(
    human_debug: tuple[HumanInputDebugService, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, sessions = human_debug
    save_human_input_draft(sqlite_session_factory, enabled=True, debug=False)
    forbid_global_database(monkeypatch)
    preview = gateway.preview_form(CONTEXT, "app-1", "human", {"#upstream.output#": "world"})
    assert preview["form_content"] == "Hello world"
    assert sessions
    assert all(session.closed for session in sessions)
    outputs = gateway.submit_form(
        CONTEXT,
        "app-1",
        "human",
        inputs={"#upstream.output#": "world"},
        form_inputs={"answer": "yes"},
        action="approve",
    )
    assert outputs["answer"] == "yes"
    assert outputs["__action_value"] == "Approve"
    assert all(session.closed for session in sessions)
    with sqlite_session_factory() as session:
        variables = session.scalars(
            select(WorkflowDraftVariable).where(
                WorkflowDraftVariable.app_id == "app-1", WorkflowDraftVariable.node_id == "human"
            )
        ).all()
        assert {variable.name: variable.get_value().value for variable in variables}["answer"] == "yes"


@pytest.mark.parametrize("submit", [False, True])
def test_debug_secret_is_decrypted_after_repository_session_closes(
    human_debug: tuple[HumanInputDebugService, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    submit: bool,
) -> None:
    service, sessions = human_debug
    save_human_input_draft(sqlite_session_factory, enabled=True, debug=False)
    with sqlite_session_factory.begin() as session:
        draft = session.scalar(select(Workflow).where(Workflow.version == Workflow.VERSION_DRAFT))
        assert draft is not None
        graph = dict(draft.graph_dict)
        graph["nodes"][0]["data"]["form_content"] = "Token: {{#env.KEY#}}"
        draft.graph = json.dumps(graph)
        draft._environment_variables = json.dumps(
            {"KEY": {"id": "secret-id", "name": "KEY", "value_type": "secret", "value": "wrapped"}}
        )
    unwrapped: list[str] = []

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == CONTEXT.active_workspace_id
        assert sessions
        assert all(session.closed and not session.in_transaction() for session in sessions)
        unwrapped.append(token)
        return "plaintext"

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    if submit:
        result = service.submit_form(
            CONTEXT, "app-1", "human", inputs={}, form_inputs={"answer": "yes"}, action="approve"
        )
        assert result["__rendered_content"] == "Token: plaintext"
    else:
        result = service.preview_form(CONTEXT, "app-1", "human", {})
        assert result["form_content"] == "Token: plaintext"
    assert unwrapped == ["wrapped"]


@pytest.mark.parametrize(("enabled", "debug"), [(True, False), (False, False), (True, True)])
def test_email_delivery_commits_form_and_closes_sessions_before_external_send(
    human_debug: tuple[HumanInputDebugService, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    debug: bool,
) -> None:
    gateway, sessions = human_debug
    method_id = save_human_input_draft(sqlite_session_factory, enabled=enabled, debug=debug)
    forbid_global_database(monkeypatch)
    monkeypatch.setattr(
        delivery_module.FeatureService,
        "get_features",
        lambda *_args, **_kwargs: FeatureModel(human_input_email_delivery_enabled=True),
    )
    monkeypatch.setattr(delivery_module.mail, "is_inited", lambda: True)
    sent: list[str] = []
    recipient = "test@example.com" if debug else "recipient@example.com"

    def send(*, to: str, subject: str, html: str) -> None:
        assert sessions
        assert all(session.closed and not session.in_transaction() for session in sessions)
        # A separate reader sees the committed form and token before mail leaves.
        with sqlite_session_factory() as session:
            form = session.scalar(select(HumanInputForm).where(HumanInputForm.app_id == "app-1"))
            assert form is not None
            assert form.rendered_content == "Hello world"
            saved_recipient = session.scalar(
                select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form.id)
            )
            assert saved_recipient is not None
            assert saved_recipient.access_token
            assert saved_recipient.access_token in html
        assert to == recipient
        assert subject == f"Test {recipient}"
        assert "Hello world" in html
        sent.append(to)

    monkeypatch.setattr(delivery_module.mail, "send", send)
    gateway.test_delivery(
        CONTEXT, "app-1", "human", inputs={"#upstream.output#": "world"}, delivery_method_id=method_id
    )
    assert sent == [recipient]


def test_human_input_requires_draft(
    human_debug: tuple[HumanInputDebugService, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    gateway, sessions = human_debug
    with sqlite_session_factory.begin() as session:
        session.execute(delete(Workflow))
    with pytest.raises(ValueError, match="Workflow not initialized"):
        gateway.test_delivery(CONTEXT, "app-1", "human", inputs={}, delivery_method_id="missing")
    assert all(session.closed for session in sessions)


def test_file_preview_and_submission_load_upload_from_injected_database(
    human_debug: tuple[HumanInputDebugService, list[RecordingSession]],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway, sessions = human_debug
    file_id = str(uuid4())
    node = HumanInputNodeData(
        title="Attachment",
        form_content="{{#upstream.file#}}",
        inputs=[FileInputConfig(output_variable_name="attachment")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
    )
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id))
        draft = session.scalar(select(Workflow).where(Workflow.version == Workflow.VERSION_DRAFT))
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "human",
                        "data": {
                            **node.model_dump(mode="json"),
                            "type": "human-input",
                        },
                    }
                ],
                "edges": [],
            }
        )
    forbid_global_database(monkeypatch)
    file_mapping = {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}
    preview = gateway.preview_form(CONTEXT, "app-1", "human", {"#upstream.file#": file_mapping})
    assert "test.txt" in str(preview["form_content"])
    outputs = gateway.submit_form(
        CONTEXT,
        "app-1",
        "human",
        inputs={"#upstream.file#": file_mapping},
        form_inputs={"attachment": file_mapping},
        action="approve",
    )
    attachment = outputs["attachment"]
    assert isinstance(attachment, dict)
    assert attachment["filename"] == "test.txt"
    assert sessions
    assert all(session.closed for session in sessions)
