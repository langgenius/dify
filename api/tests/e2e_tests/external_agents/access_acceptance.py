"""Real HTTP role, generation, credential and test-page lifecycle acceptance.

Owner credentials use DIFY_TEST_EMAIL/PASSWORD. Other isolated test principals
come only from BYOA_TEST_ACTORS_JSON: editor/normal/foreign_owner and optional
admin, each with email/password. Never print that environment value or bodies.
Run as tests.e2e_tests.external_agents.access_acceptance with PYTHONPATH=api.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require


class AccessAcceptance(ConsoleAcceptance):
    def __init__(self) -> None:
        super().__init__()
        self.report.update(scope="real HTTP permissions and lifecycle", skipped=[])
        self.actors: dict[str, ConsoleAcceptance] = {"owner": self}
        configured = json.loads(os.environ.get("BYOA_TEST_ACTORS_JSON", "{}"))
        require(isinstance(configured, dict), "Actor configuration must be an object.")
        for role in ("editor", "normal", "foreign_owner", "admin"):
            value = configured.get(role)
            if (
                isinstance(value, dict)
                and isinstance(value.get("email"), str)
                and isinstance(value.get("password"), str)
            ):
                actor = ConsoleAcceptance(email=value["email"], password=value["password"])
                actor.run_id = f"{self.run_id}-{role}"
                self.actors[role] = actor
            else:
                self.report["skipped"].append({"role": role, "reason": "actor credentials not configured"})
        self.operation_id = ""
        self.verification_id = ""

    @override
    def close(self) -> None:
        for role, actor in self.actors.items():
            if role != "owner":
                actor.close()
        super().close()

    def response(self, actor, method, path, *, expected=(200,), **kwargs):
        actor.phase = self.phase
        response = actor.client.request(method, actor.base + path, **kwargs)
        require(
            response.status_code in expected,
            f"Unexpected HTTP {response.status_code} for {method} during {self.phase}.",
        )
        return response

    def own_sends(self) -> int:
        return sum(row["sends"] for row in self.stats()["messages"].values() if row["run"].startswith(self.run_id))

    def record(self, name: str, *, role="owner") -> None:
        self.report["checks"].append({"role": role, "name": name})

    def saved_asset(self, actor, role, *, bearer=None):
        self.phase = "manager_verify_save"
        before = self.own_sends()
        endpoint = self.fixture + "/bearer/.well-known/agent-card.json" if bearer else self.fixture
        verified = actor.call(
            "POST",
            "/external-agents/verify",
            json={
                "endpoint": endpoint,
                "auth_type": "bearer" if bearer else "none",
                "credential_action": "replace" if bearer else "remove",
                "credential": bearer,
            },
        )
        operation = actor.call(
            "POST",
            "/external-agents",
            expected=(201,),
            json={
                "verification_id": verified["verification_id"],
                "idempotency_key": str(uuid4()),
                "metadata": {"name": f"BYOA access {self.run_id[:12]} {role} {uuid4().hex[:8]}"},
            },
        )
        require(self.own_sends() == before, "Verify/Save caused an external business Send.")
        self.report["assets"].append(operation["resource_id"])
        self.record("verify_save_without_business_send", role=role)
        return operation["resource_id"], verified["verification_id"], operation["id"]

    def deny_mutations(self, actor, role, agent, detail) -> None:
        self.phase = f"{role}_management_denied"
        before = self.own_sends()
        requests = [
            (
                "POST",
                "/external-agents/verify",
                {"endpoint": self.fixture, "auth_type": "none", "credential_action": "remove"},
            ),
            (
                "POST",
                "/external-agents",
                {"verification_id": self.verification_id, "idempotency_key": str(uuid4()), "metadata": {}},
            ),
            (
                "PATCH",
                f"/external-agents/{agent}/info",
                {
                    "expected_revision": detail["asset"]["metadata_revision"],
                    "changes": {"description": "unauthorized change"},
                },
            ),
            (
                "PUT",
                f"/external-agents/{agent}/connection",
                {
                    "verification_id": self.verification_id,
                    "expected_revision_id": detail["connection"]["revision_id"],
                    "idempotency_key": str(uuid4()),
                },
            ),
            ("PUT", f"/external-agents/{agent}/enabled", {"enabled": False}),
            ("PUT", f"/external-agents/{agent}/tracing", {"enabled": True}),
            ("DELETE", f"/external-agents/{agent}", None),
        ]
        for method, path, payload in requests:
            self.response(actor, method, path, expected=(403, 404), **({"json": payload} if payload else {}))
        require(self.own_sends() == before, "Rejected management attempted external business work.")
        self.record("verify_create_info_connection_switch_delete_rejected", role=role)

    def roles(self, agent, owner_test) -> None:
        detail = self.call("GET", f"/external-agents/{agent}")
        editor = self.actors.get("editor")
        if editor:
            self.phase = "editor_select_and_test"
            listed = editor.call("GET", "/external-agents", params={"enabled": "true"})
            require(any(item["id"] == agent for item in listed["items"]), "Editor could not select the existing asset.")
            editor.call("GET", f"/external-agents/{agent}")
            result = editor.successful_case(agent, "direct")
            require(result["outputs"] == {"text": "direct ok"}, "Editor Run Test did not complete.")
            self.record("detail_selector_and_run_test_allowed", role="editor")
            self.deny_mutations(editor, "editor", agent, detail)
        normal = self.actors.get("normal")
        if normal:
            self.phase = "normal_list_only"
            listed = normal.call("GET", "/external-agents")
            require(
                any(item["id"] == agent for item in listed["items"]), "Normal could not see the permitted roster row."
            )
            self.response(normal, "GET", f"/external-agents/{agent}", expected=(403, 404))
            self.response(
                normal,
                "POST",
                f"/external-agents/{agent}/tests",
                expected=(403, 404),
                json={
                    "page_session_id": f"normal-{self.run_id}",
                    "expected_generation": detail["asset"]["test_display_generation"],
                    "idempotency_key": str(uuid4()),
                    "task_text": f"[byoa:direct:{self.run_id}-denied]",
                },
            )
            self.record("list_visible_detail_and_test_rejected", role="normal")
            self.deny_mutations(normal, "normal", agent, detail)
        foreign = self.actors.get("foreign_owner")
        if foreign:
            self.phase = "foreign_owner_chain"
            before = self.own_sends()
            now = datetime.now(UTC)
            routes = [
                (f"/external-agents/{agent}", {}),
                (f"/external-agent-operations/{self.operation_id}", {}),
                (f"/external-agents/{agent}/tests/{owner_test}", {}),
                (f"/external-agent-invocations/{owner_test}/trace", {}),
                (
                    f"/external-agents/{agent}/monitoring",
                    {
                        "params": {
                            "start": (now - timedelta(days=1)).isoformat(),
                            "end": now.isoformat(),
                            "timezone": "UTC",
                        }
                    },
                ),
            ]
            for path, options in routes:
                self.response(foreign, "GET", path, expected=(403, 404), **options)
            self.response(
                foreign,
                "POST",
                f"/external-agents/{agent}/tests",
                expected=(403, 404),
                json={
                    "page_session_id": f"foreign-{self.run_id}",
                    "expected_generation": detail["asset"]["test_display_generation"],
                    "idempotency_key": str(uuid4()),
                    "task_text": f"[byoa:direct:{self.run_id}-denied]",
                },
            )
            require(self.own_sends() == before, "Cross-tenant calls caused an external Send.")
            self.record("asset_operation_test_trace_monitoring_cross_tenant_rejected", role="foreign_owner")

    def generation(self, agent, invocation, remote_task) -> None:
        self.phase = "info_generation"
        detail = self.call("GET", f"/external-agents/{agent}")
        asset = detail["asset"]
        no_op = self.call(
            "PATCH",
            f"/external-agents/{agent}/info",
            json={"expected_revision": asset["metadata_revision"], "changes": {"description": asset["description"]}},
        )
        require(
            no_op["test_display_generation"] == asset["test_display_generation"], "Info no-op reset Test generation."
        )
        self.call("GET", f"/external-agents/{agent}/tests/{invocation}")
        changed = self.call(
            "PATCH",
            f"/external-agents/{agent}/info",
            json={
                "expected_revision": asset["metadata_revision"],
                "changes": {"description": f"Changed {self.run_id}"},
            },
        )
        require(
            changed["test_display_generation"] == asset["test_display_generation"] + 1,
            "Real edit did not reset generation.",
        )
        self.response(self, "GET", f"/external-agents/{agent}/tests/{invocation}", expected=(409,))
        require(
            self.stats()["tasks"][remote_task]["state"] == "TASK_STATE_WORKING",
            "Info edit canceled the old remote task.",
        )
        response = self.control.post(self.admin + "/release", json={"task_id": remote_task})
        require(response.status_code == 200, "Fixture could not release the old task.")
        self.response(self, "GET", f"/external-agents/{agent}/tests/{invocation}", expected=(409,))
        self.successful_case(agent, "direct")
        self.response(self, "GET", f"/external-agents/{agent}/tests/{invocation}", expected=(409,))
        self.record("noop_preserves_generation_real_edit_hides_old_test_without_cancel_or_late_refill")

    def connection_noop(self, agent, *, actor=None, role="owner") -> None:
        self.phase = f"{role}_connection_noop"
        caller = actor or self
        caller.phase = self.phase
        before = caller.call("GET", f"/external-agents/{agent}")
        sends = self.own_sends()
        proof = caller.call(
            "POST",
            "/external-agents/verify",
            json={
                "endpoint": self.fixture,
                "auth_type": "none",
                "credential_action": "remove",
                "agent_id": agent,
                "expected_connection_revision_id": before["connection"]["revision_id"],
            },
        )
        operation = caller.call(
            "PUT",
            f"/external-agents/{agent}/connection",
            json={
                "verification_id": proof["verification_id"],
                "expected_revision_id": before["connection"]["revision_id"],
                "idempotency_key": str(uuid4()),
            },
        )
        after = caller.call("GET", f"/external-agents/{agent}")
        require(operation["result"]["changed"] is False, "Unchanged verified connection was treated as an edit.")
        require(
            after["asset"]["test_display_generation"] == before["asset"]["test_display_generation"],
            "Unchanged connection reset the Test display generation.",
        )
        require(self.own_sends() == sends, "Owner connection Verify/Save sent business work.")
        self.record("connection_verify_save_noop_preserves_generation", role=role)

    def credentials(self) -> None:
        bearer = os.environ.get("BYOA_FIXTURE_BEARER")
        if not bearer:
            self.report["skipped"].append(
                {"check": "bearer_write_only_and_401", "reason": "fixture Bearer not configured"}
            )
            return
        agent, _proof, operation = self.saved_asset(self, "credential", bearer=bearer)
        self.phase = "credential_write_only"
        for path in (f"/external-agents/{agent}", f"/external-agent-operations/{operation}", "/external-agents"):
            body = self.call("GET", path)
            require(bearer not in json.dumps(body), "A credential was returned by a public read surface.")
        before = self.own_sends()
        failed = self.response(
            self,
            "POST",
            "/external-agents/verify",
            expected=(400, 401, 403),
            json={
                "endpoint": self.fixture + "/bearer/.well-known/agent-card.json",
                "auth_type": "bearer",
                "credential_action": "replace",
                "credential": uuid4().hex,
            },
        )
        require("verification_id" not in failed.json(), "A failed credential probe issued save evidence.")
        self.response(
            self,
            "POST",
            "/external-agents",
            expected=(400, 404, 409),
            json={"verification_id": str(uuid4()), "idempotency_key": str(uuid4()), "metadata": {}},
        )
        require(self.own_sends() == before, "Failed Verify/forged Save dispatched business work.")
        self.record("bearer_write_only_401_probe_no_save_evidence_and_no_business_send")

    def page_lifecycle(self, agent) -> None:
        self.phase = "page_leave"
        page = f"leave-{self.run_id}"
        content = b"BYOA submitted input survives page leave until remote terminal."
        uploaded = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("owned.txt", content, "text/plain")},
        )
        start, _payload = self.start(
            agent, "hold", page=page, leases=[uploaded["lease_id"]], outputs=[{"name": "report", "kind": "file"}]
        )
        invocation = start["invocation_id"]
        known = self.wait(agent, invocation, predicate=lambda value: bool(value["metadata"].get("external_task_id")))
        remote = known["metadata"]["external_task_id"]
        self.call("POST", "/external-agent-tests/leave-page", expected=(202,), json={"page_session_id": page})
        preview = self.call("GET", f"/files/{uploaded['file_id']}/preview")
        require(content.decode() in preview["content"], "Page leave deleted the in-flight submitted input.")
        require(self.stats()["tasks"][remote]["state"] == "TASK_STATE_WORKING", "Page leave canceled business work.")
        self.response(
            self,
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(400, 409),
            data={"page_session_id": page},
            files={"file": ("revived.txt", b"denied", "text/plain")},
        )
        response = self.control.post(
            self.admin + "/release", json={"task_id": remote, "output_scenario": "file-output"}
        )
        require(response.status_code == 200, "Fixture release failed.")
        ended = self.wait(agent, invocation)
        require(ended["outputs"] is None, "A left page materialized/refilled late file output.")
        require(
            str(ended["metadata"].get("external_task_status", "")).lower().removeprefix("task_state_") == "completed",
            "The runtime did not retain confirmed remote completion after page leave.",
        )
        require(
            self.stats()["tasks"][remote]["state"] == "TASK_STATE_COMPLETED", "Remote terminal proof was not retained."
        )
        self.record("page_leave_keeps_submitted_input_and_blocks_late_file_materialization")

    @override
    def run(self):
        owner_workspace = None
        self.report["actor_scopes"] = {}
        for role, actor in self.actors.items():
            self.phase = f"{role}_login"
            actor.login()
            summary = actor.call("GET", "/workspaces/current/summary")
            require(
                summary["role"] == ("owner" if role == "foreign_owner" else role),
                "Configured actor label does not match its server-reported role.",
            )
            if role == "owner":
                owner_workspace = summary["id"]
            else:
                require(
                    (summary["id"] != owner_workspace) == (role == "foreign_owner"),
                    "Actor workspace scope does not match the acceptance matrix.",
                )
            self.report["actor_scopes"][role] = {"workspace_id": summary["id"], "role": summary["role"]}
            self.record("cookie_login_and_csrf", role=role)
        agent, self.verification_id, self.operation_id = self.saved_asset(self, "owner")
        started, _payload = self.start(agent, "hold")
        known = self.wait(
            agent, started["invocation_id"], predicate=lambda value: bool(value["metadata"].get("external_task_id"))
        )
        self.roles(agent, started["invocation_id"])
        self.generation(agent, started["invocation_id"], known["metadata"]["external_task_id"])
        self.connection_noop(agent)
        self.call("PUT", f"/external-agents/{agent}/enabled", json={"enabled": False})
        self.successful_case(agent, "direct")
        self.call("PUT", f"/external-agents/{agent}/enabled", json={"enabled": True})
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        self.record("owner_switch_management_and_disabled_overview_test_allowed")
        self.credentials()
        self.page_lifecycle(agent)
        admin = self.actors.get("admin")
        if admin:
            extra, _proof, _operation = self.saved_asset(admin, "admin")
            detail = admin.call("GET", f"/external-agents/{extra}")
            admin.call(
                "PATCH",
                f"/external-agents/{extra}/info",
                json={
                    "expected_revision": detail["asset"]["metadata_revision"],
                    "changes": {"description": "Admin update"},
                },
            )
            admin.call("PUT", f"/external-agents/{extra}/enabled", json={"enabled": False})
            admin.call("PUT", f"/external-agents/{extra}/enabled", json={"enabled": True})
            admin.call("PUT", f"/external-agents/{extra}/tracing", json={"enabled": True})
            self.connection_noop(extra, actor=admin, role="admin")
            admin.call("DELETE", f"/external-agents/{extra}", expected=(204,))
            self.record("manage_verify_save_info_connection_switch_delete_allowed", role="admin")
        extra, _proof, _operation = self.saved_asset(self, "owner-delete")
        self.call("DELETE", f"/external-agents/{extra}", expected=(204,))
        self.record("owner_delete_allowed")
        self.report.update(result="passed", finished_at=datetime.now(UTC).isoformat())
        return self.report


def main():
    runner = AccessAcceptance()
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
    target = os.environ.get("BYOA_ACCESS_ACCEPTANCE_OUTPUT") or os.environ.get("BYOA_ACCEPTANCE_OUTPUT")
    if target:
        Path(target).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
