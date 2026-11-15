"""Real Workflow, standalone Node Test and production Chatflow BYOA acceptance.

Uses the same verified-TLS Console login and isolated HTTPS fixture as
``acceptance.py``. No secrets, request bodies or raw SSE payloads are printed.
Run with the documented DIFY_TEST_* / BYOA_FIXTURE_* environment variables.
Creates clearly named apps/assets and one reveal-once App API key (kept only
in process memory). This module does not claim success until real API checks pass.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import override

import httpx

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require, tls_context


def node(identifier: str, data: dict, x: int) -> dict:
    return {"id": identifier, "type": "custom", "position": {"x": x, "y": 0}, "data": data, "width": 242, "height": 100}


def graph(agent_id: str | None, *, chat: bool = False) -> dict:
    variables = [] if chat else [{"variable": "task", "label": "Task", "type": "paragraph", "required": True}]
    nodes = [node("start", {"type": "start", "title": "Start", "variables": variables}, 0)]
    ids = ["start"]
    if agent_id is not None:
        nodes.append(
            node(
                "external",
                {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "external_a2a",
                    "title": "External",
                    "agent_binding": {"binding_type": "roster_agent", "agent_id": agent_id},
                    "agent_task": "{{#sys.query#}}" if chat else "{{#start.task#}}",
                    "agent_declared_outputs": [{"name": "text", "type": "string", "required": True}],
                    "external_wait": {"enabled": True, "wait_seconds": 60, "on_timeout": "end_waiting"},
                },
                300,
            )
        )
        ids.append("external")
    selector = ["external", "text"] if agent_id else ["start", "task"]
    final = (
        {"type": "answer", "title": "Answer", "answer": "{{#external.text#}}"}
        if chat
        else {
            "type": "end",
            "title": "End",
            "outputs": [{"variable": "text", "value_type": "string", "value_selector": selector}],
        }
    )
    final_id = "answer" if chat else "end"
    nodes.append(node(final_id, final, 600))
    ids.append(final_id)
    edges = [
        {
            "id": f"{source}-{target}",
            "type": "custom",
            "source": source,
            "target": target,
            "sourceHandle": "source",
            "targetHandle": "target",
        }
        for source, target in zip(ids, ids[1:], strict=False)
    ]
    return {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.8}}


class WorkflowAcceptance(ConsoleAcceptance):
    def __init__(self) -> None:
        super().__init__()
        self.service = os.environ.get("DIFY_SERVICE_API_URL", self.base.removesuffix("/console/api") + "/v1").rstrip(
            "/"
        )
        self.service_client = httpx.Client(
            verify=tls_context("DIFY_TEST_CA_FILE"), timeout=self.timeout, follow_redirects=False, trust_env=False
        )
        self.report.update(
            scope="real Console Workflow/Node Test + published production Service API Chatflow",
            apps=[],
            workflow_runs=[],
            node_debug_executions=[],
            conversations=[],
        )

    @override
    def close(self) -> None:
        self.service_client.close()
        super().close()

    def text(self, scenario: str, suffix: str) -> str:
        return f"[byoa:{scenario}:{self.run_id}] {suffix}"

    def messages(self) -> list[dict]:
        return [value for value in self.stats()["messages"].values() if value.get("run") == self.run_id]

    def app(self, mode: str) -> str:
        self.phase = f"create_{mode}_app"
        value = self.call(
            "POST",
            "/apps",
            expected=(201,),
            json={
                "name": f"BYOA E2E {self.run_id[:10]} {mode}",
                "mode": mode,
                "description": "Isolated backend acceptance; contains no production data.",
            },
        )
        require(isinstance(value.get("id"), str), "App creation did not return an ID.")
        self.report["apps"].append(value["id"])
        return value["id"]

    def save(self, app: str, value: dict) -> dict:
        self.phase = "save_owned_draft_graph"
        current = self.call("GET", f"/apps/{app}/workflows/draft", expected=(200, 404))
        self.call(
            "POST",
            f"/apps/{app}/workflows/draft",
            json={
                "graph": value,
                "features": current.get("features") or {},
                "hash": current.get("hash"),
                "conversation_variables": current.get("conversation_variables") or [],
            },
        )
        return self.call("GET", f"/apps/{app}/workflows/draft")

    def publish(self, app: str) -> None:
        self.phase = "publish_verified_external_binding"
        self.call("POST", f"/apps/{app}/workflows/publish", json={"marked_name": "BYOA acceptance"})

    @staticmethod
    def epoch(draft: dict) -> str:
        data = next(item["data"] for item in draft["graph"]["nodes"] if item["id"] == "external")
        value = data.get("agent_binding", {}).get("binding_epoch")
        require(isinstance(value, str) and value, "The server did not assign a binding epoch.")
        return value

    def stream(self, client: httpx.Client, url: str, payload: dict, *, headers: dict | None = None) -> list[dict]:
        """Retain only identity/status/reason metadata, never raw message content."""
        result = []
        started = time.monotonic()
        with client.stream("POST", url, json=payload, headers=headers, timeout=self.timeout) as response:
            require(
                response.status_code == 200, f"Streaming API returned HTTP {response.status_code} during {self.phase}."
            )
            require(
                "text/event-stream" in response.headers.get("content-type", ""), "Streaming API did not return SSE."
            )
            for line in response.iter_lines():
                require(time.monotonic() - started <= self.timeout, "The bounded SSE collection timed out.")
                if line.startswith("data:"):
                    raw = line.removeprefix("data:").strip()
                    if raw != "[DONE]":
                        value = json.loads(raw)
                        data = value.get("data") or {}
                        result.append(
                            {
                                "event": value.get("event"),
                                "workflow_run_id": value.get("workflow_run_id") or data.get("workflow_run_id"),
                                "task_id": value.get("task_id"),
                                "conversation_id": value.get("conversation_id"),
                                "status": data.get("status"),
                                "reasons": data.get("reasons") or [],
                                "error": data.get("error")
                                or (value.get("message") if value.get("event") == "error" else None),
                            }
                        )
        require(result, "The streaming API returned no events.")
        return result

    def run_identity(self, events: list[dict]) -> str:
        identifier = next((item["workflow_run_id"] for item in events if item["workflow_run_id"]), None)
        if not isinstance(identifier, str) or not identifier:
            raise AcceptanceError("SSE did not expose its workflow run ID.")
        self.report["workflow_runs"].append(identifier)
        return identifier

    def wait_run(self, app: str, identifier: str, *, status: str = "succeeded") -> dict:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            value = self.call("GET", f"/apps/{app}/workflow-runs/{identifier}")
            if value.get("status") == status:
                return value
            require(
                value.get("status") not in {"failed", "stopped", "succeeded", "partial-succeeded"},
                f"The workflow reached an unexpected terminal state during {self.phase}.",
            )
            time.sleep(0.5)
        raise AcceptanceError(f"Workflow polling expired during {self.phase}.")

    def assert_external_pause(self, events: list[dict]) -> None:
        pauses = [item for item in events if item["event"] == "workflow_paused"]
        require(
            pauses and any(reason.get("TYPE") == "external_wait" for item in pauses for reason in item["reasons"]),
            "The run did not emit its genuine ExternalWait pause.",
        )
        require(
            not any(
                reason.get("TYPE") in {"human_input_required", "hitl_required"}
                for item in pauses
                for reason in item["reasons"]
            ),
            "An external wait was presented as HITL.",
        )

    def workflow_and_node_test(self, agent: str) -> None:
        app = self.app("workflow")
        self.save(app, graph(agent))
        self.phase = "full_workflow_external_pause_and_resume"
        events = self.stream(
            self.client,
            self.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": self.text("working", "workflow")}},
        )
        self.assert_external_pause(events)
        result = self.wait_run(app, self.run_identity(events))
        require(result.get("outputs") == {"text": "task ok"}, "Workflow did not consume the fixed external result.")
        self.report["checks"].append("workflow_start_external_end_pause_checkpoint_resume_succeeded")
        self.phase = "standalone_node_test_returns_paused"
        started = time.monotonic()
        pending = self.call(
            "POST",
            f"/apps/{app}/workflows/draft/nodes/external/run",
            json={
                "inputs": {"start.task": self.text("working", "standalone-node")},
            },
        )
        require(
            pending.get("status") == "paused" and time.monotonic() - started < 10,
            "Standalone Node Test did not return a durable pause promptly.",
        )
        require(
            (pending.get("execution_metadata") or {}).get("agent_log", {}).get("invocation_id"),
            "Node Test pause did not expose its Invocation identity.",
        )
        self.report["node_debug_executions"].append(pending["id"])
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            latest = self.call("GET", f"/apps/{app}/workflows/draft/nodes/external/last-run")
            require(latest.get("id") == pending["id"], "Node Test completion changed its caller execution identity.")
            if latest.get("status") == "succeeded":
                require(latest.get("outputs") == {"text": "task ok"}, "Last Run did not receive the durable output.")
                self.report["checks"].append("node_test_paused_then_exact_last_run_succeeded")
                return
            require(latest.get("status") not in {"failed", "stopped"}, "Standalone Node Test failed after pausing.")
            time.sleep(0.5)
        raise AcceptanceError("Standalone Last Run polling expired.")

    def native_regression(self) -> None:
        app = self.app("workflow")
        self.save(app, graph(None))
        self.phase = "native_start_end_regression"
        before = len(self.messages())
        events = self.stream(
            self.client, self.base + f"/apps/{app}/workflows/draft/run", {"inputs": {"task": "native ok"}}
        )
        result = self.wait_run(app, self.run_identity(events))
        require(result.get("outputs") == {"text": "native ok"}, "Native Start-End output changed.")
        require(len(self.messages()) == before, "The Native regression dispatched external business work.")
        self.report["checks"].append("native_start_end_regression")

    def chat(
        self, app: str, key: str, scenario: str, suffix: str, conversation: str | None = None
    ) -> tuple[str, str, list[dict]]:
        self.phase = f"production_chat_{suffix}"
        payload = {
            "inputs": {},
            "query": self.text(scenario, suffix),
            "response_mode": "streaming",
            "user": f"byoa-acceptance-{self.run_id}",
        }
        if conversation:
            payload["conversation_id"] = conversation
        events = self.stream(
            self.service_client, self.service + "/chat-messages", payload, headers={"Authorization": "Bearer " + key}
        )
        actual = next((item["conversation_id"] for item in events if item["conversation_id"]), conversation)
        if not isinstance(actual, str) or not actual:
            raise AcceptanceError("The production Chatflow did not return a conversation ID.")
        require(not conversation or actual == conversation, "The second turn silently created another conversation.")
        return actual, self.run_identity(events), events

    def chat_context_and_busy(self, agent: str) -> None:
        app = self.app("advanced-chat")
        initial = self.save(app, graph(agent, chat=True))
        first_epoch = self.epoch(initial)
        self.publish(app)
        key = self.call("POST", f"/apps/{app}/api-keys", expected=(201,), json={})["token"]
        conversation, first_run, _ = self.chat(app, key, "completed", "first")
        self.report["conversations"].append(conversation)
        self.wait_run(app, first_run)
        first = self.messages()[-1]
        _, second_run, _ = self.chat(app, key, "completed", "second", conversation)
        self.wait_run(app, second_run)
        second = self.messages()[-1]
        require(
            first.get("provided_context") is None and second.get("provided_context") == first["returned_context"],
            "Two production Chatflow turns did not reuse the server-returned context.",
        )
        require(
            "provided_task_id" in second and second["provided_task_id"] is None,
            "A new Chatflow turn carried an old task ID, or the fixture lacks that assertion carrier.",
        )
        self.report["checks"].append("production_chatflow_two_turn_context_reuse_without_old_task_id")
        other = self.create_asset()
        self.save(app, graph(other, chat=True))
        self.publish(app)
        _, other_run, _ = self.chat(app, key, "completed", "agent-b", conversation)
        self.wait_run(app, other_run)
        require(self.messages()[-1].get("provided_context") is None, "Switching Agent reused another asset's context.")
        restored = self.save(app, graph(agent, chat=True))
        require(self.epoch(restored) != first_epoch, "A-B-A did not rotate the server binding epoch.")
        self.publish(app)
        _, again_run, _ = self.chat(app, key, "completed", "agent-a-again", conversation)
        self.wait_run(app, again_run)
        require(self.messages()[-1].get("provided_context") is None, "A-B-A resurrected the old remote context.")
        self.report["checks"].append("production_chatflow_a_b_a_binding_epoch_does_not_resurrect_context")
        _, held_run, events = self.chat(app, key, "hold", "held", conversation)
        self.assert_external_pause(events)
        self.wait_run(app, held_run, status="paused")
        count = len(self.messages())
        _, busy_run, _ = self.chat(app, key, "completed", "busy", conversation)
        self.wait_run(app, busy_run, status="failed")
        require(len(self.messages()) == count, "Busy created another business request for the occupied context slot.")
        self.report["checks"].append("production_chatflow_busy_immediate_error_without_second_send")
        held = self.messages()[-1]
        tasks = self.stats()["tasks"]
        identifiers = [
            identifier
            for identifier, value in tasks.items()
            if value["scenario"] == "hold" and value["context_id"] == held["returned_context"]
        ]
        require(len(identifiers) == 1, "The held fixture task could not be correlated uniquely.")
        response = self.control.post(self.admin + "/release", json={"task_id": identifiers[0]})
        require(response.status_code == 200, "The isolated fixture hold could not be released.")
        self.wait_run(app, held_run)
        self.report["checks"].append("held_production_task_late_result_resumes_original_run")

    @override
    def run(self) -> dict:
        self.login()
        agent = self.create_asset()
        self.workflow_and_node_test(agent)
        self.native_regression()
        self.chat_context_and_busy(agent)
        own = self.messages()
        require(own and all(value["sends"] == 1 for value in own), "A business Send was replayed.")
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            verified_business_messages=len(own),
            dsl_copy_import_coverage="not exercised by this runner",
        )
        return self.report


def main() -> None:
    runner = WorkflowAcceptance()
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
    destination = os.environ.get("BYOA_WORKFLOW_ACCEPTANCE_OUTPUT")
    if destination:
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
