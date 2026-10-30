import json
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pytest
from click.testing import CliRunner
from sqlalchemy.orm import Session, sessionmaker

from commands import retrieval_tuning as retrieval_tuning_module
from commands import retrieval_tuning_reports
from dify_app import DifyApp
from extensions import ext_commands
from extensions.application_services.retrieval_tuning import RetrievalTuningServices, build_retrieval_tuning_services
from libs.datetime_utils import naive_utc_now
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, MessageFeedback
from models.workflow import WorkflowType
from tests.helpers.unit.model_factories import make_message, make_workflow


@dataclass(frozen=True)
class _ApplicationServices:
    retrieval_tuning: RetrievalTuningServices


@pytest.fixture
def _wired_services(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    services = _ApplicationServices(build_retrieval_tuning_services(database_client=sqlite_session_factory))
    monkeypatch.setattr(retrieval_tuning_module, "application_services", lambda: services)


def _seed_rated_app(factory: sessionmaker[Session]) -> tuple[str, str]:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    message_id = str(uuid4())
    with factory.begin() as session:
        app = App(
            tenant_id=tenant_id, name="Private app name", mode=AppMode.ADVANCED_CHAT, enable_site=True, enable_api=True
        )
        app.id = app_id
        session.add(app)
        session.add(
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=str(uuid4()),
                inputs={},
                query="private query",
                message=[],
                answer="private answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
                created_at=naive_utc_now(),
            )
        )
        session.add(
            MessageFeedback(
                app_id=app_id,
                conversation_id=str(uuid4()),
                message_id=message_id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.USER,
                content="private comment",
            )
        )
    return tenant_id, app_id


@pytest.mark.usefixtures("_wired_services")
def test_feedback_volume_writes_csv_without_private_text(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id, app_id = _seed_rated_app(sqlite_session_factory)

    result = CliRunner().invoke(retrieval_tuning_reports, ["feedback-volume"])

    assert result.exit_code == 0, result.output
    assert result.output.splitlines() == [
        "tenant_id,app_id,messages,user_likes,user_dislikes,user_rating_rate,"
        "user_rated_workflow_run_share,admin_likes,admin_dislikes",
        f"{tenant_id},{app_id},1,1,0,1.0000,0.0000,0,0",
    ]
    assert "private" not in result.output.lower()


@pytest.mark.usefixtures("_wired_services")
def test_feedback_volume_limits_output_to_the_requested_tenant(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _seed_rated_app(sqlite_session_factory)
    tenant_id, app_id = _seed_rated_app(sqlite_session_factory)

    result = CliRunner().invoke(retrieval_tuning_reports, ["feedback-volume", "--tenant-id", tenant_id])

    assert result.exit_code == 0, result.output
    assert [line.split(",")[1] for line in result.output.splitlines()[1:]] == [app_id]


@pytest.mark.parametrize("arguments", [["--days", "0"], ["--tenant-id", "not-a-uuid"]])
def test_feedback_volume_rejects_invalid_options(arguments: list[str]) -> None:
    result = CliRunner().invoke(retrieval_tuning_reports, ["feedback-volume", *arguments])

    assert result.exit_code == 2


def test_retrieval_tuning_command_is_registered() -> None:
    app = DifyApp(__name__)
    ext_commands.init_app(app)

    assert app.cli.commands["retrieval-tuning"] is retrieval_tuning_reports


@pytest.mark.usefixtures("_wired_services")
def test_node_eligibility_writes_rows_and_category_totals_without_private_text(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    workflow_id = str(uuid4())
    other_app_id = str(uuid4())
    other_workflow_id = str(uuid4())
    graph = json.dumps(
        {
            "nodes": [
                {
                    "id": "retrieval",
                    "data": {
                        "type": "knowledge-retrieval",
                        "title": "Private title",
                        "dataset_ids": [],
                        "retrieval_mode": "single",
                    },
                }
            ]
        }
    )
    with sqlite_session_factory.begin() as session:
        for resolved_app, resolved_workflow, resolved_graph in (
            (app_id, workflow_id, graph),
            (other_app_id, other_workflow_id, "not json"),
        ):
            session.add(
                make_workflow(
                    workflow_id=resolved_workflow,
                    tenant_id=tenant_id,
                    app_id=resolved_app,
                    workflow_type=WorkflowType.CHAT,
                    version="1",
                    graph=resolved_graph,
                    created_by=str(uuid4()),
                )
            )
            app = App(
                tenant_id=tenant_id,
                name="Private app name",
                mode=AppMode.ADVANCED_CHAT,
                enable_site=True,
                enable_api=True,
                workflow_id=resolved_workflow,
            )
            app.id = resolved_app
            session.add(app)

    result = CliRunner().invoke(retrieval_tuning_reports, ["node-eligibility", "--tenant-id", tenant_id])

    assert result.exit_code == 0, result.output
    rows = result.stdout.splitlines()
    assert rows[0].startswith("tenant_id,app_id,workflow_id,node_id,category,")
    assert f"{tenant_id},{app_id},{workflow_id},retrieval,router_single,0,0,,False,False,1" in rows
    assert f"{tenant_id},{other_app_id},{other_workflow_id},,malformed_graph,0,0,,False,False,0" in rows
    assert result.stderr.splitlines() == ["malformed_graph: 1", "router_single: 1"]
    assert "private" not in result.output.lower()
