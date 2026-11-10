"""Retained Code participants bound to the actual C02 call and root lifetime.

These owners install no Code profile. Trusted future composition supplies a
qualified endpoint, immutable scope/environment and prepared intent. An HTTP
profile runtime does not construct this owner or query the Code table.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from math import isfinite
from time import monotonic
from uuid import uuid4

from sqlalchemy import select

from models.dify_builder_native_code import NativeCodePhysicalOperation
from runtime_contracts.builder.execution import canonical_digest
from services.code_execution.native_scope_transport import (
    NativeCodeIdentity,
    NativeScopeCodeExecutionTransport,
)
from services.dify_builder.native_testing.sandbox.contracts import CodeAcquisitionRef
from services.dify_builder.native_testing.sandbox.repository import (
    NativeCodePhysicalRepository,
)
from services.dify_builder.native_testing.sandbox.scope_client import (
    CodeHttpRequest,
    CodeOriginHttp,
    NativeCodeScopeClient,
)
from services.dify_builder.native_testing.sandbox.sync_bridge import (
    NativeCodeLoopBridge,
)


class NativeCodeHostOwner:
    def __init__(self, *, host, loader):
        from services.dify_builder.native_testing.host_execution import NativeHostLaunch

        if type(host) is not NativeHostLaunch or host.lifetime.context.parent_invocation_id is not None:
            raise ValueError("native_code_root_required")
        self.host = host
        self.acquisition = CodeAcquisitionRef(
            ref=host.lifetime.ref,
            root_dispatch_id=host.lifetime.dispatch_id,
            generation=host.lifetime.generation,
            acquisition_id=str(uuid4()),
        )
        self._loader = loader
        self._operations = {}
        host.lifetime.bind_code_owner(owner=self)

    def check_current(self, acquisition):
        if acquisition != self.acquisition:
            raise ValueError("native_code_acquisition_mismatch")
        self.host.lifetime.check_code_current()

    def register(self, *, ticket, operation_id, deadline, close_deadline, **phases):
        self.check_current(self.acquisition)
        if operation_id in self._operations:
            raise ValueError("native_code_operation_replayed")
        participant = NativeCodeHostOperation(owner=self, deadline=deadline, close_deadline=close_deadline, **phases)
        self.host.lifetime.register_code(ticket=ticket, participant=participant)
        self._operations[operation_id] = participant
        return participant

    def validate_cleanup_rows(self, *, session, ref, tenant_id, dispatch_id, generation):
        # Called in each existing SQL check; local consume remains between them.
        # Do not call currentness here: the second check follows exact consumption.
        if (ref, dispatch_id, generation) != (
            self.acquisition.ref,
            self.acquisition.root_dispatch_id,
            self.acquisition.generation,
        ):
            raise ValueError("native_code_cleanup_owner_mismatch")
        rows = session.scalars(
            select(NativeCodePhysicalOperation).where(
                NativeCodePhysicalOperation.tenant_id == tenant_id,
                NativeCodePhysicalOperation.request_id == ref.request_id,
                NativeCodePhysicalOperation.host_dispatch_id == dispatch_id,
            )
        ).all()
        for row in rows:
            if (
                row.host_acquisition_id != self.acquisition.acquisition_id
                or row.host_generation != generation
                or row.destroyed_at is None
            ):
                raise ValueError("native_code_cleanup_unproven")


class NativeCodeHostOperation:
    """Retained before reservation; only observed destruction + exit can finish it."""

    def __init__(self, *, owner: NativeCodeHostOwner, deadline, close_deadline, **phases):
        self.owner = owner
        self.bridge = NativeCodeLoopBridge(
            deadline=deadline,
            close_deadline=close_deadline,
            service=self._service,
            **phases,
        )
        self.physical = None
        self._bound = None
        self._http = None
        self._client = None
        self._destroyed = False
        self._attempted = False
        self._settlement_started = False
        self.repository = NativeCodePhysicalRepository(
            owner._loader,
            acquisition_owner=owner,
            transaction_deadline=self._transaction_deadline,
        )

    def _transaction_deadline(self, settlement):
        self.owner.check_current(self.owner.acquisition)
        deadline = self.bridge.close_deadline if settlement else self.bridge.deadline
        if not settlement and not self.bridge._created:
            deadline = min(deadline, self.bridge.create_deadline)
        root_deadline = self.owner.host.settlement_deadline
        return min(deadline, root_deadline) if root_deadline is not None else deadline

    @property
    def cleanup_complete(self):
        return (
            self._destroyed
            and self.bridge.joined
            and self.bridge.loop_closed
            and self._client is not None
            and all(client.closed for client in self._client.clients)
        )

    def request_close(self, *, deadline):
        self.bridge.cancel(deadline=deadline)

    def refresh_join(self):
        self.bridge.refresh_join()

    def _identity(self, identity):
        physical = self.physical
        if physical is None or identity != NativeCodeIdentity(
            physical.operation_id, physical.scope_id, physical.scope_generation
        ):
            raise ValueError("native_code_identity_mismatch")
        return physical

    def _service(self, kind, payload):
        owner, repo = self.owner, self.repository
        owner.check_current(owner.acquisition)
        physical = self.physical
        if physical is None:
            raise ValueError("native_code_reservation_missing")
        settlement = kind in ("unknown", "destroyed") or (
            kind == "http" and type(payload) is CodeHttpRequest and payload.method == "DELETE"
        )
        if not settlement:
            owner.host.lifetime.check_code_current(admission=True)
        if kind in ("http", "create"):
            if type(payload) is not CodeHttpRequest or self._http is None:
                raise ValueError("native_code_http_invalid")
            self._http.deadline = self.bridge.close_deadline if settlement else self.bridge.deadline
            if kind == "create":
                self._http.deadline = min(self._http.deadline, self.bridge.create_deadline)
            return self._http.request(payload)
        if kind == "scope_ack":
            scope_id, generation = payload
            repo.ack_scope(physical=physical, scope_id=scope_id, generation=generation)
            self.bridge.created()
            return None
        if kind == "offset":
            job_id, expected_offset, next_offset = payload
            return repo.observe_output(
                physical=physical,
                job_id=job_id,
                expected_offset=expected_offset,
                next_offset=next_offset,
            )
        if kind == "destroyed":
            self._identity(payload)
            repo.ack_destroyed(physical=physical)
            observed = repo.load_for_settlement(
                ref=physical.ref,
                operation_id=physical.operation_id,
                acquisition=owner.acquisition,
            )
            if observed.destroyed_at is None:
                raise ValueError("native_code_destruction_unobserved")
            if observed.scope_id != physical.scope_id or observed.scope_generation != physical.scope_generation:
                raise ValueError("native_code_destruction_mismatch")
            self._destroyed = True
            return None
        bound = self._bound
        if bound is None:
            raise ValueError("native_code_claim_missing")
        if kind == "check":
            bound.assert_claim(payload)
        elif kind == "reserve_job":
            identity, payload_digest, profile_digest = payload
            bound.reserve_dispatch(identity, payload_digest=payload_digest, profile_digest=profile_digest)
        elif kind == "associate":
            identity, job_id = payload
            bound.associate_job(identity, job_id)
        elif kind == "unknown":
            owner.host.lifetime.mark_unknown()
            bound.mark_unknown(payload)
        else:
            raise ValueError("native_code_mailbox_kind_invalid")

    # These adapter ports run on the native thread, and only marshal data.
    def assert_claim(self, identity):
        self.bridge.call("check", identity)

    def check_current(self, identity):
        self.bridge.call("check", identity)

    def reserve_dispatch(self, identity, *, payload_digest, profile_digest):
        self.bridge.call("reserve_job", (identity, payload_digest, profile_digest))

    def associate_job(self, identity, job_id):
        self.bridge.call("associate", (identity, job_id))

    def mark_unknown(self, identity):
        self.bridge.call("unknown", identity, settlement=True)

    async def settle(self, identity, *, succeeded):
        self._identity(identity)
        if self._settlement_started:
            raise ValueError("native_code_settlement_reentered")
        self._settlement_started = True
        self.bridge.begin_settlement()
        try:
            try:
                if not succeeded:
                    self.mark_unknown(identity)
            finally:
                # Failed ambiguity persistence must not suppress exact teardown.
                client = self._client
                if client is None:
                    raise ValueError("native_code_scope_client_missing")
                await client.destroy(identity.scope_id, identity.generation)
                self.bridge.call("destroyed", identity, settlement=True)
        except BaseException:
            self.mark_unknown(identity)
            raise


class HostNativeCodeTransport:
    """One transformed payload, one reservation, one owned scope-create attempt."""

    def __init__(
        self,
        *,
        owner,
        calls,
        ref,
        intent,
        permit,
        spec,
        profile,
        bounds,
        endpoint,
        auth_token,
        create_seconds,
        join_seconds,
    ):
        self.owner, self.calls, self.ref, self.intent, self.permit = (
            owner,
            calls,
            ref,
            intent,
            permit,
        )
        self.spec, self.profile, self.bounds = spec, profile, bounds
        self.endpoint, self.auth_token = endpoint, auth_token
        if (
            any(type(x) not in (int, float) or not isfinite(x) or x <= 0 for x in (create_seconds, join_seconds))
            or create_seconds > 5
            or join_seconds > 1
        ):
            raise ValueError("native_code_budget_invalid")
        self.create_seconds, self.join_seconds = create_seconds, join_seconds
        self._used = False

    def execute(self, *, language, preload, code):
        if self._used:
            raise ValueError("native_code_transport_replayed")
        self._used = True
        owner, spec, bounds = self.owner, self.spec, self.bounds
        owner.check_current(owner.acquisition)
        ticket = self.calls.ticket(permit=self.permit)
        # Bracket UTC: the earlier monotonic sample bounds UTC->monotonic;
        # the later sample bounds monotonic->UTC. Sampling delay earns no time.
        now = monotonic()
        utc_anchor = datetime.now(UTC)
        sampled = monotonic()
        authority = min(spec.native.deadline, datetime.fromisoformat(self.permit.expires_at))
        remaining = (authority - utc_anchor).total_seconds()
        allowance = min(
            remaining,
            self.create_seconds + bounds.timeout_seconds + 2 * bounds.close_seconds + self.join_seconds,
            self.calls._allowance,
            30.0,
            spec.native.limits.wall_seconds,
        )
        join_deadline = now + allowance
        if owner.host.settlement_deadline is not None:
            join_deadline = min(join_deadline, owner.host.settlement_deadline)
        close_deadline = join_deadline - self.join_seconds
        deadline = min(
            now + self.create_seconds + bounds.timeout_seconds,
            close_deadline - 2 * bounds.close_seconds,
        )
        create_deadline = min(now + self.create_seconds, deadline)
        if deadline <= now:
            raise ValueError("native_code_budget_expired")
        payload_digest = hashlib.sha256(
            (
                json.dumps(
                    {"preload": preload, "code": code},
                    ensure_ascii=True,
                    separators=(",", ":"),
                )
                + "\n"
            ).encode()
        ).hexdigest()
        profile_digest = hashlib.sha256(
            json.dumps(
                {
                    "language": self.profile.language,
                    "executable": self.profile.executable,
                    "environment_digest": self.profile.environment_digest,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if language != self.profile.language or spec.environment_digest != self.profile.environment_digest:
            raise ValueError("native_code_profile_mismatch")
        operation = owner.register(
            ticket=ticket,
            operation_id=self.permit.operation_id,
            deadline=deadline,
            close_deadline=close_deadline,
            create_deadline=create_deadline,
            execution_seconds=bounds.timeout_seconds,
            join_deadline=join_deadline,
            join_seconds=self.join_seconds,
            settlement_seconds=bounds.close_seconds,
        )
        physical_deadline = utc_anchor + timedelta(seconds=join_deadline - sampled)
        try:
            operation.physical = operation.repository.reserve_scope(
                ref=self.ref,
                key=self.intent.key,
                permit=self.permit,
                acquisition=owner.acquisition,
                spec=spec,
                intent=self.intent,
                payload_digest=payload_digest,
                profile_digest=profile_digest,
                physical_deadline=physical_deadline,
            )
            physical = operation.physical
            wire = spec.native.model_copy(update={"deadline": physical.scope_expires_at})
            if (
                physical.scope_expires_at > physical_deadline
                or canonical_digest(wire.model_dump(mode="json")) != physical.scope_spec_digest
            ):
                raise ValueError("native_code_wire_spec_mismatch")
            # Use the persisted value and the ORIGINAL clock pair. SQL elapsed
            # time never earns new phase allowance, nor can a tighter root claim
            # consume either cleanup phase or the real handle-join reserve.
            join_deadline = min(
                join_deadline,
                now + (physical.scope_expires_at - utc_anchor).total_seconds(),
            )
            close_deadline = min(close_deadline, join_deadline - self.join_seconds)
            deadline = min(deadline, close_deadline - 2 * bounds.close_seconds)
            create_deadline = min(create_deadline, deadline)
            operation.bridge.join_deadline = join_deadline
            operation.bridge.close_deadline = close_deadline
            operation.bridge.deadline = deadline
            operation.bridge.create_deadline = create_deadline
            if monotonic() >= create_deadline:
                raise ValueError("native_code_budget_expired")
            operation._bound = operation.repository.bind(
                physical=operation.physical, intent=self.intent, permit=self.permit
            )
            operation._http = CodeOriginHttp(
                endpoint=self.endpoint,
                scope_id=spec.native.scope_id,
                generation=1,
                token=self.auth_token,
                deadline=close_deadline,
                max_bytes=min(
                    16 * 1024 * 1024,
                    max(bounds.input_bytes, bounds.output_bytes) * 8 + 4096,
                ),
            )
            operation._client = NativeCodeScopeClient(
                endpoint=self.endpoint,
                auth_token=self.auth_token,
                bridge=operation.bridge,
                output_bytes=bounds.output_bytes,
            )
            identity = NativeCodeIdentity(operation.physical.operation_id, spec.native.scope_id, 1)
            adapter = NativeScopeCodeExecutionTransport(
                identity=identity,
                profile=self.profile,
                bounds=bounds,
                scope_client=operation._client,
                durable_owner=operation,
                lifetime_owner=operation,
                sync_owner=None,
            )

            async def execute():
                try:
                    operation.check_current(identity)
                    handle = await operation._client.create(wire)
                    operation.bridge.call("scope_ack", (handle.scope_id, handle.generation))
                    return await adapter.execute_async(language=language, preload=preload, code=code)
                finally:
                    # Includes scope-create ACK loss and adapter job-reservation
                    # refusal, before the adapter owns its own cleanup task.
                    if not operation._settlement_started:
                        cleanup = asyncio.create_task(operation.settle(identity, succeeded=False))
                        while not cleanup.done():
                            with suppress(asyncio.CancelledError):
                                await asyncio.shield(cleanup)
                        cleanup.result()

            return operation.bridge.run(execute)
        except BaseException:
            owner.host.lifetime.mark_unknown()
            if operation.physical is not None:
                # Retained participant cannot confer cleanup on lost ACK.
                with suppress(Exception):
                    operation.repository.mark_unknown(physical=operation.physical)
            raise
