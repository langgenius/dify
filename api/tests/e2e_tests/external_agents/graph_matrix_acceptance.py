"""Real API container recovery and output-error acceptance against dev.

Requires the documented WorkflowAcceptance environment and the working-echo
fixture. Each case asserts terminal output, actual peer Sends and distinct
server-returned context identities. No SDK, SQL or in-memory fake replaces the
Console -> graph -> persistent wait -> worker -> HTTPS -> resume path.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import override

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph, node


def edge(source: str, target: str, handle: str = "source") -> dict:
    """Build one ordinary editor edge without changing its branch semantics."""
    return {
        "id": f"{source}-{handle}-{target}",
        "type": "custom",
        "source": source,
        "target": target,
        "sourceHandle": handle,
        "targetHandle": "target",
    }


def owned(identifier: str, owner: str, data: dict) -> dict:
    """Build a node with matching canonical and editor container ownership."""
    value = node(identifier, {**data, "container_id": owner}, 300)
    value["parentId"] = owner
    return value


def external(agent: str, task: str) -> dict:
    """Return the supported external node configuration, with real wait policy."""
    value = graph(agent)["nodes"][1]["data"].copy()
    value["agent_task"] = task
    return value


def loop_variables() -> list[dict]:
    """Give each loop its own counter and ordered result accumulator."""
    return [
        {"label": "counter", "var_type": "number", "value_type": "constant", "value": 0},
        {"label": "seen", "var_type": "array[string]", "value_type": "constant", "value": []},
    ]


def remember(owner: str, selector: list[str], *, extend: bool) -> dict:
    """Append this frame's actual result, then advance its own loop counter."""
    return owned(
        owner + "-remember",
        owner,
        {
            "type": "assigner",
            "version": "2",
            "title": "Remember exact frame result",
            "items": [
                {
                    "variable_selector": [owner, "seen"],
                    "input_type": "variable",
                    "operation": "extend" if extend else "append",
                    "value": selector,
                },
                {"variable_selector": [owner, "counter"], "input_type": "constant", "operation": "+=", "value": 1},
            ],
        },
    )


def parallel_graph(agent: str, task: str, *, nested: bool = False) -> dict:
    """Build three parallel frames, optionally inside two outer loop rounds."""
    start = node(
        "start",
        {
            "type": "start",
            "title": "Input",
            "variables": [{"variable": "payload", "label": "Payload", "type": "json_object", "required": True}],
        },
        0,
    )
    batch_data = {
        "type": "iteration",
        "title": "Parallel external calls",
        "start_node_id": "batch-start",
        "iterator_selector": ["start", "payload", "items"],
        "output_selector": ["external", "text"],
        "output_type": "array[string]",
        "is_parallel": True,
        "parallel_nums": 3,
        "flatten_output": False,
        "error_handle_mode": "terminated",
    }
    batch = owned("batch", "outer", batch_data) if nested else node("batch", batch_data, 300)
    nodes = [
        start,
        batch,
        owned("batch-start", "batch", {"type": "iteration-start", "title": "Frame start"}),
        owned(
            "external",
            "batch",
            external(agent, task + (" {{#outer.counter#}}" if nested else "") + " {{#batch.item#}}"),
        ),
    ]
    edges = [edge("batch-start", "external")]
    if nested:
        nodes.extend(
            [
                node(
                    "outer",
                    {
                        "type": "loop",
                        "title": "Outer loop",
                        "start_node_id": "outer-start",
                        "loop_count": 2,
                        "break_conditions": [],
                        "logical_operator": "and",
                        "loop_variables": loop_variables(),
                    },
                    100,
                ),
                owned("outer-start", "outer", {"type": "loop-start", "title": "Outer start"}),
                remember("outer", ["batch", "output"], extend=True),
            ]
        )
        edges.extend(
            [
                edge("start", "outer"),
                edge("outer-start", "batch"),
                edge("batch", "outer-remember"),
                edge("outer", "end"),
            ]
        )
        outputs = [{"variable": "values", "value_selector": ["outer", "seen"], "value_type": "array[string]"}]
    else:
        edges.extend([edge("start", "batch"), edge("batch", "end")])
        outputs = [{"variable": "values", "value_selector": ["batch", "output"], "value_type": "array[string]"}]
    nodes.append(node("end", {"type": "end", "title": "Output", "outputs": outputs}, 700))
    return {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.8}}


def nested_loop_graph(agent: str, task: str) -> dict:
    """Build two loop levels, with four durable executions of one logical node."""
    nodes = [node("start", {"type": "start", "title": "Start", "variables": []}, 0)]
    for name, owner in (("outer", None), ("inner", "outer")):
        data = {
            "type": "loop",
            "title": name,
            "start_node_id": name + "-start",
            "loop_count": 2,
            "break_conditions": [],
            "logical_operator": "and",
            "loop_variables": loop_variables(),
        }
        nodes.extend(
            [
                owned(name, owner, data) if owner else node(name, data, 200),
                owned(name + "-start", name, {"type": "loop-start", "title": name + " start"}),
            ]
        )
    nodes.extend(
        [
            owned("external", "inner", external(agent, task + " {{#outer.counter#}}/{{#inner.counter#}}")),
            remember("inner", ["external", "text"], extend=False),
            remember("outer", ["inner", "seen"], extend=True),
            node(
                "end",
                {
                    "type": "end",
                    "title": "Output",
                    "outputs": [{"variable": "values", "value_selector": ["outer", "seen"]}],
                },
                700,
            ),
        ]
    )
    return {
        "nodes": nodes,
        "edges": [
            edge("start", "outer"),
            edge("outer-start", "inner"),
            edge("inner-start", "external"),
            edge("external", "inner-remember"),
            edge("inner", "outer-remember"),
            edge("outer", "end"),
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.8},
    }


class GraphMatrixAcceptance(WorkflowAcceptance):
    """Exercise the public API and retain only IDs, hashes and synthetic output."""

    def own_messages(self) -> dict:
        """Read peer evidence restricted to this runner's unguessable marker."""
        return {key: value for key, value in self.stats()["messages"].items() if value.get("run") == self.run_id}

    def execute(
        self, value: dict, inputs: dict, *, expected: dict, count: int, name: str
    ) -> tuple[str, str, list[dict]]:
        """Run a fresh graph and require durable completion without Send replay."""
        self.phase = name
        app = self.app("workflow")
        self.save(app, value)
        self.phase = name
        before = set(self.own_messages())
        events = self.stream(self.client, self.base + f"/apps/{app}/workflows/draft/run", {"inputs": inputs})
        self.report["last_events"] = events
        self.assert_external_pause(events)
        identifier = self.run_identity(events)
        result = self.wait_run(app, identifier)
        require(result.get("outputs") == expected, f"Unexpected final output during {name}.")
        messages = [item for key, item in self.own_messages().items() if key not in before]
        require(len(messages) == count, f"Wrong number of business calls during {name}.")
        require(all(item["sends"] == 1 for item in messages), f"Business work replayed during {name}.")
        require(
            all(item["provided_context"] is None and item["provided_task_id"] is None for item in messages),
            "A distinct frame inherited another frame's remote identity.",
        )
        require(
            len({item["returned_context"] for item in messages}) == count, "Remote contexts were shared across frames."
        )
        self.report.setdefault("cases", {})[name] = {
            "app_id": app,
            "run_id": identifier,
            "business_sends": count,
            "distinct_contexts": count,
            "outputs": result["outputs"],
        }
        self.report["checks"].append(name)
        return app, identifier, messages

    def containers(self, agent: str) -> None:
        """Require ordered parallel output and nested loop execution cardinality."""
        items = ["alpha", "beta", "gamma"]
        task = self.text("working-echo", "parallel")
        _, _, messages = self.execute(
            parallel_graph(agent, task),
            {"payload": {"items": items}},
            expected={"values": ["parallel " + item for item in items]},
            count=3,
            name="parallel_iteration_pause_resume_order_and_frame_isolation",
        )
        require(
            {item["task_text_sha256"] for item in messages}
            == {hashlib.sha256((task + " " + item).encode()).hexdigest() for item in items},
            "Parallel frame task variables crossed their boundaries.",
        )
        self.execute(
            nested_loop_graph(agent, self.text("working-echo", "nested-loop")),
            {},
            expected={"values": [f"nested-loop {outer}/{inner}" for outer in range(2) for inner in range(2)]},
            count=4,
            name="nested_loop_four_independent_external_waits",
        )
        self.execute(
            parallel_graph(agent, self.text("working-echo", "nested-parallel"), nested=True),
            {"payload": {"items": items}},
            expected={"values": [f"nested-parallel {outer} {item}" for outer in range(2) for item in items]},
            count=6,
            name="nested_loop_parallel_iteration_six_external_waits",
        )

    def stop_paused(self, agent: str) -> None:
        """A stopped paused run must not revive after an accepted Task finishes."""
        app = self.app("workflow")
        self.save(app, graph(agent))
        self.phase = "stop_paused_then_late_completion"
        before = set(self.own_messages())
        events = self.stream(
            self.client,
            self.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": self.text("hold", "stop-paused")}},
        )
        self.assert_external_pause(events)
        run = self.run_identity(events)
        task = next(item["task_id"] for item in events if item.get("task_id"))
        deadline = time.monotonic() + self.timeout
        messages = []
        while time.monotonic() < deadline and not messages:
            messages = [item for key, item in self.own_messages().items() if key not in before]
            if not messages:
                time.sleep(0.5)
        require(len(messages) == 1, "The paused stop case did not receive exactly one peer Task.")
        self.call("POST", f"/apps/{app}/workflow-runs/tasks/{task}/stop", json={})
        self.wait_run(app, run, status="stopped")
        peer_task = messages[0]["created_task_id"]
        if self.stats()["tasks"][peer_task]["state"] == "TASK_STATE_WORKING":
            response = self.control.post(self.admin + "/release", json={"task_id": peer_task})
            require(response.status_code == 200, "The late result could not be released.")
        time.sleep(8)
        terminal = self.call("GET", f"/apps/{app}/workflow-runs/{run}")
        require(
            terminal["status"] == "stopped" and terminal.get("outputs") in (None, {}),
            "A late result revived the stopped graph.",
        )
        require(
            sum(item["sends"] for key, item in self.own_messages().items() if key not in before) == 1,
            "Stopping and late completion repeated business Send.",
        )
        self.report["checks"].append("stop_paused_late_result_does_not_revive_graph_or_resend")

    @override
    def run(self) -> dict:
        """Authenticate, create a verified asset and finish all required cases."""
        self.login()
        agent = self.create_asset()
        self.containers(agent)
        self.stop_paused(agent)
        self.report.update(result="passed", finished_at=datetime.now(UTC).isoformat())
        return self.report


def main() -> None:
    """Persist a safe report and return a nonzero status for any failed assertion."""
    runner = GraphMatrixAcceptance()
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
    if destination := os.environ.get("BYOA_GRAPH_MATRIX_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
