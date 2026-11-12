"""Real 60-second timeout policies; never override runtime's 3600-second budget.

Use the ConsoleAcceptance environment/cookies/CA configuration. All three cases
start before polling, and fixture evidence is filtered by an exact per-case run
marker. This is a real-clock test, not a fast-clock or manual Cancel substitute.
Output is selected by BYOA_TIMEOUT_ACCEPTANCE_OUTPUT (or BYOA_ACCEPTANCE_OUTPUT).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import UTC, datetime
from operator import itemgetter
from pathlib import Path
from typing import Any, override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require

TERMINAL = {"succeeded", "failed", "ended", "stopped"}


class TimeoutAcceptance(ConsoleAcceptance):
    def __init__(self) -> None:
        super().__init__()
        self.report.update(
            scope="real-clock 60-second timeout strategies", wait_seconds=60, logical_budget_seconds=3600, cases={}
        )

    def start_case(self, agent, label, scenario, policy, *, lease_id=None, page=None) -> dict[str, Any]:
        self.phase = f"start_{label}"
        detail = self.call("GET", f"/external-agents/{agent}")
        tag = f"{self.run_id}-{label}"
        payload = {
            "page_session_id": page or f"timeout-{tag}",
            "expected_generation": detail["asset"]["test_display_generation"],
            "idempotency_key": str(uuid4()),
            "task_text": f"[byoa:{scenario}:{tag}] Timeout acceptance",
            "input_lease_ids": [lease_id] if lease_id else [],
            "outputs": [{"name": "text", "kind": "string"}],
            "policy": {"wait_seconds": 60, "on_timeout": policy, "additional_retries": 1, "retry_interval_seconds": 5},
        }
        began = time.monotonic()
        value = self.call("POST", f"/external-agents/{agent}/tests", expected=(202,), json=payload)
        case: dict[str, Any] = {
            "anchor_invocation_id": value["invocation_id"],
            "scenario": scenario,
            "tag": tag,
            "policy": payload["policy"],
            "started_monotonic": began,
        }
        self.report["cases"][label] = case
        return case

    def poll(self, agent, case, predicate, *, timeout_seconds=None):
        deadline = time.monotonic() + (self.timeout if timeout_seconds is None else timeout_seconds)
        while time.monotonic() < deadline:
            value = self.call("GET", f"/external-agents/{agent}/tests/{case['anchor_invocation_id']}")
            case["last_result"] = {
                key: value[key] for key in ("invocation_id", "state", "outputs", "error_code", "metadata")
            }
            if predicate(value):
                return value
            time.sleep(0.5)
        raise AcceptanceError(f"Bounded timeout-policy polling expired during {self.phase}.")

    def messages(self, case):
        snapshot = self.stats()
        rows = [
            {"message_id": identifier, **value}
            for identifier, value in snapshot["messages"].items()
            if value["run"] == case["tag"] and value["scenario"] == case["scenario"]
        ]
        return sorted(rows, key=itemgetter("attempt")), snapshot

    def first_task(self, agent, case):
        value = self.poll(agent, case, lambda result: bool(result["metadata"].get("external_task_id")))
        case["first_task_id"] = value["metadata"]["external_task_id"]

    def end_waiting(self, agent, case):
        self.phase = "end_waiting_timeout"
        value = self.poll(agent, case, lambda result: result["state"] in TERMINAL)
        case["terminal_elapsed_seconds"] = time.monotonic() - case["started_monotonic"]
        require(case["terminal_elapsed_seconds"] >= 59, "EndWaiting ended before its actual 60-second wait.")
        require(
            value["state"] != "succeeded" and value["error_code"] == "external_wait_timeout",
            "EndWaiting did not settle on the wait timeout.",
        )
        require(value["outputs"] is None, "EndWaiting published business output.")
        messages, snapshot = self.messages(case)
        require(len(messages) == 1 and messages[0]["sends"] == 1, "EndWaiting resent business work.")
        require(snapshot["tasks"][case["first_task_id"]]["cancel_count"] == 0, "EndWaiting sent Cancel.")
        case["local_terminal_state"] = value["state"]
        self.report["checks"].append("end_waiting_no_cancel_or_business_retry")

    def request_cancellation(self, agent, case):
        self.phase = "request_cancellation_timeout"
        value = self.poll(agent, case, lambda result: result["state"] in TERMINAL)
        require(value["metadata"]["cancellation_state"] == "confirmed", "Timeout cancellation was not confirmed.")
        require(
            value["metadata"]["sequence"] == 0 and value["outputs"] is None,
            "RequestCancellation created a retry or published output.",
        )
        messages, snapshot = self.messages(case)
        require(len(messages) == 1 and messages[0]["sends"] == 1, "RequestCancellation resent business work.")
        task = snapshot["tasks"][case["first_task_id"]]
        require(
            task["cancel_count"] == 1 and task["state"] == "TASK_STATE_CANCELED",
            "RequestCancellation did not issue exactly one confirmed Cancel.",
        )
        self.record_cancel_timing(case, messages[0], task)
        self.report["checks"].append("request_cancellation_confirmed_without_retry")

    @staticmethod
    def record_cancel_timing(case, first_message, first_task):
        accepted = datetime.fromisoformat(first_message["accepted_at"])
        canceled = datetime.fromisoformat(first_task["first_cancel_at"])
        elapsed = (canceled - accepted).total_seconds()
        # Node wait starts immediately before network I/O, so allow the frozen
        # connect budget between that point and fixture receipt of its body.
        require(elapsed >= 54, "Cancellation happened before the configured real 60-second wait.")
        case["fixture_accept_to_cancel_seconds"] = elapsed

    def cancel_and_retry(self, agent, case, expected_hash):
        self.phase = "cancel_and_retry_timeout"
        value = self.poll(
            agent, case, lambda result: result["state"] in TERMINAL and result["metadata"].get("sequence", 0) >= 1
        )
        require(
            value["state"] == "succeeded" and value["metadata"]["sequence"] == 1,
            "CancelAndRetry did not complete exactly one admitted child.",
        )
        require(
            value["invocation_id"] != case["anchor_invocation_id"], "Overview did not return the logical child result."
        )
        require(value["outputs"] == {"text": "task ok"}, "Retry output was not mapped from its completed Task.")
        messages, snapshot = self.messages(case)
        require(
            len(messages) == 2 and all(row["sends"] == 1 for row in messages),
            "CancelAndRetry exceeded its one additional business attempt.",
        )
        first, second = messages
        require(first["message_id"] != second["message_id"], "Retry reused an old message ID.")
        require(
            second["previous_task_state_at_send"] == "TASK_STATE_CANCELED",
            "Retry was sent before authoritative cancellation.",
        )
        require(first["attempt"] == 1 and second["attempt"] == 2, "Fixture attempt association is inconsistent.")
        first_task = snapshot["tasks"][first["created_task_id"]]
        require(
            first_task["cancel_count"] == 1 and first_task["state"] == "TASK_STATE_CANCELED",
            "The first retry attempt did not have exactly one confirmed Cancel.",
        )
        require(snapshot["tasks"][second["created_task_id"]]["cancel_count"] == 0, "Completed child was canceled.")
        for message in messages:
            require(
                len(message["input_files"]) == 1 and message["input_files"][0]["sha256"] == expected_hash,
                "The admitted TXT input was lost or changed across the retry.",
            )
            require(message["provided_task_id"] is None, "Retry forwarded a terminal task ID.")
        self.record_cancel_timing(case, first, first_task)
        case["attempts"] = messages
        self.report["checks"].append("cancel_and_retry_only_after_canceled_new_message_and_live_txt_input")

    def late_end_waiting(self, agent, case):
        self.phase = "end_waiting_late_receipt"
        response = self.control.post(self.admin + "/release", json={"task_id": case["first_task_id"]})
        require(response.status_code == 200, "Fixture could not complete the locally ended Task.")
        value = self.poll(
            agent,
            case,
            lambda result: (
                str(result["metadata"].get("external_task_status", "")).lower().removeprefix("task_state_")
                == "completed"
            ),
            # A pre-timeout poll can race with release, then enter the frozen
            # background backoff. Bound that observation by 300s plus HTTP 30s.
            timeout_seconds=330,
        )
        require(
            value["state"] == case["local_terminal_state"] and value["outputs"] is None,
            "A late completed Task revived EndWaiting or backfilled output.",
        )
        self.report["checks"].append("late_completion_is_history_only_after_end_waiting")

    @override
    def run(self):
        self.login()
        self.phase = "timeout_configuration"
        capabilities = self.call("GET", "/external-agents/capabilities")
        require(
            capabilities["limits"]["logical_budget_seconds"] == 3600,
            "Controlled timeout test requires logical budget 3600.",
        )
        agent = self.create_asset()
        page = f"timeout-{self.run_id}-retry"
        content = f"Admitted TXT retry input {self.run_id}".encode()
        upload = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("retry.txt", content, "text/plain")},
        )
        end = self.start_case(agent, "end", "hold", "end_waiting")
        request = self.start_case(agent, "request", "hold", "request_cancellation")
        retry = self.start_case(
            agent, "retry", "timeout-retry", "cancel_and_retry", page=page, lease_id=upload["lease_id"]
        )
        for case in (end, request, retry):
            self.first_task(agent, case)
        self.end_waiting(agent, end)
        self.request_cancellation(agent, request)
        self.cancel_and_retry(agent, retry, hashlib.sha256(content).hexdigest())
        self.late_end_waiting(agent, end)
        # Snapshot after late observation also catches extra dispatches while
        # the other two policies and the retained history were being drained.
        for case, expected in ((end, 1), (request, 1), (retry, 2)):
            messages, snapshot = self.messages(case)
            require(sum(row["sends"] for row in messages) == expected, "Timeout policy caused an extra business Send.")
            case["attempts"] = messages
            case["tasks"] = {row["created_task_id"]: snapshot["tasks"][row["created_task_id"]] for row in messages}
        require(end["tasks"][end["first_task_id"]]["cancel_count"] == 0, "Late EndWaiting issued Cancel.")
        self.report.update(result="passed", finished_at=datetime.now(UTC).isoformat())
        return self.report


def main():
    runner = TimeoutAcceptance()
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
    target = os.environ.get("BYOA_TIMEOUT_ACCEPTANCE_OUTPUT") or os.environ.get("BYOA_ACCEPTANCE_OUTPUT")
    if target:
        Path(target).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
