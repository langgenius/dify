"""Real Console-cookie acceptance against an isolated BYOA dev deployment.

Required env: DIFY_TEST_URL, DIFY_TEST_EMAIL, DIFY_TEST_PASSWORD.
Fixture env: BYOA_FIXTURE_PUBLIC_URL, BYOA_FIXTURE_ADMIN_URL and optional
BYOA_FIXTURE_BEARER (also set on fixture). CA paths are DIFY_TEST_CA_FILE and
BYOA_FIXTURE_CA_FILE; TLS verification is always enabled. This runner creates
clearly named test assets and Overview tests. Workflow/Chatflow acceptance is
reported separately by the full-stack runner; this does not claim that coverage.
"""

from __future__ import annotations

import base64
import json
import os
import ssl
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from tests.e2e_tests.external_agents.fixture_server import FILE_BYTES


class AcceptanceError(Exception):
    """Only static diagnostics; never include response bodies or credentials."""


def require(value: object, message: str) -> None:
    if not value:
        raise AcceptanceError(message)


def tls_context(name: str) -> ssl.SSLContext:
    return ssl.create_default_context(cafile=os.environ.get(name) or None)


class ConsoleAcceptance:
    def __init__(self, *, email: str | None = None, password: str | None = None) -> None:
        self._email = email if email is not None else os.environ["DIFY_TEST_EMAIL"]
        self._password = password if password is not None else os.environ["DIFY_TEST_PASSWORD"]
        self.base = os.environ["DIFY_TEST_URL"].rstrip("/")
        if not self.base.endswith("/console/api"):
            self.base += "/console/api"
        self.fixture = os.environ.get("BYOA_FIXTURE_PUBLIC_URL", "https://byoa-fixture").rstrip("/")
        self.admin = os.environ.get("BYOA_FIXTURE_ADMIN_URL", self.fixture + "/admin").rstrip("/")
        self.client = httpx.Client(
            verify=tls_context("DIFY_TEST_CA_FILE"), timeout=30, follow_redirects=False, trust_env=False
        )
        self.control = httpx.Client(
            verify=tls_context("BYOA_FIXTURE_CA_FILE"), timeout=10, follow_redirects=False, trust_env=False
        )
        self.timeout = min(300.0, float(os.environ.get("BYOA_ACCEPTANCE_TIMEOUT_SECONDS", "120")))
        self.run_id = uuid4().hex
        self.phase = "initialize"
        # Reports are heterogeneous JSON assembled from real HTTP responses.
        self.report: dict[str, Any] = {
            "run_id": self.run_id,
            "started_at": datetime.now(UTC).isoformat(),
            "checks": [],
            "assets": [],
            "invocations": {},
            "scope": "HTTPS fixture + real Console Overview APIs",
        }

    def close(self) -> None:
        self.client.close()
        self.control.close()

    def call(self, method: str, path: str, *, expected: tuple[int, ...] = (200,), **kwargs) -> dict:
        response = self.client.request(method, self.base + path, **kwargs)
        if response.status_code not in expected:
            raise AcceptanceError(f"Console {method} returned HTTP {response.status_code} during {self.phase}.")
        return response.json() if response.content else {}

    def stats(self) -> dict:
        response = self.control.get(self.admin + "/stats")
        require(response.status_code == 200, "Fixture admin is not available over verified TLS.")
        return response.json()

    def login(self) -> None:
        self.phase = "console_login"
        result = self.call(
            "POST",
            "/login",
            json={
                "email": self._email,
                "password": base64.b64encode(self._password.encode()).decode(),
                "remember_me": False,
            },
        )
        require(result.get("result") == "success", "Console login did not establish a workspace session.")
        csrf = next(
            (cookie.value for cookie in self.client.cookies.jar if cookie.name in {"csrf_token", "__Host-csrf_token"}),
            None,
        )
        if not csrf:
            raise AcceptanceError("Console login did not issue its CSRF cookie.")
        self.client.headers["X-CSRF-Token"] = csrf
        self.report["checks"].append("real_console_login_and_csrf")

    def create_asset(self, *, bearer: str | None = None) -> str:
        self.phase = "read_only_verify"
        before = self.stats()["counts"]["send"]
        endpoint = self.fixture + "/bearer/.well-known/agent-card.json" if bearer else self.fixture
        verified = self.call(
            "POST",
            "/external-agents/verify",
            json={
                "endpoint": endpoint,
                "auth_type": "bearer" if bearer else "none",
                "credential_action": "replace" if bearer else "remove",
                "credential": bearer,
            },
        )
        require(self.stats()["counts"]["send"] == before, "Verify dispatched business work.")
        require(
            verified["auth_check"] == ("passed_for_read_endpoint" if bearer else "not_exercised"),
            "Verify did not report its precise credential-check scope.",
        )
        if bearer:
            require(bearer not in json.dumps(verified), "Verify exposed the Agent credential.")
        self.phase = "save_verified_asset"
        saved = self.call(
            "POST",
            "/external-agents",
            expected=(201,),
            json={
                "verification_id": verified["verification_id"],
                "idempotency_key": f"accept-{self.run_id}-{uuid4()}",
                "metadata": {
                    "name": (
                        f"BYOA acceptance {self.run_id[:12]} {'bearer' if bearer else 'none'} "
                        f"{len(self.report['assets']) + 1}-{uuid4().hex[:6]}"
                    )
                },
            },
        )
        identifier = saved["resource_id"]
        self.report["assets"].append(identifier)
        self.report["checks"].append(
            "verify_save_bearer_read_probe" if bearer else "verify_save_without_business_probe"
        )
        return identifier

    def ssrf_endpoint_rejected(self) -> None:
        """Probe only Verify: a loopback endpoint cannot produce save evidence or Send."""
        self.phase = "loopback_ssrf_verify"
        before = self.stats()["counts"]["send"]
        response = self.client.post(
            self.base + "/external-agents/verify",
            json={
                "endpoint": "https://127.0.0.1",
                "auth_type": "none",
                "credential_action": "remove",
            },
        )
        require(response.status_code in {400, 403, 422}, "Loopback HTTPS Verify was not rejected.")
        require("verification_id" not in response.json(), "Rejected loopback Verify issued Save evidence.")
        require(self.stats()["counts"]["send"] == before, "Rejected loopback Verify caused business Send.")
        self.report["checks"].append("loopback_verify_rejected_without_save_evidence_or_business_send")

    def start(
        self,
        agent: str,
        scenario: str,
        *,
        outputs: list[dict] | None = None,
        page: str | None = None,
        leases: list[str] | None = None,
    ) -> tuple[dict, dict]:
        detail = self.call("GET", f"/external-agents/{agent}")
        payload = {
            "page_session_id": page or f"accept-{self.run_id}-{scenario}",
            "expected_generation": detail["asset"]["test_display_generation"],
            "idempotency_key": f"{self.run_id}-{scenario}-{uuid4()}",
            "task_text": f"[byoa:{scenario}:{self.run_id}] Controlled acceptance task",
            "input_lease_ids": leases or [],
            "outputs": outputs or [{"name": "text", "kind": "string"}],
        }
        value = self.call("POST", f"/external-agents/{agent}/tests", expected=(202,), json=payload)
        self.report["invocations"][scenario] = value["invocation_id"]
        return value, payload

    def wait(self, agent: str, invocation: str, *, predicate=None) -> dict:
        deadline = time.monotonic() + self.timeout
        value = {}
        while time.monotonic() < deadline:
            value = self.call("GET", f"/external-agents/{agent}/tests/{invocation}")
            done = predicate(value) if predicate else value["state"] in {"succeeded", "failed", "ended", "stopped"}
            if done:
                return value
            time.sleep(0.5)
        raise AcceptanceError(f"Bounded Console polling expired during {self.phase}.")

    def successful_case(self, agent: str, scenario: str, *, outputs=None, page=None, leases=None) -> dict:
        self.phase = scenario
        started, _payload = self.start(agent, scenario, outputs=outputs, page=page, leases=leases)
        result = self.wait(agent, started["invocation_id"])
        require(result["state"] == "succeeded", f"The {scenario} scenario did not succeed.")
        self.report["checks"].append(scenario)
        return result

    def cancellation_case(self, agent: str, scenario: str, expected: str) -> None:
        self.phase = scenario
        started, _payload = self.start(agent, scenario)
        identifier = started["invocation_id"]
        self.wait(agent, identifier, predicate=lambda value: bool(value["metadata"].get("external_task_id")))
        self.call("POST", f"/external-agents/{agent}/tests/{identifier}/cancel", expected=(202,), json={})
        self.wait(agent, identifier, predicate=lambda value: value["metadata"].get("cancellation_state") == expected)
        self.report["checks"].append(scenario + "_" + expected)

    def run(self) -> dict:
        self.login()
        self.ssrf_endpoint_rejected()
        agent = self.create_asset()
        direct = self.successful_case(agent, "direct")
        require(direct["outputs"] == {"text": "direct ok"}, "Direct Message output was not mapped exactly.")
        self.successful_case(agent, "completed")
        self.successful_case(agent, "working")
        self.phase = "unknown_submission"
        started, payload = self.start(agent, "unknown")
        result = self.wait(agent, started["invocation_id"])
        require(
            result["metadata"].get("submission_state") == "submission_unknown",
            "A lost POST response was not classified as unknown.",
        )
        duplicate = self.call("POST", f"/external-agents/{agent}/tests", expected=(202,), json=payload)
        require(duplicate["invocation_id"] == started["invocation_id"], "Repeated Test key created another Invocation.")
        self.report["checks"].append("unknown_submission_no_replay_and_test_idempotency")
        self.cancellation_case(agent, "hold", "confirmed")
        self.cancellation_case(agent, "cancel-rejected", "rejected")
        self.cancellation_case(agent, "cancel-unsupported", "unsupported")
        page = f"accept-{self.run_id}-files"
        self.phase = "input_file_upload"
        upload = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("input.pdf", FILE_BYTES, "application/pdf")},
        )
        for _attempt in range(2):
            self.call("DELETE", f"/external-agents/{agent}/test-files/{upload['lease_id']}", expected=(204,))
        upload = self.call(
            "POST",
            f"/external-agents/{agent}/test-files",
            expected=(201,),
            data={"page_session_id": page},
            files={"file": ("replacement.pdf", FILE_BYTES, "application/pdf")},
        )
        self.report["checks"].append("unsubmitted_file_clear_is_idempotent_and_replaceable")
        self.phase = "file-input"
        started, _payload = self.start(
            agent,
            "file-input",
            page=page,
            leases=[upload["lease_id"]],
            outputs=[
                {"name": "text", "kind": "string"},
                {"name": "file_count", "kind": "number"},
                {"name": "total_bytes", "kind": "number"},
            ],
        )
        self.call("DELETE", f"/external-agents/{agent}/test-files/{upload['lease_id']}", expected=(204,))
        result = self.wait(agent, started["invocation_id"])
        require(result["state"] == "succeeded", "Clearing a submitted input damaged its Invocation.")
        self.report["checks"].append("submitted_file_clear_preserves_inflight_input")
        require(result["outputs"]["file_count"] == 1, "Explicit file input count was not preserved.")
        require(result["outputs"]["total_bytes"] == len(FILE_BYTES), "Input file bytes changed.")
        output_fields = [{"name": "report", "kind": "file"}]
        result = self.successful_case(agent, "file-output", outputs=output_fields)
        require(result["outputs"]["report"].get("upload_file_id"), "Raw file output was not durably materialized.")
        bearer = os.environ.get("BYOA_FIXTURE_BEARER")
        file_agent = self.create_asset(bearer=bearer) if bearer else agent
        result = self.successful_case(file_agent, "file-url", outputs=output_fields)
        require(result["outputs"]["report"].get("upload_file_id"), "URL file output was not durably materialized.")
        self.phase = "ambiguous_output"
        started, _payload = self.start(agent, "ambiguous")
        result = self.wait(agent, started["invocation_id"])
        require(
            result["state"] == "failed" and result["error_code"] == "ambiguous_output",
            "Ambiguous output did not take Error Handling.",
        )
        self.report["checks"].append("ambiguous_output_no_business_retry")
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        self.successful_case(agent, "trace")
        self.phase = "trace_query"
        trace = self.call("GET", f"/external-agent-invocations/{self.report['invocations']['trace']}/trace")
        require(trace["received_steps"] == 1, "Exact Traceability carrier did not produce one owned step.")
        self.report["checks"].append("exact_traceability_ingest_and_owned_query")
        stats = self.stats()
        own = [entry for entry in stats["messages"].values() if entry["run"] == self.run_id]
        require(own and all(entry["sends"] == 1 for entry in own), "An Invocation was dispatched more than once.")
        require(stats["counts"]["input_url"] == 0, "An internal input URL was forwarded.")
        require(stats["counts"]["file_authorization"] == 0, "An Agent credential followed an output file URL.")
        require(stats["counts"]["subscribe"] == 0, "The adapter depended on Subscribe.")
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            fixture_counts=stats["counts"],
            verified_business_messages=len(own),
            bearer_file_url_coverage=bool(bearer),
            workflow_chatflow_coverage="not exercised by this Overview runner",
        )
        return self.report


def main() -> None:
    runner = ConsoleAcceptance()
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
    destination = os.environ.get("BYOA_ACCEPTANCE_OUTPUT")
    if destination:
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
