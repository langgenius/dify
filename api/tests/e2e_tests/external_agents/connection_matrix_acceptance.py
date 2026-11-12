"""Real Verify/Card-change/save matrix from the frozen PRD/Figma contract.

Uses fixed read-only /cards/{case}/.well-known/agent-card.json fixture variants,
not an arbitrary mock response endpoint. DIFY_TEST_*/BYOA_FIXTURE_* credentials
and trust settings are the same as the other Console suites. All Verify/Save
phases independently assert zero business sends. No response body is logged.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require
from tests.e2e_tests.external_agents.fixture_server import FILE_BYTES


class ConnectionMatrixAcceptance(ConsoleAcceptance):
    def verify(self, case: str | None, *, agent: str | None = None) -> tuple[dict, dict | None]:
        """Read a real fixed Card and compare against the exact current revision."""
        self.phase = "verify_" + (case or "baseline")
        before = self.stats()["counts"]["send"]
        detail = self.call("GET", f"/external-agents/{agent}") if agent else None
        payload = {
            "endpoint": self.fixture + f"/cards/{case}/.well-known/agent-card.json" if case else self.fixture,
            "auth_type": "none",
            "credential_action": "remove",
        }
        if detail:
            payload.update(agent_id=agent, expected_connection_revision_id=detail["connection"]["revision_id"])
        verified = self.call("POST", "/external-agents/verify", json=payload)
        require(self.stats()["counts"]["send"] == before, "Card Verify sent business work.")
        require(verified["auth_check"] == "not_exercised", "Public Card Verify overstated execution auth checks.")
        return verified, detail

    def create_verified(self, verified: dict, *, label: str) -> str:
        """Save only server-issued evidence and keep local presentation overrides."""
        before = self.stats()["counts"]["send"]
        value = self.call(
            "POST",
            "/external-agents",
            expected=(201,),
            json={
                "verification_id": verified["verification_id"],
                "idempotency_key": str(uuid4()),
                "metadata": {
                    "name": f"BYOA Card matrix {label} {self.run_id[:10]}",
                    "description": "",
                    "role": "Local role",
                },
            },
        )
        require(self.stats()["counts"]["send"] == before, "Save sent business work.")
        self.report["assets"].append(value["resource_id"])
        return value["resource_id"]

    def save_edit(self, agent: str, verified: dict, previous: dict, *, changed: bool) -> dict:
        """Save a verified change and prove generation/presentation semantics."""
        before = self.stats()["counts"]["send"]
        operation = self.call(
            "PUT",
            f"/external-agents/{agent}/connection",
            json={
                "verification_id": verified["verification_id"],
                "expected_revision_id": previous["connection"]["revision_id"],
                "idempotency_key": str(uuid4()),
            },
        )
        current = self.call("GET", f"/external-agents/{agent}")
        require(operation["result"]["changed"] is changed, "Connection edit/no-op classification changed.")
        require(self.stats()["counts"]["send"] == before, "Connection Save sent business work.")
        require(
            current["asset"]["test_display_generation"] == previous["asset"]["test_display_generation"] + int(changed),
            "Connection generation did not follow actual persisted change.",
        )
        for field in ("name", "description", "role"):
            require(current["asset"][field] == previous["asset"][field], "Connection edit overwrote a local override.")
        require(current["asset"]["description"] == "", "Explicitly cleared Description was repopulated from Card.")
        return current

    def failed_verify(self, case: str, *, credential: str | None = None) -> None:
        """A malformed/incompatible/401 Card cannot issue usable save evidence."""
        self.phase = "rejected_verify_" + case
        before = self.stats()["counts"]["send"]
        total = self.call("GET", "/external-agents")["total"]
        endpoint = (
            self.fixture + "/bearer/.well-known/agent-card.json"
            if credential
            else (self.fixture + f"/cards/{case}/.well-known/agent-card.json")
        )
        payload = {
            "endpoint": endpoint,
            "auth_type": "bearer" if credential else "none",
            "credential_action": "replace" if credential else "remove",
        }
        if credential:
            payload["credential"] = credential
        response = self.client.post(self.base + "/external-agents/verify", json=payload)
        require(
            response.status_code in {400, 401, 403, 422} and "verification_id" not in response.json(),
            "Rejected Card/credential issued save evidence.",
        )
        response = self.client.post(
            self.base + "/external-agents",
            json={
                "verification_id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "metadata": {"name": "Forged proof " + self.run_id},
            },
        )
        require(response.status_code in {400, 404, 409}, "A failed Verify was bypassed with invented evidence.")
        require(
            self.call("GET", "/external-agents")["total"] == total and self.stats()["counts"]["send"] == before,
            "Rejected Verify/Save created an asset or business Task.",
        )
        self.report["checks"].append(case + "_no_proof_no_save_no_business_send")

    def skill_default_intersection(self, agent: str) -> None:
        """A PDF-capable Skill cannot widen text-only default input modes."""
        self.phase = "skill_does_not_widen_default_inputs"
        page = "card-input-" + self.run_id
        upload = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("must-not-send.pdf", FILE_BYTES, "application/pdf")},
        )
        before = self.stats()["counts"]["send"]
        started, _ = self.start(agent, "file-input", page=page, leases=[upload["lease_id"]])
        result = self.wait(agent, started["invocation_id"])
        require(
            result["state"] == "failed"
            and result["error_code"] == "agent_file_mode_unsupported"
            and self.stats()["counts"]["send"] == before,
            "A Skill declaration widened the generic input profile or rejected after Send.",
        )
        self.call("DELETE", f"/external-agents/{agent}/test-files/{upload['lease_id']}", expected=(204,))
        self.report["checks"].append("skill_pdf_support_does_not_override_text_only_default_gate")

    @override
    def run(self) -> dict:
        """Execute the fixed Card matrix and report only actual protocol facts."""
        self.login()
        for case in ("missing-required", "invalid-null", "unsupported-required-extension"):
            self.failed_verify(case)
        require(
            os.environ.get("BYOA_FIXTURE_BEARER"), "The explicit 401 check requires a protected fixture read route."
        )
        self.failed_verify("explicit_401", credential=uuid4().hex)
        optional, _ = self.verify("optional-omitted")
        require(optional["warnings"] == {"technical": [], "business": []}, "A first connection invented changes.")
        optional_asset = self.create_verified(optional, label="optional")
        require(
            self.call("GET", f"/external-agents/{optional_asset}")["connection"]["card"]["name"],
            "Omitted optional Card fields prevented a valid save.",
        )
        self.report["checks"].append("optional_omission_valid_first_connection_warnings_empty")
        baseline, _ = self.verify(None)
        require(baseline["warnings"] == {"technical": [], "business": []}, "First Verify has change warnings.")
        agent = self.create_verified(baseline, label="baseline")
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        started, _ = self.start(agent, "hold")
        known = self.wait(
            agent, started["invocation_id"], predicate=lambda value: bool(value["metadata"].get("external_task_id"))
        )
        remote = known["metadata"]["external_task_id"]
        changed, previous = self.verify("changed-skills", agent=agent)
        require(
            changed["warnings"] == {"technical": [], "business": ["skills_changed"]},
            "A Skill-only change was treated as transport incompatibility.",
        )
        assert previous is not None
        self.save_edit(agent, changed, previous, changed=True)
        require(
            self.client.get(self.base + f"/external-agents/{agent}/tests/{started['invocation_id']}").status_code
            == 409,
            "A connection change left the old Test display current.",
        )
        require(
            self.stats()["tasks"][remote]["state"] == "TASK_STATE_WORKING",
            "Saving connection canceled an already accepted old Test.",
        )
        response = self.control.post(self.admin + "/release", json={"task_id": remote})
        require(response.status_code == 200, "The old Test's remote Task could not complete.")
        self.successful_case(agent, "direct")
        require(
            self.client.get(self.base + f"/external-agents/{agent}/tests/{started['invocation_id']}").status_code
            == 409,
            "A late old Test refilled the new generation.",
        )
        self.report["checks"].append("business_skill_change_saves_generation_isolated_old_task_not_canceled")
        combined, previous = self.verify("combined", agent=agent)
        require(
            set(combined["warnings"]["technical"])
            == {
                "input_modes_narrowed",
                "output_modes_narrowed",
                "streaming_removed",
                "auth_requirements_changed",
                "traceability_removed",
            }
            and "agent_info_changed" in combined["warnings"]["business"],
            "Combined technical/business changes were not independently classified.",
        )
        assert previous is not None
        current = self.save_edit(agent, combined, previous, changed=True)
        require(
            current["asset"]["tracing_enabled"] is False, "Removed Traceability kept unsupported collection enabled."
        )
        require(
            current["connection"]["card"]["defaultInputModes"] == ["text/plain"],
            "Saved connection lost the narrowed default input declaration.",
        )
        self.report["checks"].append("combined_technical_business_warnings_nonblocking_preserve_local_and_cleared_info")
        self.skill_default_intersection(agent)
        unchanged, previous = self.verify("combined", agent=agent)
        require(
            unchanged["warnings"] == {"technical": [], "business": []}, "Unchanged declarations retained old warnings."
        )
        assert previous is not None
        self.save_edit(agent, unchanged, previous, changed=False)
        self.report["checks"].append("unchanged_verify_empty_warnings_and_save_no_generation_reset")
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            verified_business_messages=len([v for v in self.stats()["messages"].values() if v["run"] == self.run_id]),
        )
        return self.report


def main() -> None:
    """Write a secret-free report and return failure on any unmet product gate."""
    runner = ConnectionMatrixAcceptance()
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
    if destination := os.environ.get("BYOA_CONNECTION_MATRIX_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
