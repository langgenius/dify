"""Bounded real I/O/graph-wait acceptance, not a production throughput SLO.

Eight real paused graphs and four foreign-workspace Overview calls compete for
the deployment's default external worker. Their peer holds each Get for two
seconds. A Native graph must finish while they remain waiting; then every task
is released and every original graph must consume its own result exactly once.
Record actual request latency, observed network concurrency and fairness facts.
The separate PostgreSQL admission suite tests saturation of the 20/5 caps.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import override

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph


class LoadAcceptance(WorkflowAcceptance):
    """Observe real public operations and clean only this runner's fixture work."""

    def __init__(self) -> None:
        """Create independent clients for owners of two isolated workspaces."""
        super().__init__()
        actors = json.loads(os.environ["BYOA_TEST_ACTORS_JSON"])
        actor = actors["foreign_owner"]
        self.foreign = ConsoleAcceptance(email=actor["email"], password=actor["password"])
        self.pending: list[dict] = []
        self.foreign_pending: list[dict] = []
        self.report.update(
            scope="8 real paused graphs + 4 foreign calls + real 2s query I/O",
            limits={"workflow_calls": 8, "foreign_calls": 4, "query_delay_seconds": 2},
            cases=[],
        )

    @override
    def close(self) -> None:
        """Close both identities after the runner has attempted remote cleanup."""
        self.foreign.close()
        super().close()

    def start_graph(self, app: str) -> dict:
        """Require the real graph to pause and return its request's elapsed time."""
        began = time.monotonic()
        events = self.stream(
            self.client,
            self.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": self.text("load-hold", app)}},
        )
        self.assert_external_pause(events)
        run = self.run_identity(events)
        return {"app_id": app, "run_id": run, "initial_request_seconds": round(time.monotonic() - began, 3)}

    def own_peer_tasks(self) -> dict:
        """Return this test's exact peer identities, excluding other fixture runs."""
        snapshot = self.stats()
        return {
            key: value
            for key, value in snapshot["tasks"].items()
            if snapshot["messages"].get(value["message_id"], {}).get("run") in {self.run_id, self.foreign.run_id}
        }

    def release_peer_tasks(self) -> None:
        """Release only tasks accepted for the two exact random run markers."""
        for identifier in self.own_peer_tasks():
            response = self.control.post(
                self.admin + "/release", json={"task_id": identifier, "output_text": "load:" + identifier}
            )
            require(response.status_code == 200, "The load fixture could not release an owned task.")

    @override
    def run(self) -> dict:
        """Complete the load window, an unrelated Native run and exact resumption."""
        self.login()
        self.foreign.login()
        owner_scope = self.call("GET", "/workspaces/current/summary")
        foreign_scope = self.foreign.call("GET", "/workspaces/current/summary")
        require(
            owner_scope["id"] != foreign_scope["id"] and foreign_scope["role"] == "owner",
            "Load actors must belong to distinct owned workspaces.",
        )
        agent = self.create_asset()
        foreign_agent = self.foreign.create_asset()
        apps = []
        for _ in range(8):
            app = self.app("workflow")
            self.save(app, graph(agent))
            apps.append(app)
        self.phase = "concurrent_external_waits"
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                self.pending = list(pool.map(self.start_graph, apps))
            for index in range(4):
                started, _ = self.foreign.start(foreign_agent, "load-hold", page=f"load-{self.foreign.run_id}-{index}")
                self.foreign_pending.append(started)
            deadline = time.monotonic() + 90
            ready = False
            snapshot = {}
            while time.monotonic() < deadline and not ready:
                tasks = self.own_peer_tasks()
                snapshot = self.stats()
                ready = len(tasks) == 12 and all(item["gets"] >= 1 for item in tasks.values())
                if not ready:
                    time.sleep(0.5)
            require(ready, "One workspace's bounded query workload starved another's calls.")
            for item in self.pending:
                self.wait_run(item["app_id"], item["run_id"], status="paused")
            self.report["checks"].append("eight_graphs_pause_and_both_workspaces_make_real_query_progress")
            self.phase = "native_run_while_external_tasks_still_wait"
            before = time.monotonic()
            self.native_regression()
            self.report["native_progress_seconds_while_external_waiting"] = round(time.monotonic() - before, 3)
            require(
                all(task["state"] == "TASK_STATE_WORKING" for task in self.own_peer_tasks().values()),
                "The peer completed tasks before the Native progress check.",
            )
            metrics = snapshot["query_io"]
            owner_io = metrics["run:" + self.run_id]
            foreign_io = metrics["run:" + self.foreign.run_id]
            require(
                0 < owner_io["peak"] <= 5 and 0 < foreign_io["peak"] <= 5,
                "The observed workspace endpoint query concurrency exceeded its cap.",
            )
            require(
                owner_io["finished"] > 0 and foreign_io["finished"] > 0,
                "The observation did not include completed real query I/O for both owners.",
            )
            self.report["query_io"] = {"owner": owner_io, "foreign": foreign_io, "all": metrics["all"]}
            self.report["checks"].append("native_progress_without_completing_external_work_and_real_query_io_observed")
            self.release_peer_tasks()
            peer_messages = self.stats()["messages"]
            for item in self.pending:
                result = self.wait_run(item["app_id"], item["run_id"])
                digest = hashlib.sha256(self.text("load-hold", item["app_id"]).encode()).hexdigest()
                peer = [
                    row
                    for row in peer_messages.values()
                    if row.get("run") == self.run_id and row["task_text_sha256"] == digest
                ]
                require(
                    len(peer) == 1 and result.get("outputs") == {"text": "load:" + peer[0]["created_task_id"]},
                    "A graph consumed another load call's output.",
                )
            for item in self.foreign_pending:
                result = self.foreign.wait(foreign_agent, item["invocation_id"])
                require(result["state"] == "succeeded", "A foreign call did not complete after release.")
                require(
                    result["outputs"] == {"text": "load:" + result["metadata"]["external_task_id"]},
                    "A foreign call consumed another Task's output.",
                )
            rows = [
                value
                for value in self.stats()["messages"].values()
                if value.get("run") in {self.run_id, self.foreign.run_id}
            ]
            require(
                len(rows) == 12 and all(item["sends"] == 1 for item in rows),
                "Load recovery repeated or omitted a Send.",
            )
            self.report["checks"].append("all_twelve_original_calls_finish_with_one_send_each")
            self.report.update(
                result="passed",
                graphs=self.pending,
                foreign_invocations=[x["invocation_id"] for x in self.foreign_pending],
                business_sends=12,
                capacity_conclusion=(
                    "bounded default-worker progress and isolation; no production throughput SLO inferred"
                ),
                finished_at=datetime.now(UTC).isoformat(),
            )
            return self.report
        finally:
            self.release_peer_tasks()


def main() -> None:
    """Write bounded synthetic observations; make any unmet assertion fail the run."""
    runner = LoadAcceptance()
    try:
        result = runner.run()
    except Exception as error:
        result = {
            **runner.report,
            "result": "failed",
            "phase": runner.phase,
            "error": str(error) if isinstance(error, AcceptanceError) else type(error).__name__,
        }
    finally:
        runner.close()
    encoded = json.dumps(result, indent=2)
    if destination := os.environ.get("BYOA_LOAD_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
