"""Real Console/Workflow interoperability against the pinned official SDK peer.

Run in Dify's normal environment. The SDK server runs separately with its
optional locked dependencies. BYOA_SDK_PUBLIC_URL/BYOA_SDK_ADMIN_URL point to
that isolated HTTPS service; existing DIFY_TEST_* and CA variables are reused.
Reports contain synthetic identities, protocol counts and validation facts only.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import override
from uuid import uuid4

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph

SDK_VERSION = "1.3.0"
SDK_FILE_BYTES = b"%PDF-1.4\nOfficial A2A SDK interoperability\n%%EOF\n"
INPUT_BYTES = b"%PDF-1.4\nDify sends authorized bytes to the official SDK\n%%EOF\n"


class OfficialSDKAcceptance(WorkflowAcceptance):
    """Exercise product APIs; no direct call can manufacture a Dify receipt."""

    def __init__(self) -> None:
        """Bind authenticated Dify clients and an independently deployed SDK peer."""
        super().__init__()
        self.fixture = os.environ["BYOA_SDK_PUBLIC_URL"].rstrip("/")
        self.admin = os.environ.get("BYOA_SDK_ADMIN_URL", self.fixture + "/admin").rstrip("/")
        self.report["scope"] = "real Dify Console + Workflow -> official a2a-sdk 1.3.0 HTTP+JSON 1.0 server"

    @override
    def stats(self) -> dict:
        """Read only SDK-owned request/execution observations over verified TLS."""
        response = self.control.get(self.admin + "/state")
        require(response.status_code == 200, "The official SDK observer is unavailable.")
        value = response.json()
        require(value["sdk_version"] == SDK_VERSION, "The official SDK version differs from the test pin.")
        require(value["compat_v0_3_enabled"] is False, "The SDK peer enabled the excluded 0.3 adapter.")
        return value

    def sdk_asset(self, *, streaming: bool) -> str:
        """Verify a real SDK Card without Send, then save its verified binding."""
        self.phase = "verify_official_sdk_stream_card" if streaming else "verify_official_sdk_card"
        before = self.stats()["counts"]
        verified = self.call(
            "POST",
            "/external-agents/verify",
            json={
                "endpoint": self.fixture + "/stream/.well-known/agent-card.json" if streaming else self.fixture,
                "auth_type": "none",
                "credential_action": "remove",
            },
        )
        after = self.stats()["counts"]
        require(
            after["send"] == before["send"] and after["stream"] == before["stream"],
            "Verify sent business work to the SDK.",
        )
        require(verified["auth_check"] == "not_exercised", "SDK public Card Verify overstated its auth scope.")
        saved = self.call(
            "POST",
            "/external-agents",
            expected=(201,),
            json={
                "verification_id": verified["verification_id"],
                "idempotency_key": str(uuid4()),
                "metadata": {"name": f"BYOA SDK interop {self.run_id[:10]} {'stream' if streaming else 'plain'}"},
            },
        )
        self.report["assets"].append(saved["resource_id"])
        self.report["checks"].append(
            "official_sdk_stream_verify_no_business" if streaming else "official_sdk_verify_no_business"
        )
        return saved["resource_id"]

    def file_cases(self, agent: str) -> None:
        """Verify real authorized input bytes and durable SDK raw-file output."""
        self.phase = "official_sdk_file_input"
        page = f"sdk-file-{self.run_id}"
        uploaded = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("sdk-input.pdf", INPUT_BYTES, "application/pdf")},
        )
        result = self.successful_case(
            agent,
            "file-input",
            page=page,
            leases=[uploaded["lease_id"]],
            outputs=[
                {"name": "text", "kind": "string"},
                {"name": "file_count", "kind": "number"},
                {"name": "total_bytes", "kind": "number"},
            ],
        )
        require(
            result["outputs"] == {"text": "official sdk input ok", "file_count": 1, "total_bytes": len(INPUT_BYTES)},
            "The SDK did not receive/map the explicit file bytes exactly.",
        )
        own = [v for v in self.messages() if v["scenario"] == "file-input"]
        require(
            len(own) == 1
            and own[0]["input_files"]
            == [
                {
                    "size": len(INPUT_BYTES),
                    "sha256": hashlib.sha256(INPUT_BYTES).hexdigest(),
                    "media_type": "application/pdf",
                }
            ],
            "The SDK's byte digest differs from the authorized input.",
        )
        self.call("DELETE", f"/external-agents/{agent}/test-files/{uploaded['lease_id']}", expected=(204,))
        result = self.successful_case(agent, "file-output", outputs=[{"name": "report", "kind": "file"}])
        output = result["outputs"]["report"]
        require(
            output.get("upload_file_id")
            and output.get("size") == len(SDK_FILE_BYTES)
            and output.get("mime_type") == "application/pdf",
            "The SDK raw-file output was not stored as the expected Dify file.",
        )
        self.report["checks"].append("official_sdk_file_input_digest_and_output_materialization")

    def workflow_case(self, agent: str) -> None:
        """Drive a real graph through ExternalWait and consume the SDK Task result."""
        app = self.app("workflow")
        self.save(app, graph(agent))
        self.phase = "official_sdk_workflow_pause_resume"
        events = self.stream(
            self.client,
            self.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": self.text("working", "official SDK workflow")}},
        )
        self.assert_external_pause(events)
        result = self.wait_run(app, self.run_identity(events))
        require(
            result.get("outputs") == {"text": "official sdk task ok"},
            "The resumed Workflow did not consume the official SDK result.",
        )
        self.report["checks"].append("official_sdk_workflow_real_external_pause_checkpoint_resume")

    @override
    def run(self) -> dict:
        """Pass only after product state and independent SDK counters agree."""
        self.login()
        baseline = self.stats()["counts"]
        plain = self.sdk_asset(streaming=False)
        direct = self.successful_case(plain, "direct")
        require(
            direct["outputs"] == {"text": "official sdk direct ok"} and not direct["metadata"].get("external_task_id"),
            "A direct SDK Message was not accepted without a Task identity.",
        )
        before = self.stats()["counts"]["get"]
        task = self.successful_case(plain, "working")
        require(
            task["outputs"] == {"text": "official sdk task ok"}
            and task["metadata"].get("external_task_id")
            and self.stats()["counts"]["get"] > before,
            "The SDK asynchronous Task was not resolved with GetTask.",
        )
        self.file_cases(plain)
        self.cancellation_case(plain, "hold", "confirmed")
        streaming = self.sdk_asset(streaming=True)
        before = self.stats()["counts"]["get"]
        streamed = self.successful_case(streaming, "sdk-sse")
        require(
            streamed["outputs"] == {"text": "official sdk task ok"} and self.stats()["counts"]["get"] > before,
            "The SDK SSE listen window did not fall back to the known Task.",
        )
        self.workflow_case(plain)
        final = self.stats()
        own = self.messages()
        delta = {key: final["counts"][key] - baseline[key] for key in baseline}
        require(
            len(own) == 7 and all(value["executions"] == 1 for value in own),
            "The official SDK observed missing or repeated executor work.",
        )
        require(delta["send"] + delta["stream"] == len(own), "A business HTTP request was replayed.")
        require(
            delta["stream"] == 1 and delta["subscribe"] == 0 and delta["cancel"] == 1,
            "The frozen SSE/Get/Cancel profile was not respected.",
        )
        require(
            all(final["tasks"].get(value["task_id"]) == "canceled" for value in own if value["scenario"] == "hold"),
            "Dify cancellation was not confirmed by SDK Task state.",
        )
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            sdk_version=final["sdk_version"],
            sdk_upstream_commit=final["sdk_upstream_commit"],
            sdk_operation_delta=delta,
            verified_business_messages=len(own),
            compat_v0_3_enabled=False,
        )
        return self.report


def main() -> None:
    """Write a bounded, secret-free report and fail the process on any unmet check."""
    runner = OfficialSDKAcceptance()
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
    if destination := os.environ.get("BYOA_SDK_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
