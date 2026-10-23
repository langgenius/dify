from datetime import datetime

from dify_trace_sdk.testing import RecordingEgress
from sqlalchemy.orm import Session, sessionmaker

from services.tracing.records import GenerateNameTraceInfo
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.services.tracing.test_application_trace_collection import seed, tracing_service


def test_naming_without_a_message_stays_with_its_agent_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    case = seed(sqlite_session_factory, "naming")
    service = tracing_service(case, RecordingEgress([], grpc_target=None))
    record = GenerateNameTraceInfo(
        message_id=None,
        message_data=None,
        inputs="hello",
        outputs="Greeting",
        start_time=datetime(2026, 1, 1),
        end_time=datetime(2026, 1, 1),
        metadata={"app_id": case.run.app_id, "conversation_id": "conversation-1", "trace_event_id": "event-1"},
        conversation_id="conversation-1",
        tenant_id=case.run.tenant_id,
    )

    assert service.capture_terminal(record) is True


def test_runs_frozen_for_an_unavailable_provider_report_no_capabilities() -> None:
    assert ApplicationTracingService._frozen_capabilities("not-a-provider") is None
