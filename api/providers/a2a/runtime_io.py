"""Wire durable Invocation values to the frozen A2A input/output profiles.

Only this dispatch adapter expands owned file references into ephemeral bytes.
Connection cards are read by the already admitted immutable revision, never the
current asset head. Observation writes are independent from business mapping.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from services.external_agents.contracts import ConnectionRevision
from services.external_agents.file_profile import DEFAULT_FILE_LIMITS, FileLimits, build_input_parts
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileReference,
    FileScope,
    InputFileReaderPort,
    JsonObject,
    OutputFileMaterializerPort,
)
from services.external_agents.output_mapping import map_output
from services.external_agents.protocol import PROFILE_VERSION, GatewayReceipt, SendRequest
from services.external_agents.runtime_contracts import CancelState, Invocation, LocalState, SubmissionState
from services.external_agents.traceability import ReportedCallUsage, extract_trace_payloads

logger = logging.getLogger(__name__)


class RevisionReader(Protocol):
    def get_connection(self, *, tenant_id: str, agent_id: str, revision_id: str) -> ConnectionRevision:
        """Read the complete owned immutable revision, including its verified safe Card."""
        ...


class ObservationWriter(Protocol):
    def record_trace(
        self, *, tenant_id: str, invocation_id: str, payload: object, source_id: str, received_at: datetime
    ) -> object: ...

    def record_usage(
        self, *, tenant_id: str, invocation_id: str, usage: ReportedCallUsage, revision: int, received_at: datetime
    ) -> None: ...


class CallUsageProofPort(Protocol):
    def prove(self, receipt: GatewayReceipt) -> tuple[ReportedCallUsage, int] | None:
        """Return an explicitly supported call-scoped proof and monotonic revision.

        A2A 1.0 has no standard call-total field. The default adapter therefore
        supplies no proof; step totals, arbitrary metadata and client inputs are
        never promoted to Invocation usage. The port is internal composition.
        """
        ...


class TraceDelivery(Protocol):
    def freeze(self, *, tenant_id: str, invocation_id: str, now: datetime) -> None: ...

    def enqueue(self, *, tenant_id: str, invocation_id: str, now: datetime) -> tuple[str, ...]: ...


def _grants(invocation: Invocation, name: str) -> frozenset[str]:
    values = invocation.job.get(name, [])
    if not isinstance(values, list) or any(not isinstance(value, str) or not value for value in values):
        raise ExternalIOError("invalid_file_scope", "The admitted file grants are invalid.")
    return frozenset(value for value in values if isinstance(value, str))


def file_scope(invocation: Invocation, *, now: datetime | None = None) -> FileScope:
    """Reconstruct trusted caller grants; markers cannot grant access to themselves.

    Individual input leases are already bound to the Invocation transactionally.
    Page session IDs are not lease IDs; the lifecycle adapter reconstructs those
    owners from the Invocation and enforces parent/test revocation independently.
    """
    started = now or datetime.now(UTC)
    deadlines = [started + timedelta(seconds=30), invocation.logical_deadline]
    if invocation.local_state == LocalState.WAITING:
        if invocation.cancel_state == CancelState.REQUESTED and invocation.cancellation_deadline is not None:
            deadlines.append(invocation.cancellation_deadline)
        elif invocation.wait_deadline is not None:
            deadlines.append(invocation.wait_deadline)
    return FileScope(
        tenant_id=invocation.scope.tenant_id,
        app_id=invocation.scope.app_id,
        actor_id=invocation.scope.initiator_id,
        actor_role=invocation.scope.actor_role,
        invocation_id=invocation.id,
        granted_upload_file_ids=_grants(invocation, "granted_upload_file_ids"),
        granted_tool_file_ids=_grants(invocation, "granted_tool_file_ids"),
        io_deadline=min(deadlines),
    )


class ExternalRequestPartsBuilder:
    def __init__(
        self,
        *,
        assets: RevisionReader,
        files: InputFileReaderPort,
        limits: FileLimits = DEFAULT_FILE_LIMITS,
        trace_delivery: TraceDelivery | None = None,
        now: Callable[[], datetime] | None = None,
        max_variable_bytes: int = 200 * 1024,
    ) -> None:
        self._assets, self._files, self._limits = assets, files, limits
        self._trace_delivery = trace_delivery
        self._now = now or (lambda: datetime.now(UTC))
        self._max_variable_bytes = max_variable_bytes

    def build(self, invocation: Invocation) -> SendRequest:
        """Materialize a permitted send without mutating its durable safe markers.

        Preconditions: the repository acquired the send permit and pinned the
        connection revision. All MIME and byte/count failures precede POST. Array
        File markers preserve their original order and are never deduplicated.
        """
        started = self._now()
        if invocation.submission_state != SubmissionState.SEND_STARTED or not invocation.connection_revision_id:
            raise ExternalIOError("dispatch_not_admitted", "External dispatch has no fixed connection permit.")
        if self._trace_delivery is not None:
            try:
                self._trace_delivery.freeze(
                    tenant_id=invocation.scope.tenant_id, invocation_id=invocation.id, now=started
                )
            except Exception:
                logger.warning("External trace destinations could not be frozen.")
        revision = self._assets.get_connection(
            tenant_id=invocation.scope.tenant_id,
            agent_id=invocation.agent_id,
            revision_id=invocation.connection_revision_id,
        )
        if (
            revision.id != invocation.connection_revision_id
            or revision.tenant_id != invocation.scope.tenant_id
            or revision.agent_id != invocation.agent_id
            or revision.profile != PROFILE_VERSION
        ):
            raise ExternalIOError("invalid_connection_revision", "The fixed verified connection is not available.")
        modes = revision.card.get("defaultInputModes")
        if not isinstance(modes, list) or not modes or any(not isinstance(mode, str) for mode in modes):
            raise ExternalIOError("invalid_agent_card", "The verified Card has no valid default input modes.")
        texts: list[str] = []
        references: list[FileReference] = []
        for part in invocation.parts:
            if set(part).issubset({"text", "mediaType"}) and isinstance(part.get("text"), str):
                if part.get("mediaType", "text/plain") != "text/plain":
                    raise ExternalIOError("invalid_input_part", "The admitted task text must use text/plain.")
                texts.append(part["text"])
            elif set(part) == {"fileRef"} and isinstance(part["fileRef"], dict):
                marker = part["fileRef"]
                identifier, kind = marker.get("file_id"), marker.get("kind", "upload")
                if (
                    not set(marker).issubset({"file_id", "kind"})
                    or not isinstance(identifier, str)
                    or not identifier
                    or kind not in ("upload", "tool", "datasource")
                ):
                    raise ExternalIOError("invalid_input_part", "The admitted file reference is invalid.")
                references.append(FileReference(file_id=identifier, kind=kind))
            else:
                raise ExternalIOError("invalid_input_part", "Only admitted text and file references may be dispatched.")
        task_text = "".join(texts)
        if len(task_text.encode("utf-8")) > self._max_variable_bytes:
            raise ExternalIOError("input_variable_too_large", "Task text exceeds the variable byte limit.")
        return SendRequest(
            message_id=invocation.message_id,
            parts=build_input_parts(
                task_text,
                references,
                scope=file_scope(invocation, now=started),
                reader=self._files,
                agent_input_modes=modes,
                limits=self._limits,
            ),
            context_id=invocation.carried_context_id,
        )


class ExternalOutputNormalizer:
    def __init__(
        self,
        *,
        files: OutputFileMaterializerPort,
        observations: ObservationWriter | None = None,
        usage_proof: CallUsageProofPort | None = None,
        limits: FileLimits = DEFAULT_FILE_LIMITS,
        trace_delivery: TraceDelivery | None = None,
        now: Callable[[], datetime] | None = None,
        max_variable_bytes: int = 200 * 1024,
    ) -> None:
        self._files, self._observations, self._usage_proof = files, observations, usage_proof
        self._limits = limits
        self._trace_delivery = trace_delivery
        self._now = now or (lambda: datetime.now(UTC))
        self._max_variable_bytes = max_variable_bytes

    def observe(self, invocation: Invocation, receipt: GatewayReceipt) -> None:
        """Ingest partial/failed/terminal carriers idempotently, independently of mapping.

        The runtime may call this on every associated receipt. The observation
        repository deduplicates stable carrier IDs; exporter intents remain
        separate and can never result in another business dispatch.
        """
        if self._observations is not None:
            received_at = self._now()
            for source_id, payload in extract_trace_payloads(receipt.payload):
                try:
                    self._observations.record_trace(
                        tenant_id=invocation.scope.tenant_id,
                        invocation_id=invocation.id,
                        payload=payload,
                        source_id=source_id,
                        received_at=received_at,
                    )
                except Exception:
                    # The observation owner fence can expire independently. Do
                    # not log exception bodies containing remote data/secrets.
                    logger.warning("External trace observation was not recorded.")
            if self._usage_proof is not None:
                try:
                    proof = self._usage_proof.prove(receipt)
                    if proof is not None:
                        usage, revision = proof
                        if type(revision) is not int or revision < 0:
                            raise ValueError("invalid_call_usage_revision")
                        self._observations.record_usage(
                            tenant_id=invocation.scope.tenant_id,
                            invocation_id=invocation.id,
                            usage=usage,
                            revision=revision,
                            received_at=received_at,
                        )
                except Exception:
                    logger.warning("External call usage observation was not recorded.")
            if self._trace_delivery is not None:
                try:
                    self._trace_delivery.enqueue(
                        tenant_id=invocation.scope.tenant_id, invocation_id=invocation.id, now=received_at
                    )
                except Exception:
                    logger.warning("External trace export intents could not be recorded.")

    def normalize(self, invocation: Invocation, receipt: GatewayReceipt) -> JsonObject:
        """Return trusted outputs after all required file materialization succeeds.

        Observation failures cannot alter business success or trigger dispatch.
        There is deliberately no raw response persistence here. The runtime owns
        its terminal/wake transaction and retains only safe receipt metadata.
        """
        return map_output(
            receipt,
            invocation.declared_outputs,
            scope=file_scope(invocation, now=self._now()),
            materializer=self._files,
            limits=self._limits,
            max_variable_bytes=self._max_variable_bytes,
        ).values
