"""Saved-configuration Overview tests, isolated from production conversations."""

from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from machinery.context import RequestContext

from .contracts import (
    ExternalAgentConflictError,
    ExternalAgentInvalidInputError,
    ExternalAssetAccess,
    ExternalAssetStore,
)
from .file_profile import FileLimits, validate_blob
from .invocation_service import ExternalInvocationService
from .io_contracts import FileBlob, FileWriteReservation, JsonObject, OutputField
from .output_mapping import validate_output_fields
from .runtime_contracts import (
    ExecutionIdentity,
    Invocation,
    InvocationDraft,
    RuntimeClock,
    RuntimeResult,
    RuntimeScope,
    WaitPolicy,
)


@dataclass(frozen=True, slots=True)
class ExternalTestStatistics:
    """Logical test statistics; absent duration/usage is unknown, never zero-filled.

    Duration spans the first actual dispatch through the latest local terminal
    (or read time while waiting/retrying), including retry/cancellation gaps.
    Only dispatched attempts count. Total tokens is known only when every such
    attempt has trusted call-total usage; Trace step tokens are never summed.
    """

    elapsed_time: float | None
    total_tokens: int | None
    attempt_count: int
    token_reporting_numerator: int
    token_reporting_denominator: int


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalTestResult(RuntimeResult):
    statistics: ExternalTestStatistics


class ExternalTestStatisticsStore(Protocol):
    def test_statistics(
        self, context: RequestContext, *, agent_id: str, invocation_id: str, now: datetime
    ) -> ExternalTestStatistics:
        """Read one owned Overview execution through the selected attempt's sequence.

        Recheck tenant, actor, origin, asset and retained ownership. The selected
        attempt pins this read so a concurrently created retry cannot be mixed
        into an older result. No provider/Trace-step I/O or business writes occur.
        """
        ...


@dataclass(frozen=True, slots=True, kw_only=True)
class TestFile:
    lease_id: str
    file_id: str
    filename: str
    media_type: str
    size: int
    expires_at: datetime


class TestFileStore(Protocol):
    def register(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        plan: FileWriteReservation,
        blob: FileBlob,
    ) -> TestFile: ...

    def complete(self, context: RequestContext, *, lease_id: str) -> bool: ...
    def abort(self, context: RequestContext, *, lease_id: str) -> None: ...
    def release(self, context: RequestContext, *, agent_id: str, lease_id: str) -> None: ...

    def references(
        self, context: RequestContext, *, agent_id: str, page_session_id: str, lease_ids: tuple[str, ...]
    ) -> tuple[JsonObject, ...]: ...


class TestFileUploadPort(Protocol):
    def plan(self, context: RequestContext, blob: FileBlob) -> FileWriteReservation: ...
    def upload(self, context: RequestContext, blob: FileBlob, *, reserved_file_id: str) -> str: ...
    def remove(self, plan: FileWriteReservation) -> None: ...
    def fetch(self, context: RequestContext, *, url: str, filename: str | None, media_type: str | None) -> FileBlob: ...


class ExternalTestService:
    def __init__(
        self,
        *,
        assets: ExternalAssetStore,
        access: ExternalAssetAccess,
        runtime: ExternalInvocationService,
        files: TestFileStore,
        uploads: TestFileUploadPort,
        limits: FileLimits,
        max_variable_bytes: int,
        statistics: ExternalTestStatisticsStore,
        clock: RuntimeClock,
    ) -> None:
        self._assets, self._access, self._runtime = assets, access, runtime
        self._files, self._uploads, self._limits = files, uploads, limits
        self._max_variable_bytes = max_variable_bytes
        self._statistics, self._clock = statistics, clock

    def _admit(self, context: RequestContext, agent_id: str) -> None:
        from .contracts import ExternalAgentForbiddenError

        visible = self._access.visible_agent_ids(context)
        if self._access.role(context) not in {"owner", "admin", "editor"} or (
            visible is not None and agent_id not in visible
        ):
            raise ExternalAgentForbiddenError("The current actor cannot test this External Agent.")
        self._assets.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)

    @staticmethod
    def _page(page: str) -> None:
        if not page or len(page) > 128 or any(ord(char) < 33 for char in page):
            raise ExternalAgentInvalidInputError("A valid page session is required.")

    @staticmethod
    def _scope(context: RequestContext) -> RuntimeScope:
        return RuntimeScope(
            tenant_id=context.active_workspace_id, initiator_id=context.account_id, app_id=None, origin="overview_test"
        )

    def upload(self, context: RequestContext, *, agent_id: str, page_session_id: str, blob: FileBlob) -> TestFile:
        self._admit(context, agent_id)
        self._page(page_session_id)
        validate_blob(blob, self._limits)
        plan = self._uploads.plan(context, blob)
        lease = self._files.register(context, agent_id=agent_id, page_session_id=page_session_id, plan=plan, blob=blob)
        try:
            self._uploads.upload(context, blob, reserved_file_id=plan.file_id)
            if not self._files.complete(context, lease_id=lease.lease_id):
                raise ExternalAgentConflictError("The test file scope expired while uploading.")
            return lease
        except Exception:
            # A durable intent retains the owned key for cleanup retry.
            with suppress(Exception):
                self._uploads.remove(plan)
            self._files.abort(context, lease_id=lease.lease_id)
            raise

    def paste_link(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        url: str,
        filename: str | None = None,
        media_type: str | None = None,
    ) -> TestFile:
        self._admit(context, agent_id)
        self._page(page_session_id)
        blob = self._uploads.fetch(context, url=url, filename=filename, media_type=media_type)
        return self.upload(context, agent_id=agent_id, page_session_id=page_session_id, blob=blob)

    def release_file(self, context: RequestContext, *, agent_id: str, lease_id: str) -> None:
        """Clear an owned unsubmitted input; an admitted Invocation retains its lease."""
        self._admit(context, agent_id)
        self._files.release(context, agent_id=agent_id, lease_id=lease_id)

    def start(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int,
        idempotency_key: str,
        task_text: str,
        input_lease_ids: tuple[str, ...],
        outputs: tuple[OutputField, ...],
        policy: WaitPolicy,
    ) -> Invocation:
        self._admit(context, agent_id)
        self._page(page_session_id)
        if not idempotency_key or len(idempotency_key) > 255 or len(task_text.encode()) > self._max_variable_bytes:
            raise ExternalAgentInvalidInputError("The request key or task text exceeds its limit.")
        validate_output_fields(outputs)
        asset = self._assets.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)
        if expected_generation != asset.test_display_generation:
            raise ExternalAgentConflictError("The saved configuration changed; reset the displayed test result.")
        references = self._files.references(
            context, agent_id=agent_id, page_session_id=page_session_id, lease_ids=input_lease_ids
        )
        execution = sha256(
            f"{context.active_workspace_id}:{context.account_id}:{agent_id}:{page_session_id}:"
            f"{expected_generation}:{idempotency_key}".encode()
        ).hexdigest()
        return self._runtime.start(
            self._scope(context),
            InvocationDraft(
                invocation_id=str(uuid5(NAMESPACE_URL, f"dify:external-test:{execution}")),
                agent_id=agent_id,
                identity=ExecutionIdentity(execution_id=execution, node_id="overview-test", frame_id="root"),
                message_id=str(uuid5(NAMESPACE_URL, f"dify:external-test-message:{execution}")),
                parts=({"text": task_text}, *references),
                declared_outputs=outputs,
                policy=policy,
                test_generation=expected_generation,
                job={"page_session_id": page_session_id, "input_lease_ids": list(input_lease_ids)},
            ),
        )

    def result(self, context: RequestContext, *, agent_id: str, invocation_id: str) -> ExternalTestResult:
        """Project the owned current-generation result and its logical statistics.

        Preconditions: the actor may test this asset and owns the anchored test.
        The selected latest Invocation pins the statistics read; independent
        tests and later retries cannot contribute to this response. No business
        work is submitted, and unavailable usage remains explicitly unknown.
        """
        self._admit(context, agent_id)
        result = self._runtime.logical_result(self._scope(context), invocation_id)
        # RuntimeScope contains the actor but the URL also pins the selected asset.
        if result.metadata.get("agent_id") != agent_id:
            from .contracts import ExternalAgentNotFoundError

            raise ExternalAgentNotFoundError("The requested test does not belong to this External Agent.")
        asset = self._assets.get_asset(tenant_id=context.active_workspace_id, agent_id=agent_id)
        if result.metadata.get("test_generation") != asset.test_display_generation:
            raise ExternalAgentConflictError("This result belongs to an earlier test display generation.")
        statistics = self._statistics.test_statistics(
            context, agent_id=agent_id, invocation_id=result.invocation_id, now=self._clock.now()
        )
        return ExternalTestResult(
            invocation_id=result.invocation_id,
            state=result.state,
            outputs=result.outputs,
            error_code=result.error_code,
            error_message=result.error_message,
            metadata=result.metadata,
            statistics=statistics,
        )

    def cancel(self, context: RequestContext, *, agent_id: str, invocation_id: str) -> Invocation:
        self._admit(context, agent_id)
        value = self._runtime.result(self._scope(context), invocation_id)
        if value.metadata.get("agent_id") != agent_id:
            from .contracts import ExternalAgentNotFoundError

            raise ExternalAgentNotFoundError("The requested test does not belong to this External Agent.")
        return self._runtime.cancel(self._scope(context), invocation_id)
