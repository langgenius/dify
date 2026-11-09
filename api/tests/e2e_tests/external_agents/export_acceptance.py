"""Real Phoenix dual-destination export acceptance against the isolated TLS fixture.

Reuses WorkflowAcceptance's Console login, verified TLS and real Workflow APIs.
The configured Phoenix provider sends OTLP/HTTP to /asset/v1/traces and
/app/v1/traces. Provider implementations, queue settings and schema are untouched.
Required environment matches acceptance.py. Optional output:
BYOA_EXPORT_ACCEPTANCE_OUTPUT. Failures report the actual phase, never secrets,
trace content, raw response bodies or a fabricated successful export.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import override

from tests.e2e_tests.external_agents.acceptance import AcceptanceError, require
from tests.e2e_tests.external_agents.workflow_acceptance import WorkflowAcceptance, graph

EXPORT_PATHS = {"asset": "/asset/v1/traces", "app": "/app/v1/traces"}


class ExportAcceptance(WorkflowAcceptance):
    def __init__(self) -> None:
        super().__init__()
        self.report.update(
            scope="real Phoenix provider + Console asset/App configuration + Workflow + OTLP/HTTP fixture",
            export_runs=[],
        )

    def export_control(self, failures: dict[str, int]) -> None:
        response = self.control.post(self.admin + "/export-control", json={"failures": failures})
        require(response.status_code == 200, "The isolated export control endpoint is unavailable.")

    def configure_targets(self, agent: str, app: str) -> None:
        self.phase = "configure_verified_phoenix_asset_target"
        config = self.call(
            "PUT",
            f"/external-agents/{agent}/tracing-config/phoenix",
            json={
                "config": {"endpoint": self.fixture + "/asset", "project": "BYOA"},
                "enabled": True,
                "capture_content": True,
                "expected_revision": 0,
            },
        )
        require(
            config.get("provider") == "phoenix" and config.get("enabled"), "The Phoenix asset target was not saved."
        )
        self.call("PUT", f"/external-agents/{agent}/tracing", json={"enabled": True})
        self.phase = "configure_native_phoenix_app_target"
        self.call(
            "POST",
            f"/apps/{app}/trace-config",
            expected=(201,),
            json={
                "tracing_provider": "phoenix",
                "tracing_config": {"endpoint": self.fixture + "/app", "project": "BYOA"},
                "activate": True,
            },
        )
        self.call(
            "POST",
            f"/apps/{app}/trace",
            json={"enabled": True, "tracing_provider": "phoenix", "capture_content": True, "capture_agent": True},
        )
        self.report["checks"].append("real_verified_phoenix_asset_and_native_app_targets")

    def run_trace_workflow(self, app: str, suffix: str) -> tuple[str, str]:
        self.phase = f"workflow_trace_{suffix}"
        events = self.stream(
            self.client,
            self.base + f"/apps/{app}/workflows/draft/run",
            {"inputs": {"task": self.text("trace", suffix)}},
        )
        run_id = self.run_identity(events)
        result = self.wait_run(app, run_id)
        require(result.get("outputs") == {"text": "task ok"}, "Trace export changed the business Workflow output.")
        executions = self.call("GET", f"/apps/{app}/workflow-runs/{run_id}/node-executions").get("data", [])
        external = [item for item in executions if item.get("node_id") == "external"]
        require(len(external) == 1, "The trace Workflow did not have one exact External caller.")
        metadata = external[0].get("execution_metadata") or {}
        log = metadata.get("agent_log") or {}
        invocation_id = log.get("invocation_id")
        if not isinstance(invocation_id, str):
            raise AcceptanceError("The Workflow caller did not expose its External Invocation ID.")
        self.report["export_runs"].append({"workflow_run_id": run_id, "invocation_id": invocation_id, "case": suffix})
        return run_id, invocation_id

    def deliveries(self, invocation_id: str, agent: str, app: str) -> dict[str, dict]:
        rows = self.call("GET", f"/external-agent-invocations/{invocation_id}/trace-deliveries").get("data", [])
        targets = {}
        for row in rows:
            kind = row.get("target_kind")
            require(kind in EXPORT_PATHS, "An unexpected trace destination appeared.")
            require(kind not in targets, "The Invocation has duplicate delivery intents for one target kind.")
            require(
                row.get("target_id") == (agent if kind == "asset" else app), "A delivery points to the wrong owner."
            )
            require(row.get("provider") == "phoenix", "A delivery did not use the real Phoenix provider.")
            targets[kind] = row
        return targets

    def wait_deliveries(
        self, invocation_id: str, agent: str, app: str, *, asset_failure: bool = False
    ) -> dict[str, dict]:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            targets = self.deliveries(invocation_id, agent, app)
            self.report["last_delivery_snapshot"] = {
                "invocation_id": invocation_id,
                "targets": self.safe_delivery_report(targets),
            }
            if set(targets) == {"asset", "app"}:
                asset, application = targets["asset"], targets["app"]
                if asset_failure:
                    require(asset.get("state") != "accepted", "The forced-503 asset target was falsely accepted.")
                    if application.get("state") == "accepted" and asset.get("state") in {
                        "retrying",
                        "failed",
                        "uncertain",
                    }:
                        require(asset.get("attempts", 0) >= 1, "The failed asset delivery was never attempted.")
                        return targets
                elif all(value.get("state") == "accepted" for value in targets.values()):
                    return targets
            time.sleep(0.5)
        raise AcceptanceError(f"Trace delivery polling expired during {self.phase}.")

    def exports_since(self, offset: int) -> dict[str, list[dict]]:
        rows = self.stats().get("exports", [])[offset:]
        result = {kind: [value for value in rows if value.get("path") == path] for kind, path in EXPORT_PATHS.items()}
        for kind, values in result.items():
            require(values, f"No real Phoenix OTLP HTTP body reached the {kind} endpoint.")
            require(
                all(value.get("bytes", 0) > 0 and len(value.get("sha256", "")) == 64 for value in values),
                "The fixture did not record a nonempty export body and its digest.",
            )
        return result

    @staticmethod
    def safe_delivery_report(targets: dict[str, dict]) -> dict:
        return {
            kind: {
                key: row.get(key)
                for key in (
                    "id",
                    "target_id",
                    "provider",
                    "state",
                    "attempts",
                    "error_code",
                    "config_revision",
                    "payload_revision",
                )
            }
            for kind, row in targets.items()
        }

    @override
    def run(self) -> dict:
        self.login()
        agent = self.create_asset()
        app = self.app("workflow")
        self.save(app, graph(agent))
        self.configure_targets(agent, app)
        # A prior failed run must not poison the shared, dedicated fixture.
        self.export_control({})
        try:
            baseline = len(self.stats().get("exports", []))
            _, first = self.run_trace_workflow(app, "dual-success")
            self.phase = "independent_asset_app_delivery_acceptance"
            healthy = self.wait_deliveries(first, agent, app)
            evidence = self.exports_since(baseline)
            self.report["healthy_otlp_body_evidence"] = {
                kind: [{key: row[key] for key in ("path", "bytes", "sha256")} for row in values]
                for kind, values in evidence.items()
            }
            self.report["checks"].append("asset_and_app_independent_phoenix_deliveries_accepted_with_real_otlp_bodies")
            self.report["healthy_deliveries"] = self.safe_delivery_report(healthy)

            self.phase = "force_only_asset_export_503"
            self.export_control({EXPORT_PATHS["asset"]: 503})
            baseline = len(self.stats().get("exports", []))
            _, second = self.run_trace_workflow(app, "asset-unavailable")
            self.phase = "asset_503_does_not_block_business_or_app_target"
            isolated = self.wait_deliveries(second, agent, app, asset_failure=True)
            self.exports_since(baseline)
            business_messages = len(self.messages())
            asset_before, app_before = isolated["asset"], isolated["app"]
            self.report["isolated_failure_deliveries"] = self.safe_delivery_report(isolated)
            self.report["checks"].append("asset_503_independent_from_succeeded_business_and_accepted_app_export")

            self.phase = "restore_asset_export_without_business_replay"
            self.export_control({})
            if asset_before["state"] in {"failed", "uncertain"}:
                self.call(
                    "POST",
                    f"/external-agent-invocations/{second}/trace-deliveries/{asset_before['id']}/retry",
                    expected=(204,),
                    json={"acknowledge_possible_duplicates": asset_before["state"] == "uncertain"},
                )
                retry_mode = "explicit_same_frozen_delivery"
            else:
                retry_mode = "existing_bounded_automatic_export_retry"
            recovered = self.wait_deliveries(second, agent, app)
            require(recovered["asset"]["id"] == asset_before["id"], "Export retry replaced the delivery identity.")
            require(
                recovered["asset"]["payload_revision"] == asset_before["payload_revision"],
                "Export retry changed the frozen trace payload revision.",
            )
            require(
                recovered["asset"]["attempts"] > asset_before["attempts"], "The asset exporter did not actually retry."
            )
            require(
                recovered["app"]["id"] == app_before["id"] and recovered["app"]["attempts"] == app_before["attempts"],
                "Retrying the asset delivery resent the already accepted App delivery.",
            )
            own = self.messages()
            require(
                len(own) == business_messages and all(value["sends"] == 1 for value in own),
                "Export recovery dispatched or replayed business work.",
            )
            self.report["checks"].append("recovered_asset_export_retries_only_same_delivery_without_send_or_app_replay")
            self.report.update(
                result="passed",
                finished_at=datetime.now(UTC).isoformat(),
                retry_mode=retry_mode,
                recovered_deliveries=self.safe_delivery_report(recovered),
                verified_business_messages=len(own),
                acknowledgement_scope="provider/collector accepted; destination query visibility is not asserted",
            )
            return self.report
        finally:
            self.export_control({})


def main() -> None:
    runner = ExportAcceptance()
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
    if destination := os.environ.get("BYOA_EXPORT_ACCEPTANCE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)
    if result["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
