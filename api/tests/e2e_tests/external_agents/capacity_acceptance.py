"""Bounded, isolated PostgreSQL query-lease acceptance: prepare/exercise/cleanup.

prepare/cleanup use the real Console API and verified HTTPS fixture. Owner uses
DIFY_TEST_*; foreign_owner comes from BYOA_TEST_ACTORS_JSON (email/password).
Optional BYOA_CAPACITY_ENDPOINTS_JSON contains five complete Card URLs; defaults
are BYOA_FIXTURE_PUBLIC_URL/capacity-{1..5}/.well-known/agent-card.json.

Run prepare while the dedicated worker is live. The operator then gracefully
stops that worker, runs exercise in the API container with its real environment,
restarts the worker, and runs cleanup. This tool never starts/stops workers,
changes source deployment configuration, executes leased I/O, or sends load to
unrelated records. Exercise uses ApplicationServices and real PostgreSQL SQL
transactions, not a replacement repository or clock. It returns only leases it
obtained, using their exact scope/command/fence and incrementing the fence.

Set BYOA_CAPACITY_STATE for the shared ID-only phase file; prepare can generate
one under /tmp. BYOA_CAPACITY_OUTPUT optionally selects the phase report path.
Both paths are printed as BYOA_CAPACITY_* assignments. No credentials/cookies,
HTTP bodies, endpoints, or raw runtime snapshots enter either artifact.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require


def save(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    temporary.replace(path)


def state_path(*, prepare: bool = False) -> Path:
    configured = os.environ.get("BYOA_CAPACITY_STATE")
    require(configured or prepare, "Set BYOA_CAPACITY_STATE to the prepare artifact.")
    return Path(configured or f"/tmp/byoa-capacity-{uuid4().hex}.json")


def load(path: Path) -> dict:
    value = json.loads(path.read_text())
    require(isinstance(value, dict) and value.get("version") == 1, "Unsupported capacity phase state.")
    require(isinstance(value.get("run_id"), str) and len(value["run_id"]) == 32, "Missing capacity run identity.")
    require(isinstance(value.get("actors"), dict) and isinstance(value.get("calls"), list), "Invalid phase identities.")
    return value


def actors(state: dict) -> dict[str, ConsoleAcceptance]:
    configured = json.loads(os.environ.get("BYOA_TEST_ACTORS_JSON", "{}"))
    foreign = configured.get("foreign_owner", {})
    require(
        isinstance(foreign.get("email"), str) and isinstance(foreign.get("password"), str),
        "Configure foreign_owner credentials in BYOA_TEST_ACTORS_JSON.",
    )
    result = {
        "owner": ConsoleAcceptance(),
        "foreign_owner": ConsoleAcceptance(email=foreign["email"], password=foreign["password"]),
    }
    try:
        for label, actor in result.items():
            actor.run_id = state["run_id"]
            actor.login()
            summary = actor.call("GET", "/workspaces/current/summary")
            profile = actor.call("GET", "/account/profile")
            require(summary["role"] == "owner", "Capacity actors must own their isolated workspaces.")
            scope = {
                "tenant_id": summary["id"],
                "initiator_id": profile["id"],
                "app_id": None,
                "origin": "overview_test",
                "actor_role": "account",
            }
            previous = state["actors"].get(label)
            require(previous is None or previous == scope, "Actor identity/workspace changed between phases.")
            state["actors"][label] = scope
        require(
            state["actors"]["owner"]["tenant_id"] != state["actors"]["foreign_owner"]["tenant_id"],
            "The foreign actor must own a different workspace.",
        )
        return result
    except BaseException:
        for actor in result.values():
            actor.close()
        raise


def prepare(path: Path, state: dict) -> dict:
    require(
        not path.exists() or path.stat().st_size == 0,
        "The prepare state already exists; clean up that run before preparing another.",
    )
    clients = actors(state)
    save(path, state)
    try:
        owner = clients["owner"]
        endpoints = (
            json.loads(os.environ["BYOA_CAPACITY_ENDPOINTS_JSON"])
            if os.environ.get("BYOA_CAPACITY_ENDPOINTS_JSON")
            else [f"{owner.fixture}/capacity-{index}/.well-known/agent-card.json" for index in range(1, 6)]
        )
        require(
            isinstance(endpoints, list)
            and len(endpoints) == 5
            and len(set(endpoints)) == 5
            and all(isinstance(url, str) and url.startswith("https://") for url in endpoints),
            "Configure exactly five distinct verified-HTTPS Card endpoints.",
        )
        for label, actor in clients.items():
            groups = range(5) if label == "owner" else range(1)
            for group in groups:
                actor.phase = "capacity_verify"
                verified = actor.call(
                    "POST",
                    "/external-agents/verify",
                    json={"endpoint": endpoints[group], "auth_type": "none", "credential_action": "remove"},
                )
                actor.phase = "capacity_create_asset"
                created = actor.call(
                    "POST",
                    "/external-agents",
                    expected=(201,),
                    json={
                        "verification_id": verified["verification_id"],
                        "idempotency_key": str(uuid4()),
                        "metadata": {"name": f"BYOA capacity {state['run_id']} {label} endpoint-{group}"},
                    },
                )
                asset = created["resource_id"]
                state["assets"].append({"actor": label, "endpoint_group": group, "agent_id": asset})
                save(path, state)
                for index in range(6 if label == "owner" else 5):
                    tag = f"capacity-{state['run_id']}-{label}-{group}-{index}"
                    detail = actor.call("GET", f"/external-agents/{asset}")
                    actor.phase = "capacity_start_hold"
                    started = actor.call(
                        "POST",
                        f"/external-agents/{asset}/tests",
                        expected=(202,),
                        json={
                            "page_session_id": tag,
                            "expected_generation": detail["asset"]["test_display_generation"],
                            "idempotency_key": tag,
                            "task_text": f"[byoa:hold:{tag}] Isolated capacity admission",
                            "input_lease_ids": [],
                            "outputs": [{"name": "text", "kind": "string"}],
                            "policy": {
                                "wait_seconds": None,
                                "on_timeout": "end_waiting",
                                "additional_retries": 0,
                                "retry_interval_seconds": 5,
                            },
                        },
                    )
                    state["calls"].append(
                        {
                            "actor": label,
                            "endpoint_group": group,
                            "agent_id": asset,
                            "invocation_id": started["invocation_id"],
                            "page_session_id": tag,
                        }
                    )
                    save(path, state)
        deadline = time.monotonic() + owner.timeout
        pending = list(state["calls"])
        while pending and time.monotonic() < deadline:
            remaining = []
            for call in pending:
                actor = clients[call["actor"]]
                actor.phase = "capacity_wait_known_task"
                value = actor.call("GET", f"/external-agents/{call['agent_id']}/tests/{call['invocation_id']}")
                task = value["metadata"].get("external_task_id")
                if task:
                    call["task_id"] = task
                else:
                    require(
                        value["state"] not in {"failed", "ended", "stopped", "succeeded"},
                        "A capacity hold ended without a known server Task.",
                    )
                    remaining.append(call)
            pending = remaining
            save(path, state)
            if pending:
                time.sleep(0.5)
        require(not pending, "Capacity preparation timed out waiting for all server Tasks.")
        snapshot = owner.stats()
        for call in state["calls"]:
            task = snapshot["tasks"].get(call["task_id"], {})
            own_messages = [
                (identifier, message)
                for identifier, message in snapshot["messages"].items()
                if message["run"] == call["page_session_id"] and message["scenario"] == "hold"
            ]
            require(
                task.get("state") == "TASK_STATE_WORKING" and len(own_messages) == 1,
                "The fixture did not confirm a unique working capacity Task.",
            )
            require(
                own_messages[0][1]["sends"] == 1 and task["message_id"] == own_messages[0][0],
                "Capacity preparation duplicated or misassociated a business send.",
            )
            call["message_id"] = own_messages[0][0]
        require(len(state["calls"]) == 35, "Capacity preparation did not create the required 30+5 Tasks.")
        state["prepared"] = True
        save(path, state)
        return {
            "result": "passed",
            "known_tasks": 35,
            "owner_tasks": 30,
            "foreign_owner_tasks": 5,
            "next_step": "Gracefully stop only the dedicated worker, then run exercise in the API container.",
        }
    finally:
        for actor in clients.values():
            actor.close()


def exercise(path: Path, state: dict) -> dict:
    from sqlalchemy import func, or_, select, update
    from sqlalchemy.engine import CursorResult

    from app_factory import create_app
    from core.db.session_factory import session_factory
    from extensions.ext_application_services import application_services
    from models.external_agent import ExternalAgentCommand, ExternalAgentConnectionRevision
    from services.external_agents.runtime_contracts import RuntimeScope

    require(state.get("prepared") is True and len(state["calls"]) == 35, "Run prepare to completion first.")
    _, app = create_app()
    with app.app_context():
        services = application_services().external_agents
        repository = services.repository
        sessions = session_factory.get_session_maker()
        require(sessions.kw["bind"].dialect.name == "postgresql", "Capacity exercise requires real PostgreSQL.")
        require(
            services.settings.workspace_query_concurrency == 20 and services.settings.endpoint_query_concurrency == 5,
            "This matrix requires the frozen workspace=20 and endpoint=5 capacities.",
        )
    scopes = {label: RuntimeScope(**scope) for label, scope in state["actors"].items()}
    owners = {scope.tenant_id for scope in scopes.values()}
    require(len(owners) == 2 and set(scopes) == {"owner", "foreign_owner"}, "Expected two isolated tenant scopes.")
    grouped = Counter((call["actor"], call["endpoint_group"]) for call in state["calls"])
    require(
        grouped == Counter({**{("owner", index): 6 for index in range(5)}, ("foreign_owner", 0): 5}),
        "The prepared Task matrix changed.",
    )
    started = time.monotonic()
    owned = []
    owned_lock = threading.Lock()
    released_ids: list[str] = []
    report: dict[str, object] = {
        "result": "failed",
        "phase": "validate_owned_due_polls",
        "released_command_ids": released_ids,
    }
    try:
        actual_endpoints = {}
        for call in state["calls"]:
            scope = scopes[call["actor"]]
            value = repository.get(scope, call["invocation_id"])
            require(
                value.agent_id == call["agent_id"]
                and value.remote_task_id == call["task_id"]
                and value.message_id == call["message_id"]
                and value.scope == scope
                and value.job.get("page_session_id") == call["page_session_id"]
                and call["page_session_id"].startswith(f"capacity-{state['run_id']}-"),
                "A prepared Invocation no longer matches its server-owned run identity.",
            )
            with sessions() as session:
                endpoint = session.scalar(
                    select(ExternalAgentConnectionRevision.interface_url).where(
                        ExternalAgentConnectionRevision.id == value.connection_revision_id,
                        ExternalAgentConnectionRevision.tenant_id == scope.tenant_id,
                        ExternalAgentConnectionRevision.agent_id == value.agent_id,
                    )
                )
                previous = actual_endpoints.setdefault(call["endpoint_group"], endpoint)
                require(endpoint and endpoint == previous, "The same endpoint group has different frozen URLs.")
        require(len(set(actual_endpoints.values())) == 5, "Five distinct frozen interface URLs were not preserved.")
        with sessions() as session:
            active = session.scalar(
                select(func.count())
                .select_from(ExternalAgentCommand)
                .where(
                    ExternalAgentCommand.tenant_id.in_(owners),
                    ExternalAgentCommand.kind.in_(("poll", "cancel")),
                    ExternalAgentCommand.state == "leased",
                    ExternalAgentCommand.lease_until > datetime.now(UTC).replace(tzinfo=None),
                )
            )
            require(active == 0, "Active query leases exist; gracefully drain the dedicated worker first.")
        due = {}
        deadline = time.monotonic() + min(180, float(os.environ.get("BYOA_CAPACITY_WAIT_SECONDS", "60")))
        while len(due) < 35 and time.monotonic() < deadline:
            now = datetime.now(UTC).replace(tzinfo=None)
            for call in state["calls"]:
                with sessions() as session:
                    command = session.scalar(
                        select(ExternalAgentCommand)
                        .where(
                            ExternalAgentCommand.tenant_id == scopes[call["actor"]].tenant_id,
                            ExternalAgentCommand.invocation_id == call["invocation_id"],
                            ExternalAgentCommand.kind == "poll",
                            ExternalAgentCommand.background.is_(False),
                            ExternalAgentCommand.next_run_at <= now,
                            or_(
                                ExternalAgentCommand.state == "ready",
                                ((ExternalAgentCommand.state == "leased") & (ExternalAgentCommand.lease_until <= now)),
                            ),
                        )
                        .order_by(ExternalAgentCommand.next_run_at, ExternalAgentCommand.id)
                        .limit(1)
                    )
                    if command is not None:
                        due[call["invocation_id"]] = command.id
            if len(due) < 35:
                time.sleep(0.25)
        require(len(due) == 35, "Not all prepared calls have due foreground Poll commands.")

        def claim(call, barrier):
            barrier.wait(timeout=30)
            with app.app_context():
                lease = repository.lease_command(
                    scopes[call["actor"]], due[call["invocation_id"]], now=datetime.now(UTC), lease_seconds=120
                )
            if lease is not None:
                with owned_lock:
                    owned.append((call, lease))
            return lease is not None

        def batch(calls):
            barrier = threading.Barrier(len(calls))
            failures, admitted = [], 0
            with ThreadPoolExecutor(max_workers=len(calls)) as executor:
                futures = [executor.submit(claim, call, barrier) for call in calls]
                for future in as_completed(futures):
                    try:
                        admitted += int(future.result())
                    except Exception as error:
                        failures.append(type(error).__name__)
            require(not failures, "A concurrent PostgreSQL lease admission failed unexpectedly.")
            return admitted

        # Hold both endpoint-0 tenants' admitted leases while the other four
        # endpoints contend for the remaining owner workspace capacity.
        report["phase"] = "endpoint_and_tenant_isolation"
        first = [call for call in state["calls"] if call["endpoint_group"] == 0]
        require(batch(first) == 10, "Endpoint admission did not produce independent 5+5 tenant limits.")
        counts = Counter(call["actor"] for call, _lease in owned)
        require(
            counts == Counter({"owner": 5, "foreign_owner": 5}),
            "The sixth owner query was admitted or the foreign endpoint quota was shared.",
        )
        report["phase"] = "workspace_capacity"
        remaining = [call for call in state["calls"] if call["endpoint_group"] != 0]
        require(batch(remaining) == 15, "Workspace admission did not fill exactly its remaining 15 slots.")
        counts = Counter(call["actor"] for call, _lease in owned)
        endpoint_counts = Counter((call["actor"], call["endpoint_group"]) for call, _lease in owned)
        require(counts == Counter({"owner": 20, "foreign_owner": 5}), "The workspace query cap was violated.")
        require(max(endpoint_counts.values()) <= 5, "A tenant endpoint exceeded five concurrent query leases.")
        with sessions() as session:
            for label, scope in scopes.items():
                admitted = session.scalar(
                    select(func.count())
                    .select_from(ExternalAgentCommand)
                    .where(
                        ExternalAgentCommand.tenant_id == scope.tenant_id,
                        ExternalAgentCommand.kind.in_(("poll", "cancel")),
                        ExternalAgentCommand.state == "leased",
                        ExternalAgentCommand.lease_until > datetime.now(UTC).replace(tzinfo=None),
                    )
                )
                require(
                    admitted == counts[label], "PostgreSQL active-query rows disagree with admitted lease receipts."
                )
        require(time.monotonic() - started < 120, "Lease admission exceeded its actual lease lifetime.")
        report.update(
            result="passed",
            admitted_by_actor=dict(counts),
            endpoint_counts=[
                {"actor": label, "endpoint_group": group, "leases": count}
                for (label, group), count in sorted(endpoint_counts.items())
            ],
            checks=[
                "sixth_same_endpoint_query_denied",
                "twenty_first_workspace_query_denied",
                "foreign_workspace_same_endpoint_independent_five",
                "no_query_io_executed",
            ],
        )
        return report
    finally:
        report["obtained_command_ids"] = [lease.id for _call, lease in owned]
        release_failures = []
        for call, lease in owned:
            try:
                with sessions.begin() as session:
                    result = session.execute(
                        update(ExternalAgentCommand)
                        .where(
                            ExternalAgentCommand.id == lease.id,
                            ExternalAgentCommand.tenant_id == lease.scope.tenant_id,
                            ExternalAgentCommand.invocation_id == call["invocation_id"],
                            ExternalAgentCommand.kind == "poll",
                            ExternalAgentCommand.state == "leased",
                            ExternalAgentCommand.fence == lease.fence,
                        )
                        .values(
                            state="ready",
                            lease_token=None,
                            lease_until=None,
                            publish_after=None,
                            fence=ExternalAgentCommand.fence + 1,
                        )
                    )
                    require(
                        isinstance(result, CursorResult) and result.rowcount == 1,
                        "A capacity lease changed before this tool could return it.",
                    )
                released_ids.append(lease.id)
            except Exception:
                release_failures.append(lease.id)
        report["unreleased_command_ids"] = release_failures
        if release_failures:
            report["result"] = "failed"
        state["exercise"] = report
        save(path, state)
        require(not release_failures, "Some owned capacity leases could not be returned; inspect the ID-only report.")


def cleanup(path: Path, state: dict) -> dict:
    clients = actors(state)
    canceled = []
    try:
        for call in state["calls"]:
            actor = clients[call["actor"]]
            actor.phase = "capacity_cancel_owned_task"
            value = actor.call("GET", f"/external-agents/{call['agent_id']}/tests/{call['invocation_id']}")
            require(value["metadata"].get("agent_id") == call["agent_id"], "Cleanup source asset changed.")
            if call.get("task_id"):
                require(value["metadata"].get("external_task_id") == call["task_id"], "Cleanup Task identity changed.")
            actor.call(
                "POST",
                f"/external-agents/{call['agent_id']}/tests/{call['invocation_id']}/cancel",
                expected=(202,),
                json={},
            )
        deadline = time.monotonic() + clients["owner"].timeout
        pending = list(state["calls"])
        while pending and time.monotonic() < deadline:
            remaining = []
            for call in pending:
                actor = clients[call["actor"]]
                actor.phase = "capacity_wait_cancel_confirmation"
                value = actor.call("GET", f"/external-agents/{call['agent_id']}/tests/{call['invocation_id']}")
                if value["metadata"].get("cancellation_state") == "confirmed":
                    canceled.append(call["invocation_id"])
                else:
                    remaining.append(call)
            pending = remaining
            if pending:
                time.sleep(0.5)
        require(not pending, "API Cancel did not confirm all capacity Tasks; keep the worker running.")
        snapshot = clients["owner"].stats()
        require(
            all(
                snapshot["tasks"].get(call.get("task_id"), {}).get("state") == "TASK_STATE_CANCELED"
                for call in state["calls"]
                if call.get("task_id")
            ),
            "Fixture Tasks do not all confirm cancellation.",
        )
        state["cleaned_up"] = True
        save(path, state)
        return {"result": "passed", "canceled_invocation_ids": canceled, "retained_asset_ids": state["assets"]}
    finally:
        for actor in clients.values():
            actor.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "exercise", "cleanup"))
    arguments = parser.parse_args()
    path = state_path(prepare=arguments.phase == "prepare")
    state = (
        {"version": 1, "run_id": uuid4().hex, "actors": {}, "assets": [], "calls": []}
        if (arguments.phase == "prepare")
        else load(path)
    )
    output = Path(os.environ.get("BYOA_CAPACITY_OUTPUT", str(path.with_suffix(f".{arguments.phase}.json"))))
    require(output != path, "BYOA_CAPACITY_OUTPUT must differ from the phase state file.")
    try:
        result = {"prepare": prepare, "exercise": exercise, "cleanup": cleanup}[arguments.phase](path, state)
    except Exception as error:
        result = {
            "result": "failed",
            "error": str(error) if isinstance(error, AcceptanceError) else type(error).__name__,
        }
    save(output, {"run_id": state["run_id"], "phase": arguments.phase, **result})
    print(f"BYOA_CAPACITY_STATE={path}")
    print(f"BYOA_CAPACITY_OUTPUT={output}")
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
