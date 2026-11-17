"""Real Console HTTP acceptance for the frontend's BYOA integration feedback.

Run only against the isolated BYOA deployment with the normal DIFY_TEST_* and
BYOA_FIXTURE_* TLS/credential environment. BYOA_TEST_ACTORS_JSON supplies Normal
credentials for the aggregate-only list check. The runner creates synthetic
assets, two Apps, permanent icon/input/output files and real Overview calls.
It does not edit databases or invent a call-total proof: the default A2A adapter
cannot prove call-total usage, including zero. Known-zero semantics have a
separate real-SQL unit test; a remote Trace step's zero remains unknown here.

Reports contain IDs, status categories, byte hashes, counts and elapsed seconds.
Credentials, signed URLs, file bytes, raw responses and provider values stay in
memory. Output: BYOA_FRONTEND_FEEDBACK_OUTPUT (or BYOA_ACCEPTANCE_OUTPUT).
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict, override
from urllib.parse import urljoin, urlsplit
from uuid import uuid4

from pydantic import TypeAdapter

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, ConsoleAcceptance, require
from tests.e2e_tests.external_agents.fixture_server import FILE_BYTES
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII="
)
TERMINAL = {"succeeded", "failed", "ended", "stopped"}


class AssetWire(TypedDict):
    id: str
    icon_url: str | None
    metadata_revision: int
    test_display_generation: int
    reference_count: int | None
    created_at: str
    updated_at: str


class AssetListWire(TypedDict):
    items: list[AssetWire]
    total: int
    enabled_count: int
    disabled_count: int


class FileLinkWire(TypedDict):
    file_id: str
    url: str
    url_expires_at: str


class InputFileWire(FileLinkWire):
    lease_id: str
    filename: str
    media_type: str
    size: int


class OutputFileWire(TypedDict):
    upload_file_id: str
    url: str
    url_expires_at: str


class StatisticsWire(TypedDict):
    elapsed_time: float | None
    total_tokens: int | None
    attempt_count: int
    token_reporting_numerator: int
    token_reporting_denominator: int


class FileResultWire(TypedDict):
    invocation_id: str
    state: str
    outputs: dict[str, OutputFileWire]
    statistics: StatisticsWire


class StatisticsResultWire(TypedDict):
    invocation_id: str
    state: str
    metadata: dict[str, object]
    statistics: StatisticsWire


class RetryAnchor(TypedDict):
    anchor: str
    started_at: float


class FrontendFeedbackAcceptance(WorkflowAcceptance):
    """Exercise public Console contracts with real fixture requests and stored bytes."""

    def __init__(self) -> None:
        super().__init__()
        self._normal: ConsoleAcceptance | None = None
        self._keyword = self.run_id[:12]
        self.report.update(
            scope="real Console HTTP frontend-feedback contracts; verified TLS and actual file bytes",
            byte_proofs=[],
            verify_failure_reasons=[],
            call_total_zero_http="not_supported_by_default_a2a_adapter; real_SQL_unit_evidence_is_separate",
        )

    @override
    def close(self) -> None:
        if self._normal is not None:
            self._normal.close()
        super().close()

    def edit(self, agent: str, changes: dict[str, str]) -> AssetWire:
        """Patch real metadata with the latest CAS revision; retain user input scope."""
        current = self.call("GET", f"/external-agents/{agent}")
        return TypeAdapter(AssetWire).validate_python(
            self.call(
                "PATCH",
                f"/external-agents/{agent}/info",
                json={"expected_revision": current["asset"]["metadata_revision"], "changes": changes},
            )
        )

    def generation(self, agent: str) -> int:
        value = self.call("GET", f"/external-agents/{agent}")
        return TypeAdapter(AssetWire).validate_python(value["asset"])["test_display_generation"]

    def list_cohort(self, *, actor: ConsoleAcceptance | None = None, **params: object) -> AssetListWire:
        return TypeAdapter(AssetListWire).validate_python(
            (actor or self).call("GET", "/external-agents", params={"keyword": self._keyword, "limit": 100, **params})
        )

    def verify_failure_categories(self) -> None:
        """Four read-only failure categories must not issue evidence or Send."""
        self.phase = "verify_failure_categories"
        before = self.stats()["counts"]["send"]
        cases = (
            ("connection_failed", "/cards/not-a-fixture-card/.well-known/agent-card.json", False),
            ("invalid_agent_card", "/cards/missing-required/.well-known/agent-card.json", False),
            ("unsupported_protocol", "/cards/unsupported-required-extension/.well-known/agent-card.json", False),
            ("authentication_failed", "/bearer/.well-known/agent-card.json", True),
        )
        require(bool(os.environ.get("BYOA_FIXTURE_BEARER")), "The protected read fixture requires its Bearer setting.")
        for reason, suffix, authenticated in cases:
            response = self.client.post(
                self.base + "/external-agents/verify",
                json={
                    "endpoint": self.fixture + suffix,
                    "auth_type": "bearer" if authenticated else "none",
                    "credential_action": "replace" if authenticated else "remove",
                    "credential": uuid4().hex if authenticated else None,
                },
            )
            require(response.status_code == 400, "Verify failure did not use its documented HTTP status.")
            value = response.json()
            require(
                value.get("code") == "verification_failed" and (value.get("details") or {}).get("reason") == reason,
                "Verify did not return its exact stable frontend failure category.",
            )
            require("verification_id" not in value, "A rejected Verify issued Save evidence.")
            self.report["verify_failure_reasons"].append(reason)
        require(self.stats()["counts"]["send"] == before, "Read-only failed Verify caused business Send.")
        self.report["checks"].append("four_structured_verify_failure_reasons_without_proof_or_send")

    def list_and_reference_contract(self, main: str, disabled: str) -> None:
        """Validate real sorting, filter-wide counts and distinct readable App references."""
        self.phase = "list_sort_counts_and_reference_scope"
        self.call("PUT", f"/external-agents/{disabled}/enabled", json={"enabled": False})
        ascending = self.list_cohort(sort_by="created_at", sort_order="asc")
        descending = self.list_cohort(sort_by="created_at", sort_order="desc")
        require(
            ascending["total"] == descending["total"] == 3
            and [row["id"] for row in ascending["items"]] == [row["id"] for row in reversed(descending["items"])],
            "Created-time sort did not return the exact isolated cohort in reverse order.",
        )
        for tab in (True, False):
            value = self.list_cohort(enabled=str(tab).lower(), page=1, limit=1, connected_by_me="true")
            require(
                value["enabled_count"] == 2
                and value["disabled_count"] == 1
                and value["total"] == (2 if tab else 1)
                and len(value["items"]) == 1,
                "Tab/page filtering corrupted the keyword/actor-wide enabled and disabled counts.",
            )
        self.edit(main, {"description": "Sort refresh " + self.run_id})
        updated = self.list_cohort(sort_by="updated_at", sort_order="desc")
        require(updated["items"][0]["id"] == main, "A metadata save did not move the asset in updated-time sorting.")

        first_app = self.app("workflow")
        first_graph = graph(main)
        extra = copy.deepcopy(first_graph["nodes"][1])
        extra["id"] = "external_second"
        first_graph["nodes"].insert(2, extra)
        first_graph["edges"] = [
            {
                "id": source + "-" + target,
                "type": "custom",
                "source": source,
                "target": target,
                "sourceHandle": "source",
                "targetHandle": "target",
            }
            for source, target in (("start", "external"), ("external", "external_second"), ("external_second", "end"))
        ]
        self.save(first_app, first_graph)
        self.publish(first_app)
        second_app = self.app("workflow")
        self.save(second_app, graph(main))
        references = self.call("GET", f"/external-agents/{main}/references")
        apps = references["apps"]
        require(
            {value["app_id"] for value in apps} == {first_app, second_app}
            and len(apps) == 2
            and next(value for value in apps if value["app_id"] == first_app)["node_ids"]
            == ["external", "external_second"],
            "Reference details did not deduplicate draft/published App ownership and preserve its node IDs.",
        )
        listed = next(row for row in self.list_cohort()["items"] if row["id"] == main)
        require(listed["reference_count"] == 2, "List reference_count counted nodes or workflow versions as Apps.")
        actors = json.loads(os.environ.get("BYOA_TEST_ACTORS_JSON", "{}"))
        configured = actors.get("normal") if isinstance(actors, dict) else None
        if not (
            isinstance(configured, dict)
            and isinstance(configured.get("email"), str)
            and isinstance(configured.get("password"), str)
        ):
            raise AcceptanceError("Normal credentials are required for reference-detail visibility acceptance.")
        self._normal = ConsoleAcceptance(email=configured["email"], password=configured["password"])
        self._normal.login()
        normal = next(row for row in self.list_cohort(actor=self._normal)["items"] if row["id"] == main)
        require(normal["reference_count"] is None, "Normal list disclosed an App reference count.")
        denied = self._normal.client.get(self._normal.base + f"/external-agents/{main}/references")
        require(denied.status_code == 403, "Normal was allowed to enumerate referencing Apps.")
        require(
            first_app not in denied.text and second_app not in denied.text,
            "The denied reference response disclosed an App identity.",
        )
        self.report["reference_facts"] = {"distinct_apps": 2, "first_app_nodes": 2, "normal_count": None}
        self.report["checks"].append("list_sorts_filter_wide_tab_counts_and_live_distinct_app_visibility")

    def download(self, url: object, expected: bytes, label: str) -> None:
        """Read actual bytes through the returned URL; record hashes, never signed URLs."""
        if not isinstance(url, str) or not url:
            raise AcceptanceError("A file read model omitted its signed URL.")
        target = urljoin(self.base + "/", url)
        require(urlsplit(target).scheme == "https", "A file read model did not provide a verified-TLS download URL.")
        response = self.client.get(target)
        require(response.status_code == 200, "A returned signed file URL did not deliver its owned bytes.")
        require(response.content == expected, "Downloaded file bytes differed from the uploaded/remote file.")
        self.report["byte_proofs"].append(
            {"case": label, "size": len(response.content), "sha256": hashlib.sha256(response.content).hexdigest()}
        )

    def revoked(self, url: str) -> None:
        target = urljoin(self.base + "/", url)
        require(urlsplit(target).scheme == "https", "Revocation acceptance requires verified TLS.")
        response = self.client.get(target)
        require(response.status_code == 404, "A revoked signed Test URL still delivered file content.")

    def permanent_image_icon(self, agent: str) -> None:
        """Use a permanent ordinary PNG upload, never a temporary Test/output file."""
        self.phase = "permanent_image_icon_signed_read"
        uploaded = self.call(
            "POST",
            "/files/upload",
            expected=(201,),
            files={"file": ("frontend-icon-" + self.run_id + ".png", PNG_BYTES, "image/png")},
        )
        saved = self.edit(agent, {"icon_type": "image", "icon": uploaded["id"]})
        self.download(saved.get("icon_url"), PNG_BYTES, "permanent_icon_write_response")
        detail = self.call("GET", f"/external-agents/{agent}")
        listed = next(value for value in self.list_cohort()["items"] if value["id"] == agent)
        self.download(detail["asset"].get("icon_url"), PNG_BYTES, "permanent_icon_detail_refresh")
        self.download(listed.get("icon_url"), PNG_BYTES, "permanent_icon_list_refresh")
        self.report["checks"].append("permanent_png_icon_url_write_detail_list_actual_bytes")

    def upload(self, agent: str, page: str) -> InputFileWire:
        return TypeAdapter(InputFileWire).validate_python(
            self.call(
                "POST",
                f"/external-agents/{agent}/test-files",
                expected=(201,),
                data={"page_session_id": page},
                files={"file": ("feedback.pdf", FILE_BYTES, "application/pdf")},
            )
        )

    def input_access(self, agent: str, page: str, lease: str, generation: int) -> FileLinkWire:
        value = self.call(
            "GET",
            f"/external-agents/{agent}/test-files/{lease}/access",
            params={"page_session_id": page, "expected_generation": generation},
        )
        return TypeAdapter(FileLinkWire).validate_python(value)

    def output_access(
        self,
        agent: str,
        page: str,
        invocation: str,
        file_id: str,
        generation: int,
    ) -> FileLinkWire:
        value = self.call(
            "GET",
            f"/external-agents/{agent}/tests/{invocation}/files/{file_id}/access",
            params={"page_session_id": page, "expected_generation": generation},
        )
        return TypeAdapter(FileLinkWire).validate_python(value)

    def file_output(self, agent: str, page: str, *, leases: list[str] | None = None) -> FileResultWire:
        self.phase = "real_file_output_materialization_and_projection"
        started, _ = self.start(
            agent, "file-output", page=page, leases=leases, outputs=[{"name": "report", "kind": "file"}]
        )
        result = TypeAdapter(FileResultWire).validate_python(self.wait(agent, started["invocation_id"]))
        require(result["state"] == "succeeded", "The real remote File was not materialized successfully.")
        output = result["outputs"]["report"]
        require(output.get("url_expires_at"), "Test output projection omitted URL expiry.")
        self.download(output.get("url"), FILE_BYTES, "test_output_response_signed_bytes")
        return result

    def files_and_revocation(self, agent: str) -> None:
        """Traverse upload/paste, scope refresh, generation fences and page leave."""
        self.phase = "multipart_and_url_only_paste"
        page = "frontend-files-" + self.run_id
        generation = self.generation(agent)
        uploaded = self.upload(agent, page)
        require(uploaded.get("url_expires_at"), "Input upload omitted URL expiry.")
        self.download(uploaded.get("url"), FILE_BYTES, "multipart_input_response")
        pasted = TypeAdapter(InputFileWire).validate_python(
            self.call(
                "POST",
                f"/external-agents/{agent}/test-files/paste-link",
                expected=(201,),
                json={"page_session_id": page, "url": self.fixture + "/files/report.pdf"},
            )
        )
        require(
            pasted["filename"] == "report.pdf" and pasted["media_type"] == "application/pdf",
            "URL-only Paste did not infer validated response MIME and filename.",
        )
        self.download(pasted.get("url"), FILE_BYTES, "url_only_paste_response")
        fresh = self.input_access(agent, page, uploaded["lease_id"], generation)
        self.download(fresh.get("url"), FILE_BYTES, "input_refresh_before_generation_edit")
        updated = self.edit(agent, {"description": "File generation edit " + self.run_id})
        next_generation = updated["test_display_generation"]
        require(next_generation == generation + 1, "Metadata edit did not advance the presentation generation.")
        self.revoked(fresh["url"])
        self.call(
            "GET",
            f"/external-agents/{agent}/test-files/{uploaded['lease_id']}/access",
            params={"page_session_id": page, "expected_generation": generation},
            expected=(409,),
        )
        refreshed = self.input_access(agent, page, uploaded["lease_id"], next_generation)
        self.download(refreshed.get("url"), FILE_BYTES, "retained_input_new_generation_refresh")
        before = set(self.stats()["messages"])
        result = self.file_output(agent, page, leases=[uploaded["lease_id"]])
        messages = [
            value
            for key, value in self.stats()["messages"].items()
            if key not in before and value.get("run") == self.run_id
        ]
        require(
            len(messages) == 1
            and messages[0]["sends"] == 1
            and messages[0]["input_files"][0]["sha256"] == hashlib.sha256(FILE_BYTES).hexdigest(),
            "The peer did not receive exactly the explicitly selected stored input bytes.",
        )
        output = result["outputs"]["report"]
        output_id = output["upload_file_id"]
        access = self.output_access(agent, page, result["invocation_id"], output_id, next_generation)
        self.download(access.get("url"), FILE_BYTES, "exact_invocation_output_refresh")
        edited = self.edit(agent, {"description": "Output generation edit " + self.run_id})
        self.revoked(access["url"])
        self.call(
            "GET",
            f"/external-agents/{agent}/tests/{result['invocation_id']}/files/{output_id}/access",
            params={"page_session_id": page, "expected_generation": edited["test_display_generation"]},
            expected=(404, 409),
        )
        self.call("POST", "/external-agent-tests/leave-page", expected=(202,), json={"page_session_id": page})

        leave_page = "frontend-leave-output-" + self.run_id
        completed = self.file_output(agent, leave_page)
        live_url = completed["outputs"]["report"]["url"]
        self.call("POST", "/external-agent-tests/leave-page", expected=(202,), json={"page_session_id": leave_page})
        self.revoked(live_url)
        input_page = "frontend-leave-input-" + self.run_id
        unsubmitted = self.upload(agent, input_page)
        self.download(unsubmitted.get("url"), FILE_BYTES, "unsubmitted_input_before_leave")
        self.call("POST", "/external-agent-tests/leave-page", expected=(202,), json={"page_session_id": input_page})
        self.revoked(unsubmitted["url"])
        self.report["checks"].append("multipart_url_only_paste_signed_refresh_exact_bytes_generation_and_page_revoke")

    def begin_retry_and_unknown_statistics(self, agent: str) -> RetryAnchor:
        """Start the real 60-second retry early; never fabricate a call-total proof."""
        self.phase = "unknown_call_total_despite_real_zero_token_trace_step"
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        traced = TypeAdapter(StatisticsResultWire).validate_python(self.successful_case(agent, "trace"))
        statistics = traced["statistics"]
        require(
            statistics["total_tokens"] is None
            and statistics["attempt_count"] == statistics["token_reporting_denominator"] == 1
            and statistics["token_reporting_numerator"] == 0,
            "A missing call-total proof was zero-filled or promoted from Trace usage.",
        )
        trace = self.call("GET", f"/external-agent-invocations/{traced['invocation_id']}/trace")
        require(trace["steps"] and trace["steps"][0]["total_tokens"] == 0, "The real remote zero-token step was lost.")
        self.report["checks"].append("real_trace_step_zero_keeps_unproven_call_total_unknown")
        self.phase = "begin_real_confirmed_cancel_and_retry"
        started_at = time.monotonic()
        started = self.call(
            "POST",
            f"/external-agents/{agent}/tests",
            expected=(202,),
            json={
                "page_session_id": "frontend-retry-" + self.run_id,
                "expected_generation": self.generation(agent),
                "idempotency_key": str(uuid4()),
                "task_text": self.text("timeout-retry", "frontend statistics"),
                "outputs": [{"name": "text", "kind": "string"}],
                "policy": {
                    "wait_seconds": 60,
                    "on_timeout": "cancel_and_retry",
                    "additional_retries": 1,
                    "retry_interval_seconds": 5,
                },
            },
        )
        self.report["invocations"]["retry_anchor"] = started["invocation_id"]
        return {"anchor": started["invocation_id"], "started_at": started_at}

    def finish_retry_statistics(self, agent: str, retry: RetryAnchor) -> None:
        self.phase = "real_retry_logical_statistics"
        result = TypeAdapter(StatisticsResultWire).validate_python(
            self.wait(
                agent,
                retry["anchor"],
                predicate=lambda value: value["state"] in TERMINAL and value["metadata"].get("sequence") == 1,
            )
        )
        statistics = result["statistics"]
        require(
            result["state"] == "succeeded"
            and result["invocation_id"] != retry["anchor"]
            and statistics["attempt_count"] == statistics["token_reporting_denominator"] == 2
            and statistics["token_reporting_numerator"] == 0
            and statistics["total_tokens"] is None,
            "Logical retry statistics did not include exactly two real attempts with unknown call usage.",
        )
        require(
            isinstance(statistics["elapsed_time"], int | float)
            and 59 <= statistics["elapsed_time"] <= time.monotonic() - retry["started_at"] + 5,
            "Retry elapsed time excluded its real wait/gap or exceeded the observed logical wall time.",
        )
        sent = [
            value
            for value in self.stats()["messages"].values()
            if value.get("run") == self.run_id and value.get("scenario") == "timeout-retry"
        ]
        require(
            len(sent) == 2
            and all(value["sends"] == 1 for value in sent)
            and next(value for value in sent if value["attempt"] == 2)["previous_task_state_at_send"]
            == "TASK_STATE_CANCELED",
            "Retry did not follow exactly one authoritative Cancel before the second real Send.",
        )
        time.sleep(1.1)
        repeated = self.call("GET", f"/external-agents/{agent}/tests/{retry['anchor']}")
        require(repeated["statistics"] == statistics, "Terminal statistics continued growing on a later read.")
        self.report["retry_statistics"] = {"statistics": statistics, "business_messages": 2, "old_task_canceled": True}
        self.report["checks"].append("real_two_send_confirmed_cancel_retry_elapsed_and_unknown_usage_scope")

    def provider_overview(self, agent: str) -> None:
        """Read configured states once; never return endpoint/config/secret values."""
        self.phase = "tracing_provider_summary_zero_one_and_disabled"
        path = f"/external-agents/{agent}/tracing-config"
        require(
            self.call("GET", path) == {"enabled_provider": None, "providers": []},
            "A new asset's provider overview invented configuration.",
        )
        secret = "feedback-" + uuid4().hex
        configured = self.call(
            "PUT",
            path + "/phoenix",
            json={
                "config": {"endpoint": self.fixture + "/asset", "project": "BYOA", "api_key": secret},
                "enabled": True,
                "capture_content": True,
                "expected_revision": 0,
            },
        )
        overview = self.call("GET", path)
        require(
            overview
            == {
                "enabled_provider": "phoenix",
                "providers": [
                    {
                        "provider": "phoenix",
                        "revision": configured["revision"],
                        "enabled": True,
                        "capture_content": True,
                    }
                ],
            },
            "Provider overview did not match exactly one configured active destination.",
        )
        single = self.call("GET", path + "/phoenix")["configuration"]
        require(
            "api_key" in single["configured_secrets"]
            and "api_key" not in single["values"]
            and secret not in json.dumps(single)
            and secret not in json.dumps(overview)
            and self.fixture not in json.dumps(overview),
            "A summary or compatible provider GET disclosed configuration/secret values.",
        )
        disabled = self.call(
            "PUT",
            path + "/phoenix",
            json={
                "config": {"endpoint": self.fixture + "/asset", "project": "BYOA"},
                "enabled": False,
                "capture_content": False,
                "expected_revision": configured["revision"],
            },
        )
        stopped = self.call("GET", path)
        require(
            stopped["enabled_provider"] is None
            and len(stopped["providers"]) == 1
            and stopped["providers"][0]["enabled"] is False
            and stopped["providers"][0]["revision"] == disabled["revision"],
            "Disabled provider disappeared from the configured list or remained selected.",
        )
        if self._normal is not None:
            denied = self._normal.client.get(self._normal.base + path)
            require(denied.status_code == 403, "Normal read owner-only configured provider states.")
        self.report["checks"].append("provider_overview_empty_active_disabled_secret_free_and_compatible_single_get")

    @override
    def run(self) -> dict[str, object]:
        self.login()
        self.verify_failure_categories()
        main, statistics, disabled = self.create_asset(), self.create_asset(), self.create_asset()
        retry = self.begin_retry_and_unknown_statistics(statistics)
        self.list_and_reference_contract(main, disabled)
        self.permanent_image_icon(main)
        self.files_and_revocation(main)
        self.provider_overview(statistics)
        self.finish_retry_statistics(statistics, retry)
        own = self.messages()
        require(own and all(value["sends"] == 1 for value in own), "One feedback Invocation was sent more than once.")
        self.report.update(
            result="passed",
            finished_at=datetime.now(UTC).isoformat(),
            verified_business_messages=len(own),
            visual_browser_acceptance=False,
        )
        return self.report


def main() -> None:
    runner = FrontendFeedbackAcceptance()
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
    destination = os.environ.get("BYOA_FRONTEND_FEEDBACK_OUTPUT") or os.environ.get("BYOA_ACCEPTANCE_OUTPUT")
    if destination:
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
