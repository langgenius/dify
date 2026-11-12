"""PRD/Figma backend product flows against real published Apps and fixture I/O.

Requires the normal DIFY_TEST_*/BYOA_FIXTURE_* environment and
BYOA_TEST_ACTORS_JSON (editor, normal, foreign_owner; optional admin). All App
API keys remain in process memory. Reports contain synthetic IDs and facts only.
This does not claim visual frontend acceptance or invent an A2A call-usage field.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph


class ProductAcceptance(WorkflowAcceptance):
    """Validate management decisions against actual runtime and Monitoring facts."""

    def __init__(self) -> None:
        """Create isolated authenticated clients; no credentials enter the report."""
        super().__init__()
        self.report.update(scope="PRD/Figma backend management + two published Workflows + Chatflow + Monitoring")
        self._keys: dict[str, str] = {}
        self._actors: dict[str, ConsoleAcceptance] = {}
        configured = json.loads(os.environ.get("BYOA_TEST_ACTORS_JSON", "{}"))
        for role in ("editor", "normal", "foreign_owner", "admin"):
            value = configured.get(role)
            if (
                isinstance(value, dict)
                and isinstance(value.get("email"), str)
                and isinstance(value.get("password"), str)
            ):
                self._actors[role] = ConsoleAcceptance(email=value["email"], password=value["password"])
        require(
            all(role in self._actors for role in ("editor", "normal", "foreign_owner")),
            "Product permission acceptance requires Editor, Normal and foreign Owner actors.",
        )
        self._start = datetime.now(UTC) - timedelta(minutes=1)
        self.production_calls = 0

    @override
    def close(self) -> None:
        """Close every role client and both owner clients on pass or failure."""
        for actor in self._actors.values():
            actor.close()
        super().close()

    def own_sends(self) -> int:
        """Count actual fixture POST attempts for this run, not local intentions."""
        return sum(item["sends"] for item in self.messages())

    def metric(self, agent: str, *, app: str | None = None, actor: ConsoleAcceptance | None = None) -> dict:
        """Read four metrics with an explicit inclusive/exclusive UTC window."""
        caller = actor or self
        params = {
            "start": self._start.isoformat(),
            "end": (datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
            "timezone": "UTC",
        }
        if app is not None:
            params["app_id"] = app
        return caller.call("GET", f"/external-agents/{agent}/monitoring", params=params)

    def references(self, agent: str, *, actor: ConsoleAcceptance | None = None) -> dict:
        """Read current graph references, independently of production history."""
        return (actor or self).call("GET", f"/external-agents/{agent}/references")

    def published(self, agent: str, mode: str) -> str:
        """Create and publish an owned graph, keeping its one-time key private."""
        app = self.app(mode)
        self.save(app, graph(agent, chat=mode == "advanced-chat"))
        self.publish(app)
        self._keys[app] = self.call("POST", f"/apps/{app}/api-keys", expected=(201,), json={})["token"]
        return app

    def service_events(self, app: str, path: str, payload: dict, *, denied: bool) -> list[dict]:
        """Collect identity/status only; reject server errors and false successes."""
        events = []
        with self.service_client.stream(
            "POST", self.service + path, json=payload, headers={"Authorization": "Bearer " + self._keys[app]}
        ) as response:
            if response.status_code != 200:
                require(
                    denied and response.status_code in {400, 403, 404, 409},
                    "A published App returned an unexpected non-success response.",
                )
                return [{"event": "admission_rejected", "http_status": response.status_code}]
            require(
                "text/event-stream" in response.headers.get("content-type", ""),
                "The production API did not return SSE.",
            )
            for line in response.iter_lines():
                if line.startswith("data:") and line.removeprefix("data:").strip() != "[DONE]":
                    item = json.loads(line.removeprefix("data:").strip())
                    data = item.get("data") or {}
                    events.append(
                        {
                            "event": item.get("event"),
                            "workflow_run_id": item.get("workflow_run_id") or data.get("workflow_run_id"),
                            "conversation_id": item.get("conversation_id"),
                            "status": data.get("status"),
                            "reasons": data.get("reasons") or [],
                        }
                    )
        require(events, "A production API stream returned no events.")
        return events

    def production(
        self,
        app: str,
        scenario: str,
        suffix: str,
        *,
        chat: bool = False,
        conversation: str | None = None,
        denied: bool = False,
        held: bool = False,
    ) -> tuple[str | None, str | None]:
        """Run a published App and verify its durable outcome, without republishing."""
        self.phase = "production_" + suffix
        payload = {
            "inputs": {} if chat else {"task": self.text(scenario, suffix)},
            "response_mode": "streaming",
            "user": "byoa-product-" + self.run_id,
        }
        if chat:
            payload["query"] = self.text(scenario, suffix)
            if conversation:
                payload["conversation_id"] = conversation
        before = self.own_sends()
        events = self.service_events(app, "/chat-messages" if chat else "/workflows/run", payload, denied=denied)
        run = next((item.get("workflow_run_id") for item in events if item.get("workflow_run_id")), None)
        actual = next((item.get("conversation_id") for item in events if item.get("conversation_id")), conversation)
        if isinstance(run, str):
            self.report["workflow_runs"].append(run)
            result = self.wait_run(app, run, status="failed" if denied else "paused" if held else "succeeded")
            if not denied and not chat and not held:
                require(result.get("outputs") == {"text": "task ok"}, "Published Workflow output changed.")
        else:
            require(
                denied and any(item["event"] in {"admission_rejected", "error"} for item in events),
                "The published App returned no durable run identity.",
            )
        if denied:
            require(self.own_sends() == before, "A disabled/deleted published App sent business work.")
        else:
            if held:
                self.assert_external_pause(events)
                self.wait_new_message(before, scenario)
            require(self.own_sends() == before + 1, "Published App execution did not cause exactly one Send.")
            self.production_calls += 1
        if chat and not denied:
            require(
                isinstance(actual, str) and actual and (conversation is None or actual == conversation),
                "The production Chatflow changed the conversation unexpectedly.",
            )
        return actual if isinstance(actual, str) else None, run if isinstance(run, str) else None

    def wait_new_message(self, previous: int, scenario: str) -> dict:
        """Wait until the peer accepted a dispatch before changing connection state."""
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            messages = self.messages()
            if sum(item["sends"] for item in messages) > previous:
                require(messages[-1]["scenario"] == scenario, "A different fixture scenario was dispatched.")
                return messages[-1]
            time.sleep(0.2)
        raise AcceptanceError("The fixture did not observe the expected production Send.")

    def node_result(self, app: str, run: str) -> dict:
        """Read the existing external node record, without resolving current assets."""
        rows = self.call("GET", f"/apps/{app}/workflow-runs/{run}/node-executions")["data"]
        matches = [item for item in rows if item.get("node_id") == "external"]
        require(len(matches) == 1, "The production run did not retain exactly one external node record.")
        return matches[0]

    def node_debug(self, app: str, *, denied: bool) -> None:
        """Exercise the Node Test surface and read the exact Last Run identity."""
        self.phase = "node_debug_disabled" if denied else "node_debug_trace"
        before = self.own_sends()
        response = self.client.post(
            self.base + f"/apps/{app}/workflows/draft/nodes/external/run",
            json={"inputs": {"start.task": self.text("trace", self.phase)}},
        )
        if response.status_code != 200:
            require(denied and response.status_code in {400, 403, 404, 409}, "Node Test returned an unexpected error.")
        else:
            pending = response.json()
            deadline = time.monotonic() + self.timeout
            latest = pending
            while latest.get("status") in {"running", "paused"} and time.monotonic() < deadline:
                latest = self.call("GET", f"/apps/{app}/workflows/draft/nodes/external/last-run")
                require(latest.get("id") == pending["id"], "Last Run changed its execution identity.")
                time.sleep(0.3)
            require(
                latest.get("status") == ("failed" if denied else "succeeded"),
                "Node Test did not reach its required terminal state.",
            )
        require(self.own_sends() == before + (0 if denied else 1), "Node Test sent an unauthorized/repeated request.")

    def assert_metrics(self, agent: str, apps: list[str]) -> None:
        """Compare total/daily/App metrics under one exact scope without zero filling."""
        result = self.metric(agent)
        summary = result["summary"]
        require(
            summary["calls"] == self.production_calls
            and sum(day["metrics"]["calls"] for day in result["days"]) == self.production_calls,
            "Monitoring included debug/Test work or lost production calls.",
        )
        require(
            summary["reported_tokens"] is None
            and summary["token_reporting_numerator"] == 0
            and summary["token_reporting_denominator"] == self.production_calls
            and summary["token_reporting_coverage"] == (0 if self.production_calls else None),
            "Missing call-scoped usage was incorrectly zero-filled or derived from Trace steps.",
        )
        require({item["id"] for item in result["apps"]} == set(apps), "Monitoring App scope changed.")
        if self.production_calls:
            require(
                isinstance(summary["average_call_duration"], (int, float)) and summary["average_call_duration"] >= 0,
                "Completed calls lack an observed duration.",
            )
            filtered = [self.metric(agent, app=app)["summary"] for app in apps]
            require(sum(item["calls"] for item in filtered) == summary["calls"], "Per-App Calls do not sum to total.")
            weighted = sum(item["average_call_duration"] * item["calls"] for item in filtered)
            require(
                abs(weighted / summary["calls"] - summary["average_call_duration"]) < 1e-6,
                "Per-App and total mean durations use different scopes.",
            )

    def reference_roles(self, agent: str, apps: list[str]) -> None:
        """Check preflight permissions using real users and same Monitoring scope."""
        self.phase = "references_roles"
        for role, actor in self._actors.items():
            if role in {"normal", "foreign_owner"}:
                response = actor.client.get(actor.base + f"/external-agents/{agent}/references")
                require(response.status_code in {403, 404}, "A disallowed actor read App reference details.")
                require(not any(app in response.text for app in apps), "Rejected references disclosed an App identity.")
            else:
                references = self.references(agent, actor=actor)
                metric = self.metric(agent, actor=actor)
                require(
                    {row["app_id"] for row in references["apps"]} == {row["id"] for row in metric["apps"]},
                    "Reference App visibility differs from Monitoring's admitted App scope.",
                )
        self.report["checks"].append("references_editor_admin_scope_normal_and_foreign_denied")

    def edit_and_connection(self, agent: str, app: str, conversation: str, first_context: str) -> None:
        """Prove metadata keeps context, while a verified connection revision rotates it."""
        detail = self.call("GET", f"/external-agents/{agent}")
        verifies = self.stats()["counts"]["verify"]
        self.call(
            "PATCH",
            f"/external-agents/{agent}/info",
            json={
                "expected_revision": detail["asset"]["metadata_revision"],
                "changes": {
                    "name": f"BYOA product edited {self.run_id[:10]}",
                    "role": "Product acceptance",
                    "description": "Local presentation override",
                },
            },
        )
        require(self.stats()["counts"]["verify"] == verifies, "Edit info unnecessarily required Verify.")
        self.production(app, "completed", "after-info", chat=True, conversation=conversation)
        require(
            self.messages()[-1]["provided_context"] == first_context
            and self.messages()[-1]["provided_task_id"] is None,
            "Edit info reset production context.",
        )
        self.report["checks"].append("edit_info_no_verify_no_production_context_reset")
        before = self.own_sends()
        _, held_run = self.production(app, "hold", "before-connection", chat=True, conversation=conversation, held=True)
        held = self.messages()[-1]
        require(self.references(agent)["may_have_in_flight"] is True, "Delete preflight missed accepted work.")
        previous = self.call("GET", f"/external-agents/{agent}")
        old_revision = previous["connection"]["revision_id"]
        proof = self.call(
            "POST",
            "/external-agents/verify",
            json={
                "endpoint": self.fixture + "/.well-known/agent-card.json",
                "auth_type": "none",
                "credential_action": "remove",
                "agent_id": agent,
                "expected_connection_revision_id": old_revision,
            },
        )
        operation = self.call(
            "PUT",
            f"/external-agents/{agent}/connection",
            json={
                "verification_id": proof["verification_id"],
                "expected_revision_id": old_revision,
                "idempotency_key": str(uuid4()),
            },
        )
        current = self.call("GET", f"/external-agents/{agent}")
        require(
            operation["result"]["changed"] is True and current["connection"]["revision_id"] != old_revision,
            "A real endpoint configuration edit did not create an immutable revision.",
        )
        require(self.own_sends() == before + 1, "Connection Verify/Save caused business Send.")
        self.production(app, "completed", "after-connection", chat=True, conversation=conversation)
        require(self.messages()[-1]["provided_context"] is None, "A new connection reused the old remote context.")
        response = self.control.post(self.admin + "/release", json={"task_id": held["created_task_id"]})
        require(response.status_code == 200, "The old connection's held Task could not be released.")
        assert held_run is not None
        self.wait_run(app, held_run)
        log = self.node_result(app, held_run)["execution_metadata"]["agent_log"]
        require(
            log["connection_revision_id"] == old_revision and log["external_task_id"] == held["created_task_id"],
            "Editing connection rebound the already dispatched Task.",
        )
        self.report["checks"].append("connection_new_context_old_task_keeps_original_revision_and_identity")

    @override
    def run(self) -> dict:
        """Execute the management lifecycle with assertions at each causal boundary."""
        self.login()
        for actor in self._actors.values():
            actor.login()
        agent = self.create_asset()
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        empty = self.metric(agent)["summary"]
        require(
            empty["calls"] == 0
            and empty["average_call_duration"] is None
            and empty["reported_tokens"] is None
            and empty["token_reporting_coverage"] is None,
            "Empty Monitoring invented observations.",
        )
        workflow_a, workflow_b = self.published(agent, "workflow"), self.published(agent, "workflow")
        chat = self.published(agent, "advanced-chat")
        apps = [workflow_a, workflow_b, chat]
        references = self.references(agent)
        require(
            {row["app_id"] for row in references["apps"]} == set(apps) and references["may_have_in_flight"] is False,
            "Preflight missed unused published/draft references.",
        )
        self.report["checks"].append("references_before_any_production_history_include_all_three_apps")
        _, first_run = self.production(workflow_a, "trace", "workflow-a")
        self.production(workflow_b, "completed", "workflow-b")
        conversation, _ = self.production(chat, "completed", "chat-first", chat=True)
        assert isinstance(conversation, str)
        assert first_run is not None
        first_context = self.messages()[-1]["returned_context"]
        snapshot = self.node_result(workflow_a, first_run)["execution_metadata"]["agent_log"]["asset_snapshot"]
        self.assert_metrics(agent, apps)
        self.reference_roles(agent, apps)
        overview = self.successful_case(agent, "trace")
        trace = self.call("GET", f"/external-agent-invocations/{overview['invocation_id']}/trace")
        require(
            trace["received_steps"] == 1 and trace["steps"][0]["total_tokens"] == 0,
            "The fixture's reported zero step usage was not preserved.",
        )
        self.node_debug(workflow_a, denied=False)
        self.assert_metrics(agent, apps)
        self.report["checks"].append(
            "four_metrics_same_three_app_scope_overview_and_node_debug_excluded_step_zero_not_call_usage"
        )
        self.edit_and_connection(agent, chat, conversation, first_context)
        require(
            self.node_result(workflow_a, first_run)["execution_metadata"]["agent_log"]["asset_snapshot"] == snapshot,
            "Editing asset metadata rewrote historical identity.",
        )
        self.assert_metrics(agent, apps)
        published_ids = {app: self.call("GET", f"/apps/{app}")["workflow"]["id"] for app in apps}
        self.call("PUT", f"/external-agents/{agent}/enabled", json={"enabled": False})
        for app in (workflow_a, workflow_b):
            self.production(app, "completed", "disabled-workflow", denied=True)
        self.production(chat, "completed", "disabled-chat", chat=True, conversation=conversation, denied=True)
        self.node_debug(workflow_a, denied=True)
        self.successful_case(agent, "direct")
        self.assert_metrics(agent, apps)
        self.call("PUT", f"/external-agents/{agent}/enabled", json={"enabled": True})
        self.production(workflow_a, "completed", "enabled-without-republish")
        require(
            {app: self.call("GET", f"/apps/{app}")["workflow"]["id"] for app in apps} == published_ids,
            "Availability switching required or changed publication.",
        )
        self.report["checks"].append(
            "disable_blocks_published_workflows_chat_and_node_test_overview_allowed_enable_no_republish"
        )
        self.assert_metrics(agent, apps)
        require(self.references(agent)["may_have_in_flight"] is False, "Terminal Tasks remained marked in flight.")
        current_name = self.call("GET", f"/external-agents/{agent}")["asset"]["name"]
        before = self.own_sends()
        self.call("DELETE", f"/external-agents/{agent}", expected=(204,))
        response = self.client.get(self.base + f"/external-agents/{agent}")
        require(response.status_code == 404, "Deleted asset detail remained accessible.")
        proof = self.call(
            "POST",
            "/external-agents/verify",
            json={"endpoint": self.fixture, "auth_type": "none", "credential_action": "remove"},
        )
        replacement = self.call(
            "POST",
            "/external-agents",
            expected=(201,),
            json={
                "verification_id": proof["verification_id"],
                "idempotency_key": str(uuid4()),
                "metadata": {"name": current_name},
            },
        )["resource_id"]
        self.report["assets"].append(replacement)
        require(
            replacement != agent and self.references(replacement)["apps"] == [],
            "A same-name replacement inherited old App references.",
        )
        for app in apps:
            draft = self.call("GET", f"/apps/{app}/workflows/draft")
            binding = next(
                node["data"]["agent_binding"] for node in draft["graph"]["nodes"] if node["id"] == "external"
            )
            require(
                binding.get("agent_id") != replacement and binding["original_reference"]["agent_id"] == agent,
                "A same-name asset silently repaired an old disconnected binding.",
            )
        self.production(workflow_a, "completed", "deleted-old-binding", denied=True)
        self.production(chat, "completed", "deleted-old-chat", chat=True, conversation=conversation, denied=True)
        require(self.own_sends() == before, "Delete/recreate or an old binding caused business Send.")
        require(
            self.node_result(workflow_a, first_run)["execution_metadata"]["agent_log"]["asset_snapshot"] == snapshot,
            "Deleting an asset erased or reassigned historical run identity.",
        )
        self.report["checks"].append("delete_preserves_old_reference_and_history_same_name_reconnect_never_automatic")
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            production_dispatches=self.production_calls,
            verified_business_messages=len(self.messages()),
            usage_boundary="No A2A 1.0 standard call-total proof: step 0 preserved; call usage remains null, not 0.",
        )
        return self.report


def main() -> None:
    """Write a secret-free product evidence report; any unmet check exits nonzero."""
    runner = ProductAcceptance()
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
    if destination := os.environ.get("BYOA_PRODUCT_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
