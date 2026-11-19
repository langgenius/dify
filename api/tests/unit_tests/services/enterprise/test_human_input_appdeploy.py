"""Contract regressions for AppDeploy forms without community run records."""

from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock

import pytest
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import MarkdownFragment, ResolvedForm, UserAction
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from enums import DeploymentEdition
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment, SerializableSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from models.human_input_v2 import HumanInputForm
from repositories.human_input_v2.form_repository import FormCreateParams, FormSubmission
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from services.enterprise.human_input_run_gateway import EnterpriseHumanInputRunGateway, drain_pending_run_effects
from services.enterprise.human_input_service import PreparePayload, project_prepared
from services.errors.enterprise import EnterpriseAPIError
from services.human_input_v2.form_service import handle_form_timeouts
from services.human_input_v2.run_gateway import DifyHumanInputRunGateway, build_run_gateway


def test_trigger_prepare_without_initiator() -> None:
    payload = PreparePayload.model_validate(
        {
            "owner_ref": {"environment_id": "env", "deployment_id": "deploy", "revision_id": "rev"},
            "node_execution_id": "execution",
            "node_id": "review",
            "form_version": "2",
            "node_data": {},
            "variables": {},
            "run_created_at": "2026-11-19T00:00:00Z",
        }
    )
    assert payload.initiator is None


@pytest.mark.parametrize("version", ["1", "2"])
@pytest.mark.parametrize("state", list(HumanInputFormStatus))
def test_versioned_outcome_projection(
    sqlite_session_factory: sessionmaker[Session], version: str, state: HumanInputFormStatus
) -> None:
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        form = SQLAlchemyFormRepository(session, TenantId("tenant"), "app").create_form(
            FormCreateParams(
                workflow_run_id="run",
                node_execution_id="execution",
                resolved_form=ResolvedForm(
                    title="Review",
                    parts=(MarkdownFragment(text="Hello"),),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                    legacy_form_content="Hello",
                ),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(days=1),
                run_gateway="enterprise",
                form_version=version,
                owner_ref={
                    "node_id": "review",
                    "environment_id": "env",
                    "deployment_id": "deploy",
                    "revision_id": "rev",
                },
            )
        )
    submission = (
        FormSubmission(
            submitted_at=now,
            submitted_by_recipient_id=RecipientId("recipient"),
            submitted_by_delivery_id="delivery",
            selected_action_id="approve",
            raw_submission_inputs={"note": "Accepted"},
            normalized_submission_data={"note": StringSegment(value="Accepted")},
        )
        if state == HumanInputFormStatus.SUBMITTED
        else None
    )
    projection = project_prepared(PreparedForm(replace(form, status=state, submission=submission), None))
    assert projection["session_id"] == (form.id if version == "1" else f"hitlv2:{form.id}")
    assert projection["status"] == state.value
    assert projection["form_token"] is None
    if state == HumanInputFormStatus.WAITING:
        assert projection["event"]["form_version"] == version
        assert projection["event"]["node_id"] == "review"
    elif state == HumanInputFormStatus.TIMEOUT:
        assert projection["edge_source_handle"] == "__timeout"
        assert projection["outputs"]["__rendered_content"] == "Hello"
    elif state == HumanInputFormStatus.SUBMITTED:
        assert projection["edge_source_handle"] == "approve"
        assert projection["outputs"]["note"] == "Accepted"
        assert projection["outputs"]["__action_value"] == "Approve"
        assert projection["output_segments"]["note"]["value_type"] == "string"
    else:
        assert projection["event"] is None
        assert projection["expire_reason"]


def test_file_outputs_round_trip_as_graphon_segments(sqlite_session_factory: sessionmaker[Session]) -> None:
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        form = SQLAlchemyFormRepository(session, TenantId("tenant"), "app").create_form(
            FormCreateParams(
                workflow_run_id="run",
                node_execution_id="execution",
                resolved_form=ResolvedForm(
                    title="Review",
                    parts=(),
                    actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
                    legacy_form_content="",
                ),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(days=1),
                run_gateway="enterprise",
                owner_ref={"node_id": "review"},
            )
        )
    file = File(
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/report.pdf",
        filename="report.pdf",
    )
    submission = FormSubmission(
        submitted_at=now,
        submitted_by_recipient_id=RecipientId("recipient"),
        submitted_by_delivery_id="delivery",
        selected_action_id="approve",
        raw_submission_inputs={},
        normalized_submission_data={"file": FileSegment(value=file), "files": ArrayFileSegment(value=[file])},
    )
    projection = project_prepared(
        PreparedForm(replace(form, status=HumanInputFormStatus.SUBMITTED, submission=submission), None)
    )
    wire = TypeAdapter(dict[str, JsonValue]).dump_json(projection)
    decoded = TypeAdapter(dict[str, JsonValue]).validate_json(wire)
    segments = TypeAdapter(dict[str, SerializableSegment]).validate_python(decoded["output_segments"])
    assert isinstance(segments["file"], FileSegment)
    assert isinstance(segments["files"], ArrayFileSegment)
    assert segments["file"].value.filename == "report.pdf"


@pytest.mark.parametrize("global_timeout", [False, True])
def test_enterprise_timeout_does_not_require_a_local_workflow_run(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, global_timeout: bool
) -> None:
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        form = SQLAlchemyFormRepository(session, TenantId("tenant"), "app").create_form(
            FormCreateParams(
                workflow_run_id="run",
                node_execution_id="execution",
                resolved_form=ResolvedForm(title="Review", parts=(), actions=(), legacy_form_content=""),
                expiration_time=now - timedelta(minutes=1),
                global_timeout_deadline=now + timedelta(days=-1 if global_timeout else 1),
                run_gateway="enterprise",
                owner_ref={"node_id": "review"},
            )
        )
    requests = Mock(return_value={})
    monkeypatch.setattr("services.enterprise.human_input_run_gateway.EnterpriseRequest.send_request", requests)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    handle_form_timeouts(
        session_factory=sqlite_session_factory, tenant_id=TenantId("tenant"), app_id="app", workflow_run_id="run"
    )
    with sqlite_session_factory() as session:
        settled = SQLAlchemyFormRepository(session, TenantId("tenant"), "app").get_form_by_id(form.id)
    assert settled.status == (HumanInputFormStatus.EXPIRED if global_timeout else HumanInputFormStatus.TIMEOUT)
    assert requests.call_args.args[1] == (
        "/app-deploy/apps/app/workflow-runs/run" + (":stop" if global_timeout else ":requestResume")
    )
    assert isinstance(build_run_gateway(settled, sqlite_session_factory), EnterpriseHumanInputRunGateway)
    assert isinstance(
        build_run_gateway(replace(settled, run_gateway="dify"), sqlite_session_factory), DifyHumanInputRunGateway
    )
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    with pytest.raises(ValueError, match="unavailable"):
        build_run_gateway(settled, sqlite_session_factory)


@pytest.mark.parametrize(
    "status", [HumanInputFormStatus.SUBMITTED, HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED]
)
def test_committed_effect_survives_failures_until_acknowledged(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, status: HumanInputFormStatus
) -> None:
    """A lost post-commit HTTP response cannot strand submission or timeout recovery."""
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        repository = SQLAlchemyFormRepository(session, TenantId("tenant"), "app")
        form = repository.create_form(
            FormCreateParams(
                workflow_run_id="run",
                node_execution_id="execution",
                resolved_form=ResolvedForm(title="Review", parts=(), actions=(), legacy_form_content=""),
                expiration_time=now + timedelta(hours=1),
                global_timeout_deadline=now + timedelta(days=1),
                run_gateway="enterprise",
                owner_ref={"node_id": "review"},
            )
        )
        if status == HumanInputFormStatus.SUBMITTED:
            repository.submit_form(
                form.id,
                submitted_by_recipient_id=RecipientId("recipient"),
                submitted_by_delivery_id="delivery",
                selected_action_id="approve",
                raw_submission_inputs={},
                normalized_submission_data={},
            )
        elif status == HumanInputFormStatus.EXPIRED:
            repository.cancel_form(form.id)
        else:
            record = session.get(HumanInputForm, form.id)
            record.expiration_time = now - timedelta(seconds=1)
            session.flush()
            repository.timeout_form(form.id)
    requests = Mock(side_effect=EnterpriseAPIError("unavailable"))
    monkeypatch.setattr("services.enterprise.human_input_run_gateway.EnterpriseRequest.send_request", requests)
    for _ in range(10):
        drain_pending_run_effects(sqlite_session_factory)
    with sqlite_session_factory() as session:
        assert session.get(HumanInputForm, form.id).run_effect_pending
    requests.side_effect = None
    requests.return_value = {}
    drain_pending_run_effects(sqlite_session_factory)
    with sqlite_session_factory() as session:
        assert not session.get(HumanInputForm, form.id).run_effect_pending
    assert requests.call_count == 11
    assert requests.call_args.args[1].endswith(":stop" if status == HumanInputFormStatus.EXPIRED else ":requestResume")
    drain_pending_run_effects(sqlite_session_factory)
    assert requests.call_count == 11
