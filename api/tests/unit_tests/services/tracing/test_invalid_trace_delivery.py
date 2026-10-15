"""Malformed durable traces must never be sent or offered for provider retry."""

from uuid import uuid4

import pytest
from dify_agent.protocol.tracing import AgentTraceSpan

from models.application_trace import ApplicationTraceRun
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import service as service_module
from services.tracing.service import ApplicationTracingService
from tests.unit_tests.services.tracing.test_application_trace_collection import batch_for, ingest, seed, terminal


@pytest.mark.parametrize("invalid", ["cycle", "invalid_envelope"])
def test_invalid_tree_is_permanent_before_decryption_or_provider_io(sqlite_session_factory, monkeypatch, invalid):
    case = seed(sqlite_session_factory, str(uuid4()))
    batch = batch_for(case.run, case.invocation())
    if invalid == "cycle":
        for span_id, parent_id in [("b" * 16, "c" * 16), ("c" * 16, "b" * 16)]:
            batch.spans.append(
                AgentTraceSpan(
                    trace_id=case.run.trace_id,
                    span_id=span_id,
                    parent_span_id=parent_id,
                    name="cyclic tool",
                    start_time_ns=1_000_000_000,
                    end_time_ns=2_000_000_000,
                    status="ok",
                )
            )
    ingest(case, batch)
    terminal(case)
    if invalid == "invalid_envelope":
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            row.outer_trace = {"corrupt": True}

    def forbidden(*_args, **_kwargs):
        pytest.fail("invalid traces must fail before credentials or provider I/O")

    monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", forbidden)
    monkeypatch.setattr(service_module, "export_trace", forbidden)
    ApplicationTracingService(case.repository).deliver(case.run.id)
    current = case.repository.get(case.run.id)
    assert current.state == "failed"
    assert current.error_code == "tracing_payload_invalid"
    assert current.attempts == 1
    with pytest.raises(TraceCollectionError, match="tracing_retry_not_allowed"):
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
