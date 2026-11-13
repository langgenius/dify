"""Isolated MySQL runtime/HTTP integration; this is not Console/browser E2E.

Run only after real migrations in a dedicated ``byoa_*`` MySQL database with
BYOA_MYSQL_ACCEPTANCE=1. Phases ``sql``, ``http_prepare`` and ``http_resume`` run
as separate processes. The last two use the normal application composition,
real SSRF-safe HTTPS gateway and owned storage; no Task receipt is injected.
The first phase seeds synthetic owners/assets solely for SQL fencing tests.
State/evidence contain synthetic IDs only. No shared fixture admin mutation is
used, and no existing deployment or data is deleted by this module.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import sessionmaker

from app_factory import create_app
from configs import dify_config
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from extensions.ext_storage import storage
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource
from models.external_agent import (
    ExternalAgentCommand,
    ExternalAgentConnectionRevision,
    ExternalAgentHead,
)
from models.model import UploadFile
from repositories.external_agents.runtime_repository import ExternalRuntimeRepository, context_slot_key
from services.external_agents.invocation_agg import ExternalInvocationAgg
from services.external_agents.io_contracts import FileBlob, OutputField
from services.external_agents.runtime_contracts import (
    CommandKind,
    ContextBusyError,
    ContextKey,
    ExecutionIdentity,
    Invocation,
    InvocationDraft,
    LocalState,
    RuntimeError,
    RuntimeScope,
    RuntimeSettings,
    SubmissionState,
    WaitPolicy,
)
from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.fixture_server import FILE_BYTES


def uid() -> str:
    """Allocate only synthetic identities; secrets never share this path."""
    return str(uuid4())


def present[T](value: T | None) -> T:
    """Require a successful typed repository result without unsafe casts."""
    if value is None:
        raise AcceptanceError("A required MySQL transaction did not admit its result.")
    return value


class MySQLAcceptance:
    """Drive actual MySQL transactions and product application ports in phases."""

    def __init__(self, phase: str) -> None:
        """Fail closed outside an explicitly enabled isolated MySQL database."""
        require(
            os.environ.get("BYOA_MYSQL_ACCEPTANCE") == "1", "Explicit isolated MySQL acceptance opt-in is required."
        )
        require(
            dify_config.DB_TYPE == "mysql" and dify_config.DB_DATABASE.startswith("byoa_"),
            "MySQL acceptance requires a dedicated byoa_* database.",
        )
        self.phase = phase
        self.state_path = Path(os.environ.get("BYOA_MYSQL_STATE", "/acceptance-evidence/mysql-state.json"))
        self.state = (
            json.loads(self.state_path.read_text()) if self.state_path.exists() else {"run_id": "mysql-" + uuid4().hex}
        )
        self.sessions = sessionmaker(db.engine, expire_on_commit=False)
        self.report: dict = {
            "run_id": self.state["run_id"],
            "phase": phase,
            "scope": "real MySQL SQL/runtime + real HTTPS gateway; not Console E2E",
            "checks": [],
            "started_at": datetime.now(UTC).isoformat(),
        }
        self.repo = ExternalRuntimeRepository(self.sessions, RuntimeSettings())

    def save_state(self) -> None:
        """Persist synthetic resume identities, never authentication or raw bodies."""
        self.state_path.write_text(json.dumps(self.state, indent=2) + "\n")

    def scope(self) -> RuntimeScope:
        """Reconstruct the test owner from its own prior seeded IDs."""
        return RuntimeScope(
            tenant_id=self.state["tenant_id"],
            initiator_id=self.state["account_id"],
            app_id=None,
            origin="overview_test",
        )

    def context(self) -> RequestContext:
        """Use an explicit server-side application principal for integration only."""
        return RequestContext(
            request_id=self.state["run_id"],
            trace_id=None,
            account_id=self.state["account_id"],
            active_workspace_id=self.state["tenant_id"],
        )

    def draft(self) -> InvocationDraft:
        """Create a DB-only intent without a fabricated success receipt."""
        return InvocationDraft(
            invocation_id=uid(),
            agent_id=self.state["seed_agent_id"],
            message_id=uid(),
            identity=ExecutionIdentity(execution_id=uid(), node_id="mysql-sql", frame_id="root"),
            parts=({"text": "DB-only crash/fencing probe; no business Send"},),
            test_generation=1,
            job={"page_session_id": "mysql-sql", "input_lease_ids": []},
        )

    def seed(self) -> None:
        """Create synthetic MySQL owners and an unexecuted SQL-fencing asset."""
        if "tenant_id" in self.state:
            return
        with self.sessions.begin() as session:
            tenant = Tenant(name="BYOA MySQL " + self.state["run_id"])
            account = Account(name="BYOA MySQL owner", email=self.state["run_id"] + "@acceptance.invalid")
            foreign = Tenant(name="BYOA MySQL foreign " + self.state["run_id"])
            foreign_account = Account(
                name="BYOA MySQL foreign", email=self.state["run_id"] + "-foreign@acceptance.invalid"
            )
            session.add_all((tenant, account, foreign, foreign_account))
            session.flush()
            session.add_all(
                (
                    TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
                    TenantAccountJoin(
                        tenant_id=foreign.id, account_id=foreign_account.id, role=TenantAccountRole.OWNER
                    ),
                )
            )
            agent = Agent(
                tenant_id=tenant.id,
                name="BYOA MySQL SQL-only asset",
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
                agent_kind=AgentKind.EXTERNAL_A2A,
            )
            session.add(agent)
            session.flush()
            revision = ExternalAgentConnectionRevision(
                id=uid(),
                tenant_id=tenant.id,
                agent_id=agent.id,
                endpoint="https://unexecuted.acceptance.invalid",
                interface_url="https://unexecuted.acceptance.invalid",
                auth_type="none",
                credential_ciphertext=None,
                agent_card={"defaultInputModes": ["text/plain"]},
                capabilities={},
                fingerprint="a" * 64,
                auth_check="not_exercised",
                created_by=account.id,
                verified_at=datetime.now(UTC).replace(tzinfo=None),
            )
            session.add(revision)
            session.add(
                ExternalAgentHead(agent_id=agent.id, tenant_id=tenant.id, active_connection_revision_id=revision.id)
            )
            self.state.update(
                tenant_id=tenant.id,
                account_id=account.id,
                foreign_tenant_id=foreign.id,
                foreign_account_id=foreign_account.id,
                seed_agent_id=agent.id,
                seed_revision_id=revision.id,
            )
        self.save_state()

    def sql(self) -> None:
        """Verify migrated InnoDB transactions, fencing and crash classification."""
        with self.sessions() as session:
            version, isolation = session.execute(text("SELECT VERSION(), @@transaction_isolation")).one()
            heads = list(session.scalars(text("SELECT version_num FROM alembic_version")))
        tables = inspect(db.engine).get_table_names()
        managed = [name for name in tables if name.startswith("external_agent") or name == "external_workflow_budgets"]
        require(
            "c3025a2a1109" in heads and len(managed) >= 17, "MySQL did not apply the real external-agent migration."
        )
        self.report.update(
            mysql_version=version, transaction_isolation=isolation, alembic_heads=heads, external_tables=managed
        )
        self.seed()
        scope, now = self.scope(), datetime.now(UTC).replace(microsecond=0)
        request = self.draft()
        first = self.repo.create(scope, request, now=now)
        duplicate = self.repo.create(scope, replace(request, invocation_id=uid(), message_id=uid()), now=now)
        require(first.id == duplicate.id, "MySQL unique execution admission created another Invocation.")
        foreign = replace(
            scope, tenant_id=self.state["foreign_tenant_id"], initiator_id=self.state["foreign_account_id"]
        )
        denied = False
        try:
            self.repo.get(foreign, first.id)
        except RuntimeError:
            denied = True
        require(denied, "MySQL repository exposed a foreign tenant's Invocation.")
        self.report["checks"].append("real_mysql_idempotent_intent_and_foreign_owner_fence")
        with ThreadPoolExecutor(max_workers=4) as workers:
            permits = list(workers.map(lambda _: self.repo.acquire_dispatch(scope, first.id, now=now), range(4)))
        winners = [value for value in permits if value is not None]
        require(len(winners) == 1, "Concurrent MySQL dispatch transactions admitted multiple permits.")
        permit = winners[0]
        with ThreadPoolExecutor(max_workers=4) as workers:
            marked = list(workers.map(lambda _: self.repo.begin_send(scope, permit, now=now), range(4)))
        entered = [value for value in marked if value is not None]
        require(len(entered) == 1, "Concurrent MySQL begin_send admitted more than one boundary crossing.")
        self.report["checks"].append("real_mysql_concurrent_permit_and_send_marker_single_winner")
        value = entered[0]
        changed = ExternalInvocationAgg(value, RuntimeSettings()).submission_failed(
            now, code="sql_crash_probe", message="Controlled DB-only interruption after send marker.", unknown=True
        )
        require(
            self.repo.save(scope, value, changed.invocation, commands=changed.commands),
            "MySQL CAS did not commit its owned failure transition.",
        )
        require(
            not self.repo.save(scope, value, changed.invocation, commands=changed.commands),
            "MySQL accepted a stale version CAS.",
        )
        require(self.repo.get(scope, value.id).outputs is None, "A DB-only failure probe manufactured business output.")
        self.report["checks"].append("real_mysql_stale_cas_rejected_no_output_resurrection")
        for entered_post in (False, True):
            queued = self.repo.create(scope, self.draft(), now=now)
            with self.sessions() as session:
                command_id = session.scalar(
                    select(ExternalAgentCommand.id).where(
                        ExternalAgentCommand.invocation_id == queued.id,
                        ExternalAgentCommand.kind == CommandKind.DISPATCH,
                    )
                )
                if not isinstance(command_id, str):
                    raise AcceptanceError("The MySQL intent has no persisted dispatch command.")
            lease = present(self.repo.lease_command(scope, command_id, now=now, lease_seconds=120))
            prepared = present(self.repo.acquire_dispatch(scope, queued.id, now=now))
            if entered_post:
                present(self.repo.begin_send(scope, prepared, now=now))
            require(
                self.repo.reconcile(scope, now=now + timedelta(seconds=119)) == 0,
                "MySQL recovery stole a still-live dispatch I/O lease.",
            )
            require(
                self.repo.reconcile(scope, now=now + timedelta(seconds=121)) == 1,
                "MySQL recovery did not close its expired orphan.",
            )
            recovered = self.repo.get(scope, queued.id)
            require(
                recovered.submission_state == (SubmissionState.UNKNOWN if entered_post else SubmissionState.REJECTED)
                and recovered.outputs is None
                and recovered.local_state == LocalState.FAILED,
                "MySQL crash recovery confused pre-POST rejection and unknown acceptance.",
            )
            require(
                self.repo.acquire_dispatch(scope, queued.id, now=now + timedelta(seconds=122)) is None,
                "MySQL recovery reopened a business dispatch permit.",
            )
            self.repo.complete_command(lease)
        self.report["checks"].append("real_mysql_preparation_vs_post_marker_recovery_without_replay")
        key = ContextKey(
            tenant_id=scope.tenant_id,
            app_id=uid(),
            conversation_id=uid(),
            node_id="mysql-frame",
            agent_id=self.state["seed_agent_id"],
            connection_revision_id=self.state["seed_revision_id"],
            binding_epoch=uid(),
        )
        with self.sessions.begin() as session:
            slot = self.repo._reserve(session, key, "mysql-first")
            self.repo._settle_slot(slot, None, terminal=False, unresolved=True)
        with self.sessions.begin() as session:
            busy = False
            try:
                self.repo._reserve(session, key, "mysql-second")
            except ContextBusyError:
                busy = True
            require(busy, "MySQL released an unresolved remote context reservation.")
            other = self.repo._reserve(session, replace(key, frame_scope="other-frame"), "mysql-parallel")
            require(other.key != context_slot_key(key), "MySQL merged different frame context slots.")
        self.report["checks"].append("real_mysql_unresolved_busy_and_parallel_frame_slot_isolation")
        self.report.update(
            business_sends=0,
            note="SQL crash probes cross persisted markers without sending; they never create success receipts.",
        )

    def fixture_messages(self) -> list[dict]:
        """Read only peer observations for this runner's exact random run marker."""
        with httpx.Client(
            verify=ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE")), trust_env=False, timeout=10
        ) as client:
            response = client.get(
                os.environ.get("BYOA_FIXTURE_PUBLIC_URL", "https://byoa-fixture").rstrip("/") + "/admin/stats"
            )
            require(response.status_code == 200, "MySQL runner cannot observe its real HTTPS peer.")
            return [item for item in response.json()["messages"].values() if item.get("run") == self.state["run_id"]]

    def start(
        self,
        scenario: str,
        *,
        fields: tuple[OutputField, ...] = (OutputField(name="text", kind="string"),),
        leases: tuple[str, ...] = (),
        page: str = "mysql-http",
    ) -> str:
        """Admit a real saved-configuration test through the production application port."""
        services = application_services().external_agents
        detail = services.assets.detail(self.context(), self.state["http_agent_id"])
        value = services.tests.start(
            self.context(),
            agent_id=self.state["http_agent_id"],
            page_session_id=page,
            expected_generation=detail["asset"]["test_display_generation"],
            idempotency_key=uid(),
            task_text=f"[byoa:{scenario}:{self.state['run_id']}] MySQL runtime integration",
            input_lease_ids=leases,
            outputs=fields,
            policy=WaitPolicy(),
        )
        return value.id

    def drain(self, identifier: str, *, accepted_only: bool = False, cancel_only: bool = False) -> Invocation:
        """Run persisted due commands synchronously through the real runtime adapter.

        This deliberately replaces only the process scheduler, not the SQL,
        gateway, normalizer, File adapter or receipt. Every result is persisted
        by the unchanged application service, with its real command lease/CAS.
        """
        services = application_services().external_agents
        deadline = time.monotonic() + 90
        value = services.repository.get(self.scope(), identifier)
        while time.monotonic() < deadline:
            with self.sessions() as session:
                ids = list(
                    session.scalars(
                        select(ExternalAgentCommand.id).where(
                            ExternalAgentCommand.invocation_id == identifier,
                            ExternalAgentCommand.state == "ready",
                            ExternalAgentCommand.next_run_at <= datetime.now(UTC).replace(tzinfo=None),
                        )
                    )
                )
            for command in ids:
                services.runtime.run_command(self.scope(), command)
            value = services.repository.get(self.scope(), identifier)
            if (
                (accepted_only and value.remote_task_id)
                or (cancel_only and value.cancel_state.value == "confirmed")
                or (not accepted_only and not cancel_only and value.local_state != LocalState.WAITING)
            ):
                return value
            time.sleep(0.25)
        raise AcceptanceError("MySQL persisted command execution exceeded its real I/O time bound.")

    def http_prepare(self) -> None:
        """Use real Verify/Save and persist a known Task for a fresh-process resume."""
        services = application_services().external_agents
        evidence = services.assets.verify(
            self.context(),
            endpoint=os.environ.get("BYOA_FIXTURE_PUBLIC_URL", "https://byoa-fixture"),
            auth_type="none",
            credential_action="remove",
            credential=None,
            agent_id=None,
            expected_connection_revision_id=None,
        )
        saved = services.assets.create(
            self.context(),
            verification_id=evidence.id,
            metadata={"name": "BYOA MySQL HTTP " + self.state["run_id"]},
            operation_key=uid(),
        )
        self.state["http_agent_id"] = saved.resource_id
        require(not self.fixture_messages(), "MySQL Verify/Save dispatched business work.")
        direct = self.drain(self.start("direct"))
        require(
            direct.local_state == LocalState.SUCCEEDED and direct.outputs == {"text": "direct ok"},
            "MySQL direct Message mapping failed.",
        )
        working = self.start("working")
        known = self.drain(working, accepted_only=True)
        require(
            known.remote_task_id and known.submission_state == SubmissionState.ACCEPTED,
            "MySQL did not durably preserve the real Task receipt.",
        )
        self.state["resume_invocation_id"] = known.id
        self.state["resume_task_id"] = known.remote_task_id
        self.state["resume_message_id"] = known.message_id
        self.save_state()
        self.report["checks"].append("mysql_real_verify_save_message_and_persisted_known_task")

    def query_fences(self, invocation: Invocation) -> None:
        """Exercise real MySQL POLL/CANCEL exclusion and stale I/O-lease fencing.

        The Task identity was obtained from actual HTTPS. This SQL-only permit
        probe does not claim a query was sent; the subsequent Cancel still uses
        the unchanged runtime and real peer response.
        """
        with self.sessions() as session:
            rows = list(
                session.scalars(
                    select(ExternalAgentCommand).where(
                        ExternalAgentCommand.invocation_id == invocation.id,
                        ExternalAgentCommand.kind.in_((CommandKind.POLL, CommandKind.CANCEL)),
                        ExternalAgentCommand.state == "ready",
                    )
                )
            )
            by_kind = {row.kind: row for row in rows}
            require(
                CommandKind.POLL in by_kind and CommandKind.CANCEL in by_kind,
                "Known MySQL Task has no real poll/cancel commands.",
            )
            now = max(datetime.now(UTC), *(row.next_run_at.replace(tzinfo=UTC) for row in rows)) + timedelta(seconds=1)
            poll, cancel = by_kind[CommandKind.POLL].id, by_kind[CommandKind.CANCEL].id
        first = present(self.repo.lease_command(self.scope(), poll, now=now, lease_seconds=120))
        require(
            self.repo.lease_command(self.scope(), cancel, now=now, lease_seconds=120) is None,
            "MySQL admitted two simultaneous I/O commands for one Task.",
        )
        newer = present(
            self.repo.lease_command(self.scope(), poll, now=now + timedelta(seconds=121), lease_seconds=120)
        )
        require(newer.fence != first.fence, "MySQL expired command did not advance its I/O fence.")
        self.repo.complete_command(first)
        with self.sessions() as session:
            row = session.get(ExternalAgentCommand, poll)
            require(
                row is not None and row.state == "leased" and row.fence == newer.fence,
                "An expired MySQL worker finished another worker's lease.",
            )
        self.repo.complete_command(newer)
        self.report["checks"].append("mysql_real_known_task_poll_cancel_exclusion_and_stale_lease_completion_fence")

    def http_resume(self) -> None:
        """Resume the original peer Task after process exit, then cover real files/cancel."""
        services = application_services().external_agents
        known = services.repository.get(self.scope(), self.state["resume_invocation_id"])
        require(
            known.remote_task_id == self.state["resume_task_id"], "A fresh process lost the known MySQL Task identity."
        )
        complete = self.drain(known.id)
        require(
            complete.local_state == LocalState.SUCCEEDED
            and complete.remote_task_id == known.remote_task_id
            and complete.outputs == {"text": "task ok"},
            "MySQL resumed by resending or consumed another Task's result.",
        )
        self.report["checks"].append("mysql_fresh_process_get_task_resume_same_identity_no_send_replay")
        page = "mysql-file-" + self.state["run_id"]
        content = b"MySQL real owned file bytes\n"
        uploaded = services.tests.upload(
            self.context(),
            agent_id=self.state["http_agent_id"],
            page_session_id=page,
            blob=FileBlob(filename="mysql.txt", media_type="text/plain", data=content),
        )
        fields = (
            OutputField(name="text", kind="string"),
            OutputField(name="file_count", kind="number"),
            OutputField(name="total_bytes", kind="number"),
        )
        input_result = self.drain(self.start("file-input", fields=fields, leases=(uploaded.lease_id,), page=page))
        require(
            input_result.outputs == {"text": "file input ok", "file_count": 1, "total_bytes": len(content)},
            "MySQL input lease/read/gateway path lost file bytes.",
        )
        output = self.drain(self.start("file-output", fields=(OutputField(name="report", kind="file"),)))
        require(output.local_state == LocalState.SUCCEEDED, "MySQL file output did not complete.")
        outputs = output.outputs
        if not isinstance(outputs, dict):
            raise AcceptanceError("MySQL file output has no stored values.")
        file = outputs.get("report")
        if not isinstance(file, dict):
            raise AcceptanceError("MySQL file output is not a stored trusted File.")
        file_id = file.get("upload_file_id")
        if not isinstance(file_id, str):
            raise AcceptanceError("MySQL file output has no materialized file ID.")
        with self.sessions() as session:
            row = session.get(UploadFile, file_id)
            if row is None:
                raise AcceptanceError("MySQL did not persist the output UploadFile record.")
            require(
                row.tenant_id == self.scope().tenant_id and row.size == len(FILE_BYTES),
                "MySQL materialized the File under another owner.",
            )
            require(storage.load_once(row.key) == FILE_BYTES, "MySQL output File bytes were not durably stored.")
        self.report["checks"].append("mysql_real_input_leases_and_durable_output_file_storage")
        held = self.drain(self.start("hold"), accepted_only=True)
        services.runtime.cancel(self.scope(), held.id)
        self.query_fences(held)
        canceled = self.drain(held.id, cancel_only=True)
        require(
            canceled.cancel_state.value == "confirmed"
            and canceled.remote_state == "canceled"
            and canceled.outputs is None,
            "MySQL cancellation did not confirm the actual old peer Task.",
        )
        unknown = self.drain(self.start("unknown"))
        require(
            unknown.submission_state == SubmissionState.UNKNOWN
            and unknown.remote_task_id is None
            and unknown.outputs is None,
            "MySQL manufactured a receipt after response loss.",
        )
        services.runtime.reconcile(self.scope())
        messages = self.fixture_messages()
        require(
            len(messages) == 6 and all(item["sends"] == 1 for item in messages),
            "MySQL recovery/output/cancel replayed business Send.",
        )
        received = [item for item in messages if item["scenario"] == "file-input"]
        require(
            len(received) == 1 and received[0]["input_files"][0]["sha256"] == hashlib.sha256(content).hexdigest(),
            "MySQL persisted File input changed before the real peer received it.",
        )
        self.report["checks"].append("mysql_real_confirmed_cancel_and_unknown_response_no_replay")
        foreign_scope = replace(
            self.scope(), tenant_id=self.state["foreign_tenant_id"], initiator_id=self.state["foreign_account_id"]
        )
        denied = False
        try:
            services.repository.get(foreign_scope, output.id)
        except RuntimeError:
            denied = True
        require(denied, "MySQL owner chain exposed a real output Invocation across tenants.")
        self.report.update(
            business_sends=len(messages),
            resume_invocation_id=known.id,
            resumed_task_id=known.remote_task_id,
            input_invocation_id=input_result.id,
            output_invocation_id=output.id,
            canceled_invocation_id=held.id,
            unknown_invocation_id=unknown.id,
        )

    def run(self) -> dict:
        """Run only the explicitly selected phase and preserve exact evidence."""
        if self.phase == "sql":
            self.sql()
        elif self.phase == "http_prepare":
            self.http_prepare()
        else:
            self.http_resume()
        self.report.update(result="passed", finished_at=datetime.now(UTC).isoformat())
        return self.report


def main() -> None:
    """Create a real application process and emit no credentials on failure."""
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("sql", "http_prepare", "http_resume"))
    phase = parser.parse_args().phase
    _, app = create_app()
    with app.app_context():
        runner = MySQLAcceptance(phase)
        try:
            report = runner.run()
        except Exception as error:
            report = {
                **runner.report,
                "result": "failed",
                "error": str(error) if isinstance(error, AcceptanceError) else type(error).__name__,
            }
        encoded = json.dumps(report, indent=2, default=str)
        Path(os.environ.get("BYOA_MYSQL_OUTPUT", f"/acceptance-evidence/mysql-{phase}.json")).write_text(encoded + "\n")
        print(encoded)
        if report["result"] != "passed":
            raise SystemExit(1)


if __name__ == "__main__":
    main()
