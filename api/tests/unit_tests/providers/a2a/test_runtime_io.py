"""Contract tests for immutable-revision dispatch and trusted output publication."""

import base64
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from providers.a2a.runtime_io import ExternalOutputNormalizer, ExternalRequestPartsBuilder, file_scope
from services.external_agents.contracts import ConnectionRevision
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileBlob,
    FileReference,
    FileScope,
    JsonObject,
    OutputField,
    StoredFile,
)
from services.external_agents.protocol import TRACEABILITY_URI, GatewayReceipt
from services.external_agents.runtime_contracts import (
    CancelState,
    ExecutionIdentity,
    Invocation,
    RuntimeScope,
    SubmissionState,
    WaitPolicy,
)
from services.external_agents.traceability import ReportedCallUsage

NOW = datetime(2026, 11, 9, tzinfo=UTC)


def invocation(
    *,
    parts: tuple[JsonObject, ...] | None = None,
    submission_state: SubmissionState = SubmissionState.SEND_STARTED,
    declared_outputs: tuple[OutputField, ...] = (),
    job: JsonObject | None = None,
    wait_deadline: datetime | None = None,
    cancel_state: CancelState = CancelState.NONE,
    cancellation_deadline: datetime | None = None,
) -> Invocation:
    value = Invocation(
        id="invocation",
        scope=RuntimeScope(tenant_id="tenant", initiator_id="actor", app_id=None, origin="overview_test"),
        agent_id="agent",
        identity=ExecutionIdentity(execution_id="execution", node_id="node", frame_id="frame"),
        message_id="message",
        parts=({"text": "Review"},),
        policy=WaitPolicy(),
        declared_outputs=(),
        started_at=NOW,
        logical_deadline=NOW + timedelta(hours=1),
        connection_revision_id="frozen-revision",
        submission_state=SubmissionState.SEND_STARTED,
        carried_context_id="server-context",
        job={"page_session_id": "not-a-lease", "granted_upload_file_ids": ["file-a"]},
    )
    return replace(
        value,
        parts=value.parts if parts is None else parts,
        submission_state=submission_state,
        declared_outputs=declared_outputs,
        job=value.job if job is None else job,
        wait_deadline=wait_deadline,
        cancel_state=cancel_state,
        cancellation_deadline=cancellation_deadline,
    )


class InMemoryRevisions:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.reads: list[tuple[str, str, str]] = []
        self.revision = ConnectionRevision(
            id="frozen-revision",
            tenant_id="tenant",
            agent_id="agent",
            endpoint="https://agent.example",
            interface_url="https://agent.example/a2a",
            auth_type="none",
            credential_ciphertext=None,
            card={"defaultInputModes": ["text/plain", "application/pdf"]},
            capabilities={},
            auth_check="not_exercised",
            verified_at=NOW,
        )

    def get_connection(self, *, tenant_id: str, agent_id: str, revision_id: str) -> ConnectionRevision:
        self.reads.append((tenant_id, agent_id, revision_id))
        self.events.append("revision")
        return self.revision


class InMemoryFiles:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.reads: list[str] = []
        self.outputs: dict[tuple[str, str, int], bytes] = {}

    def read_authorized(self, scope: FileScope, reference: FileReference, *, max_bytes: int) -> FileBlob:
        assert max_bytes >= 3
        assert scope.actor_id == "actor"
        assert scope.app_id is None
        assert scope.lease_id is None
        assert scope.granted_upload_file_ids == frozenset({"file-a"})
        self.events.append("file")
        self.reads.append(reference.file_id)
        return FileBlob(filename="a.pdf", media_type="application/pdf", data=b"pdf")

    def materialize(
        self, scope: FileScope, part: JsonObject, *, artifact_id: str, part_index: int, max_bytes: int | None = None
    ) -> StoredFile:
        self.events.append("stored")
        raw, media_type = part["raw"], part["mediaType"]
        assert isinstance(raw, str)
        assert isinstance(media_type, str)
        data = base64.b64decode(raw)
        assert max_bytes is not None
        assert len(data) <= max_bytes
        self.outputs[(scope.invocation_id, artifact_id, part_index)] = data
        return StoredFile(
            file_id="durable-file",
            value={"upload_file_id": "durable-file"},
            size=len(data),
            media_type=media_type,
        )


class InMemoryObservations:
    def __init__(self, events: list[str], *, revoked: bool = False) -> None:
        self.events = events
        self.revoked = revoked
        self.traces: dict[tuple[str, str, str], object] = {}
        self.usages: dict[tuple[str, str], tuple[ReportedCallUsage, int]] = {}

    def record_trace(
        self, *, tenant_id: str, invocation_id: str, payload: object, source_id: str, received_at: datetime
    ) -> None:
        assert received_at.tzinfo is not None
        if self.revoked:
            raise ValueError("owner_revoked")
        self.events.append("trace")
        self.traces[(tenant_id, invocation_id, source_id)] = payload

    def record_usage(
        self, *, tenant_id: str, invocation_id: str, usage: ReportedCallUsage, revision: int, received_at: datetime
    ) -> None:
        assert received_at.tzinfo is not None
        self.usages[(tenant_id, invocation_id)] = (usage, revision)


class InMemoryDelivery:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.targets: dict[tuple[str, str], str] = {}

    def freeze(self, *, tenant_id: str, invocation_id: str, now: datetime) -> None:
        assert now.tzinfo is not None
        self.events.append("freeze")
        self.targets.setdefault((tenant_id, invocation_id), "dispatch-target")

    def enqueue(self, *, tenant_id: str, invocation_id: str, now: datetime) -> tuple[str, ...]:
        assert tenant_id == "tenant"
        assert invocation_id == "invocation"
        assert now.tzinfo is not None
        self.events.append("enqueue")
        return ()


def completed_receipt() -> GatewayReceipt:
    return GatewayReceipt(
        kind="task",
        task_id="remote",
        state="TASK_STATE_COMPLETED",
        payload={
            "id": "remote",
            "status": {"state": "TASK_STATE_COMPLETED"},
            "artifacts": [
                {
                    "artifactId": "trace",
                    "name": "report",
                    "extensions": [TRACEABILITY_URI],
                    "parts": [{"data": {"trace_id": "t", "steps": []}}],
                },
                {
                    "artifactId": "business",
                    "name": "report",
                    "parts": [
                        {
                            "raw": base64.b64encode(b"report").decode(),
                            "mediaType": "application/pdf",
                            "filename": "r.pdf",
                        }
                    ],
                },
            ],
        },
    )


def test_dispatch_freezes_targets_and_reads_only_the_fixed_revision_before_materializing() -> None:
    events: list[str] = []
    assets, files, delivery = InMemoryRevisions(events), InMemoryFiles(events), InMemoryDelivery(events)
    source = invocation(
        parts=(
            {"text": "Review", "mediaType": "text/plain"},
            {"fileRef": {"file_id": "file-a", "kind": "upload"}},
            {"fileRef": {"file_id": "file-a", "kind": "upload"}},
        )
    )
    request = ExternalRequestPartsBuilder(assets=assets, files=files, trace_delivery=delivery, now=lambda: NOW).build(
        source
    )
    assert events == ["freeze", "revision", "file", "file"]
    assert assets.reads == [("tenant", "agent", "frozen-revision")]
    assert files.reads == ["file-a", "file-a"]
    assert request.context_id == "server-context"
    assert [part.get("raw") for part in request.parts] == [None, "cGRm", "cGRm"]
    assert all("raw" not in part for part in source.parts)
    assert source.parts[1] == {"fileRef": {"file_id": "file-a", "kind": "upload"}}


@pytest.mark.parametrize(
    "part",
    [
        {"raw": "cGRm"},
        {"url": "https://private.example/file"},
        {"fileRef": {"file_id": "a", "kind": "upload", "url": "secret"}},
        {"text": "Review", "mediaType": "application/json"},
    ],
)
def test_persisted_wire_bytes_urls_and_unknown_marker_fields_are_never_accepted(part: JsonObject) -> None:
    assets, files = InMemoryRevisions([]), InMemoryFiles([])
    with pytest.raises(ExternalIOError) as error:
        ExternalRequestPartsBuilder(assets=assets, files=files).build(invocation(parts=(part,)))
    assert error.value.code == "invalid_input_part"
    assert files.reads == []


def test_no_permit_or_wrong_revision_cannot_read_files() -> None:
    assets, files = InMemoryRevisions([]), InMemoryFiles([])
    builder = ExternalRequestPartsBuilder(assets=assets, files=files)
    with pytest.raises(ExternalIOError, match="permit"):
        builder.build(invocation(submission_state=SubmissionState.PREPARED))
    assert assets.reads == []
    assets.revision = replace(assets.revision, id="current-head-is-not-frozen")
    with pytest.raises(ExternalIOError) as error:
        builder.build(invocation())
    assert error.value.code == "invalid_connection_revision"
    assert files.reads == []


def test_task_utf8_size_fails_before_reading_any_files() -> None:
    assets, files = InMemoryRevisions([]), InMemoryFiles([])
    builder = ExternalRequestPartsBuilder(assets=assets, files=files, max_variable_bytes=4)
    with pytest.raises(ExternalIOError) as error:
        builder.build(invocation(parts=({"text": "汉字"}, {"fileRef": {"file_id": "file-a"}})))
    assert error.value.code == "input_variable_too_large"
    assert files.reads == []


def test_scope_does_not_turn_file_markers_or_page_session_into_authorization() -> None:
    assert file_scope(invocation()).lease_id is None
    with pytest.raises(ExternalIOError) as error:
        file_scope(invocation(job={"granted_upload_file_ids": "file-a"}))
    assert error.value.code == "invalid_file_scope"


def test_file_batch_uses_the_active_cancellation_grace_instead_of_expired_node_wait() -> None:
    value = invocation(
        wait_deadline=NOW - timedelta(seconds=1),
        cancel_state=CancelState.REQUESTED,
        cancellation_deadline=NOW + timedelta(seconds=10),
    )
    assert file_scope(value, now=NOW).io_deadline == NOW + timedelta(seconds=10)


def test_normalizer_excludes_exact_trace_carrier_then_publishes_only_durable_files() -> None:
    events: list[str] = []
    files, observations, delivery = InMemoryFiles(events), InMemoryObservations(events), InMemoryDelivery(events)
    normalizer = ExternalOutputNormalizer(
        files=files, observations=observations, trace_delivery=delivery, now=lambda: NOW
    )
    normalizer.observe(invocation(), completed_receipt())
    outputs = normalizer.normalize(
        invocation(declared_outputs=(OutputField(name="report", kind="file"),)), completed_receipt()
    )
    assert outputs == {"report": {"upload_file_id": "durable-file"}}
    assert observations.traces == {("tenant", "invocation", "trace:part:0"): {"trace_id": "t", "steps": []}}
    assert observations.usages == {}
    assert events == ["trace", "enqueue", "stored"]


def test_expired_observation_owner_cannot_fail_business_outputs() -> None:
    normalizer = ExternalOutputNormalizer(files=InMemoryFiles([]), observations=InMemoryObservations([], revoked=True))
    normalizer.observe(invocation(), completed_receipt())
    outputs = normalizer.normalize(
        invocation(declared_outputs=(OutputField(name="report", kind="file"),)), completed_receipt()
    )
    assert outputs["report"] == {"upload_file_id": "durable-file"}


def test_only_internal_explicit_call_proof_can_record_usage_including_zero() -> None:
    class SupportedProfileProof:
        def prove(self, receipt: GatewayReceipt) -> tuple[ReportedCallUsage, int] | None:
            assert receipt.kind == "task"
            return ReportedCallUsage(
                total_tokens=0, source_path="supported-invocation-profile.total", adapter="tested-profile-v1"
            ), 1

    observations = InMemoryObservations([])
    normalizer = ExternalOutputNormalizer(
        files=InMemoryFiles([]), observations=observations, usage_proof=SupportedProfileProof()
    )
    normalizer.observe(invocation(), completed_receipt())
    assert observations.usages[("tenant", "invocation")][0].total_tokens == 0
    assert observations.usages[("tenant", "invocation")][1] == 1
