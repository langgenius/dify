"""Real HTTP helpers for bounded file/output acceptance, with sanitized evidence."""

from __future__ import annotations

import time
from itertools import starmap
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph


def same_json_value(actual: object, expected: object) -> bool:
    """Compare JSON values without Python's bool/number equality coercion.

    JSON Number admits either finite integer/float representation; Boolean is
    always distinct. Named object fields and ordered arrays remain exact.
    """
    if isinstance(expected, bool):
        return isinstance(actual, bool) and actual == expected
    if isinstance(expected, int | float):
        return isinstance(actual, int | float) and not isinstance(actual, bool) and actual == expected
    if expected is None:
        return actual is None
    if isinstance(expected, str):
        return isinstance(actual, str) and actual == expected
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(expected)
            and all(starmap(same_json_value, zip(actual, expected, strict=True)))
        )
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and actual.keys() == expected.keys()
            and all(same_json_value(actual[key], value) for key, value in expected.items())
        )
    return False


class MatrixAcceptance(WorkflowAcceptance):
    """Use the same real Console authentication and private fixture as other suites."""

    def register(
        self,
        case: str,
        *,
        data: dict | None = None,
        artifacts: list[dict] | None = None,
        files: list[dict] | None = None,
    ) -> None:
        """Register only a small peer response descriptor, never a Dify receipt.

        Dify still sends its real business request, receives the HTTPS response,
        validates/maps it and persists the outcome through its normal workers.
        """
        value = (
            artifacts
            if artifacts is not None
            else ([{"artifactId": "business", "parts": [{"data": data}]}] if data is not None else [])
        )
        response = self.control.post(
            self.admin + "/matrix-case",
            json={"run": self.run_id, "case": case, "artifacts": value, "files": files or []},
        )
        require(response.status_code == 200, "Private fixture rejected the bounded matrix descriptor.")

    def overview(
        self,
        agent: str,
        case: str,
        fields: list[dict],
        *,
        state: str,
        expected: dict | None = None,
        code: str | tuple[str, ...] | None = None,
        expected_names: set[str] | None = None,
    ) -> dict:
        """Execute one real Overview call and require its exact state/output/error.

        A bad output must remain one business Send; repeated result reads do not
        submit work and must preserve the same persisted terminal identity.
        """
        self.phase = case
        before = {key for key, item in self.stats()["messages"].items() if item.get("run") == self.run_id}
        detail = self.call("GET", f"/external-agents/{agent}")
        started = self.call(
            "POST",
            f"/external-agents/{agent}/tests",
            expected=(202,),
            json={
                "page_session_id": f"matrix-{self.run_id}-{case}",
                "expected_generation": detail["asset"]["test_display_generation"],
                "idempotency_key": str(uuid4()),
                "task_text": f"[byoa:matrix-output:{self.run_id}] {case}",
                "outputs": fields,
            },
        )
        result = self.wait(agent, started["invocation_id"])
        require(result["state"] == state, "Matrix Overview reached the wrong terminal state.")
        require("outputs" in result, "Matrix Overview omitted its required outputs response field.")
        if expected_names is None:
            require(
                same_json_value(result["outputs"], expected), "Matrix Overview published incorrect or partial outputs."
            )
        else:
            require(
                isinstance(result.get("outputs"), dict) and set(result["outputs"]) == expected_names,
                "Matrix Overview published unexpected file output fields.",
            )
        if code is not None:
            require(
                result.get("error_code") in ((code,) if isinstance(code, str) else code),
                "Matrix Overview returned the wrong bounded error.",
            )
        self.call("GET", f"/external-agents/{agent}/tests/{started['invocation_id']}")
        sent = [
            item
            for key, item in self.stats()["messages"].items()
            if key not in before and item.get("run") == self.run_id
        ]
        require(len(sent) == 1 and sent[0]["sends"] == 1, "Output validation replayed or omitted a business Send.")
        self.report["checks"].append(case)
        self.report.setdefault("cases", []).append(
            {
                "case": case,
                "invocation_id": started["invocation_id"],
                "state": result["state"],
                "error_code": result.get("error_code"),
                "business_sends": 1,
            }
        )
        return result

    def wait_terminal(self, app: str, run: str) -> dict:
        """Poll the real persisted Workflow until a bounded terminal state."""
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            result = self.call("GET", f"/apps/{app}/workflow-runs/{run}")
            if result.get("status") in {"succeeded", "failed", "partial-succeeded", "stopped"}:
                outputs = result.get("outputs")
                self.report.setdefault("terminal_observations", []).append(
                    {
                        "run_id": run,
                        "status": result.get("status"),
                        "finished_at": result.get("finished_at"),
                        "outputs_present": "outputs" in result,
                        "outputs_shape": "null" if outputs is None else "empty_object" if outputs == {} else "nonempty",
                    }
                )
                return result
            time.sleep(0.5)
        raise AcceptanceError("Matrix Workflow did not reach a terminal state within its bound.")

    def workflow_output(
        self,
        agent: str,
        case: str,
        declarations: list[dict],
        *,
        expected_status: str,
        expected_outputs: dict | None,
        strategy: str | None = None,
        defaults: list[dict] | None = None,
        branch: bool = False,
    ) -> None:
        """Run a saved graph to distinguish field defaults and node Error Handling."""
        self.phase = case
        app = self.app("workflow")
        value = graph(agent)
        start = value["nodes"][0]["data"]
        start["variables"] = []
        external = next(item["data"] for item in value["nodes"] if item["id"] == "external")
        external["agent_task"] = f"[byoa:matrix-output:{self.run_id}] {case}"
        external["agent_declared_outputs"] = declarations
        if strategy:
            external["error_strategy"] = strategy
        if defaults is not None:
            external["default_value"] = defaults
        end = value["nodes"][-1]["data"]
        end["outputs"] = (
            [{"variable": "error_type", "value_selector": ["external", "error_type"]}]
            if branch
            else [{"variable": item["name"], "value_selector": ["external", item["name"]]} for item in declarations]
        )
        if branch:
            value["edges"][-1]["sourceHandle"] = "fail-branch"
        self.save(app, value)
        before = {key for key, item in self.stats()["messages"].items() if item.get("run") == self.run_id}
        self.phase = case
        events = self.stream(self.client, self.base + f"/apps/{app}/workflows/draft/run", {"inputs": {}})
        run = self.run_identity(events)
        result = self.wait_terminal(app, run)
        require(result["status"] == expected_status, "Output Error Handling produced the wrong Workflow status.")
        require("outputs" in result, "Workflow omitted its required outputs response field.")
        if expected_status == "failed":
            # A persisted failed run has SQL NULL; Console's nullable output
            # contract may expose null or the model's empty-object projection.
            # Neither permits a business value or a successful downstream End.
            require(
                result.get("outputs") is None or result.get("outputs") == {},
                "Failed Workflow published business output.",
            )
        else:
            require(
                same_json_value(result["outputs"], expected_outputs),
                "Output Error Handling published incorrect Workflow values.",
            )
        executions = self.call("GET", f"/apps/{app}/workflow-runs/{run}/node-executions")["data"]
        rows = [item for item in executions if item.get("node_id") == "external"]
        expected_node = (
            "succeeded"
            if expected_status == "succeeded"
            else "exception"
            if expected_status == "partial-succeeded"
            else "failed"
        )
        require(
            len(rows) == 1 and rows[0]["status"] == expected_node,
            "Node success/failure was confused with the final Workflow status.",
        )
        if expected_status == "failed":
            require(
                not any(item.get("node_id") == "end" and item.get("status") == "succeeded" for item in executions),
                "Failed output validation still executed the downstream End.",
            )
        sent = [
            item
            for key, item in self.stats()["messages"].items()
            if key not in before and item.get("run") == self.run_id
        ]
        require(len(sent) == 1 and sent[0]["sends"] == 1, "Node Error Handling replayed or skipped the remote task.")
        self.report["checks"].append(case)
        self.report.setdefault("cases", []).append(
            {
                "case": case,
                "app_id": app,
                "run_id": run,
                "node_execution_id": rows[0]["id"],
                "workflow_status": result["status"],
                "node_status": rows[0]["status"],
                "business_sends": 1,
            }
        )
