#!/usr/bin/env python3
from __future__ import annotations

import json
from typing import Any

from console_lifecycle import (
    ConsoleApiError,
    encode_sensitive_field,
    run_debug_draft_sequence,
    run_install_dependencies_sequence,
    run_preflight_sequence,
)


class FakeConsoleClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.task_counter = 0

    def _task(self, source: str) -> dict[str, Any]:
        self.task_counter += 1
        return {"all_installed": False, "task_id": f"task-{source}-{self.task_counter}"}

    def install_plugins_from_marketplace(self, plugin_unique_identifiers: list[str]) -> dict[str, Any]:
        self.calls.append({"method": "marketplace", "identifiers": plugin_unique_identifiers})
        return self._task("marketplace")

    def install_plugins_from_pkg(self, plugin_unique_identifiers: list[str]) -> dict[str, Any]:
        self.calls.append({"method": "package", "identifiers": plugin_unique_identifiers})
        return self._task("package")

    def install_plugin_from_github(
        self,
        *,
        plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "method": "github",
                "identifier": plugin_unique_identifier,
                "repo": repo,
                "version": version,
                "package": package,
            }
        )
        return self._task("github")

    def plugin_task(self, task_id: str) -> dict[str, Any]:
        self.calls.append({"method": "plugin_task", "task_id": task_id})
        return {
            "task": {
                "status": "success",
                "total_plugins": 1,
                "completed_plugins": 1,
                "plugins": [],
            }
        }


class FakePreflightClient:
    def __init__(
        self,
        *,
        health: Any = None,
        setup: Any = None,
        init: Any = None,
        workspace: Any = None,
        fail_health: bool = False,
        fail_setup: bool = False,
        fail_init: bool = False,
        fail_workspace: bool = False,
    ) -> None:
        self.console_base = "http://localhost"
        self.health_payload = health or {"status": "ok"}
        self.setup_payload = setup or {"step": "finished"}
        self.init_payload = init or {"status": "finished"}
        self.workspace_payload = workspace or {"id": "tenant-1", "name": "Default"}
        self.fail_health = fail_health
        self.fail_setup = fail_setup
        self.fail_init = fail_init
        self.fail_workspace = fail_workspace

    def health(self) -> Any:
        if self.fail_health:
            raise ConsoleApiError("GET /health failed")
        return self.health_payload

    def setup_status(self) -> Any:
        if self.fail_setup:
            raise ConsoleApiError("GET /console/api/setup failed")
        return self.setup_payload

    def init_status(self) -> Any:
        if self.fail_init:
            raise ConsoleApiError("GET /console/api/init failed")
        return self.init_payload

    def current_workspace(self) -> Any:
        if self.fail_workspace:
            raise ConsoleApiError("GET /console/api/workspaces/current failed")
        return self.workspace_payload


class FakeDraftDebugClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def check_dependencies(self, app_id: str) -> dict[str, Any]:
        self.calls.append({"method": "check_dependencies", "app_id": app_id})
        return {"leaked_dependencies": []}

    def draft_run(self, app_id: str, inputs: dict[str, Any], files: list[dict[str, Any]] | None = None) -> str:
        self.calls.append({"method": "draft_run", "app_id": app_id, "inputs": inputs, "files": files})
        return "\n".join(
            [
                "event: workflow_finished",
                'data: {"data": {"status": "failed", "error": "missing selector"}}',
                "",
            ]
        )

    def workflow_runs(
        self,
        app_id: str,
        *,
        mode: str = "workflow",
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
        triggered_from: str = "debugging",
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "method": "workflow_runs",
                "app_id": app_id,
                "mode": mode,
                "limit": limit,
                "last_id": last_id,
                "status": status,
                "triggered_from": triggered_from,
            }
        )
        return {"data": [{"id": "run-1", "status": "failed"}]}

    def workflow_run_detail(self, app_id: str, run_id: str) -> dict[str, Any]:
        self.calls.append({"method": "workflow_run_detail", "app_id": app_id, "run_id": run_id})
        return {"id": run_id, "status": "failed", "error": "missing selector"}

    def workflow_run_node_executions(self, app_id: str, run_id: str) -> dict[str, Any]:
        self.calls.append({"method": "workflow_run_node_executions", "app_id": app_id, "run_id": run_id})
        return {"data": [{"node_id": "llm", "status": "failed", "error": "missing selector"}]}


def assert_preflight() -> list[dict[str, Any]]:
    cases = [
        (
            "docker_down",
            FakePreflightClient(fail_health=True, fail_setup=True, fail_init=True),
            "start_local_dify_ce",
            False,
        ),
        (
            "compose_nginx_without_health",
            FakePreflightClient(fail_health=True),
            "run_debug_loop",
            True,
        ),
        (
            "needs_setup",
            FakePreflightClient(setup={"step": "not_started"}, init={"status": "finished"}),
            "setup_local_ce_admin",
            False,
        ),
        ("needs_login", FakePreflightClient(fail_workspace=True), "login", False),
        ("ready", FakePreflightClient(), "run_debug_loop", True),
    ]
    results: list[dict[str, Any]] = []
    for name, client, next_action, ready in cases:
        result = run_preflight_sequence(client)  # type: ignore[arg-type]
        if result["next_action"] != next_action:
            raise AssertionError(f"{name}: expected next_action {next_action}, got {result}")
        if result["ready"] is not ready:
            raise AssertionError(f"{name}: expected ready={ready}, got {result}")
        results.append({"name": name, "next_action": result["next_action"], "ready": result["ready"]})
    return results


def assert_field_encoding() -> dict[str, Any]:
    cases = {
        "ascii": ("Password123", "UGFzc3dvcmQxMjM="),
        "utf8": ("密码123abc", "5a+G56CBMTIzYWJj"),
    }
    for name, (plain, expected) in cases.items():
        encoded = encode_sensitive_field(plain)
        if encoded != expected:
            raise AssertionError(f"{name}: expected {expected}, got {encoded}")
    return {"name": "field_encoding", "valid": True, "cases": sorted(cases)}


def assert_draft_debug_run_record_fallback() -> dict[str, Any]:
    client = FakeDraftDebugClient()
    result = run_debug_draft_sequence(
        client,  # type: ignore[arg-type]
        app_id="app-1",
        mode="workflow",
        inputs={"query": "hello"},
        query="hello",
        files=None,
        skip_dependencies=False,
        skip_run_records=False,
        include_raw=False,
    )
    methods = [call["method"] for call in client.calls]
    for expected in ("workflow_runs", "workflow_run_detail", "workflow_run_node_executions"):
        if expected not in methods:
            raise AssertionError(f"missing run-record fallback call {expected}: {client.calls}")
    if result["run_detail"] != {"id": "run-1", "status": "failed", "error": "missing selector"}:
        raise AssertionError(f"expected fallback run_detail from latest run: {result}")
    if not result["node_executions"]:
        raise AssertionError(f"expected fallback node executions: {result}")
    return {"name": "draft_debug_run_record_fallback", "valid": True, "calls": client.calls}


def main() -> int:
    dependencies_report = {
        "leaked_dependencies": [
            {
                "type": "marketplace",
                "value": {
                    "marketplace_plugin_unique_identifier": "langgenius/dify-gmail:0.2.1@hash",
                },
            },
            {
                "type": "package",
                "value": {
                    "plugin_unique_identifier": "yaxuanm/qdrant:0.0.1@hash",
                },
            },
            {
                "type": "github",
                "value": {
                    "github_plugin_unique_identifier": "org/plugin:1.0.0@hash",
                    "repo": "org/plugin",
                    "version": "v1.0.0",
                    "package": "plugin.difypkg",
                },
            },
        ]
    }
    client = FakeConsoleClient()
    result = run_install_dependencies_sequence(
        client,  # type: ignore[arg-type]
        dependencies_report,
        wait=True,
        timeout_seconds=3,
        poll_interval_seconds=0,
    )

    methods = [call["method"] for call in client.calls]
    for expected in ("marketplace", "package", "github", "plugin_task"):
        if expected not in methods:
            raise AssertionError(f"missing expected call {expected}: {client.calls}")
    if not result["ok"]:
        raise AssertionError(f"expected ok install sequence: {result}")
    if len(result["waited_tasks"]) != 3:
        raise AssertionError(f"expected three waited tasks: {result}")

    print(
        json.dumps(
            {
                "valid": True,
                "result": result,
                "calls": client.calls,
                "preflight_cases": assert_preflight(),
                "field_encoding": assert_field_encoding(),
                "draft_debug": assert_draft_debug_run_record_fallback(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
