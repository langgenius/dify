#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from typing import Any


DEFAULT_COOKIE_JAR = Path.home() / ".dify_console_cookies.txt"
PLUGIN_INSTALL_TERMINAL_STATUSES = {"success", "failed"}
DEFAULT_CONSOLE_BASE = "http://localhost"
MAX_ERROR_RAW_LENGTH = 500


class ConsoleApiError(RuntimeError):
    pass


class ConsoleApiHttpError(ConsoleApiError):
    def __init__(self, method: str, path: str, status: int, detail: Any) -> None:
        self.method = method.upper()
        self.path = path
        self.status = status
        self.detail = detail
        super().__init__(f"{self.method} {self.path} failed: HTTP {self.status}: {self.detail}")

    def to_dict(self, stage: str | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {
            "method": self.method,
            "path": self.path,
            "status": self.status,
            "detail": self.detail,
        }
        if stage:
            result["stage"] = stage
        return result


class DifyConsoleClient:
    def __init__(
        self,
        *,
        console_base: str,
        bearer_token: str | None = None,
        csrf_token: str | None = None,
        cookie_jar_path: Path | None = DEFAULT_COOKIE_JAR,
    ) -> None:
        self.console_base = console_base.rstrip("/")
        self.bearer_token = bearer_token
        self.csrf_token = csrf_token
        self.cookie_jar_path = cookie_jar_path
        self.cookie_jar = MozillaCookieJar(str(cookie_jar_path)) if cookie_jar_path else MozillaCookieJar()
        if cookie_jar_path and cookie_jar_path.exists():
            self.cookie_jar.load(ignore_discard=True, ignore_expires=True)
            self._harden_cookie_jar_permissions()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

    def save_cookies(self) -> None:
        if self.cookie_jar_path:
            self.cookie_jar.save(ignore_discard=True, ignore_expires=True)
            self._harden_cookie_jar_permissions()

    def _harden_cookie_jar_permissions(self) -> None:
        if not self.cookie_jar_path:
            return
        try:
            self.cookie_jar_path.chmod(0o600)
        except OSError:
            pass

    def url(self, path: str, query: dict[str, Any] | None = None) -> str:
        path = path if path.startswith("/") else f"/{path}"
        base = f"{self.console_base}{path}"
        if query:
            return f"{base}?{urllib.parse.urlencode(query)}"
        return base

    def current_csrf_token(self) -> str | None:
        if self.csrf_token:
            return self.csrf_token
        for cookie in self.cookie_jar:
            if cookie.name.endswith("csrf_token"):
                return cookie.value
        return None

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        raw_response: bool = False,
    ) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        csrf = self.current_csrf_token()
        if csrf:
            headers["X-CSRF-Token"] = csrf

        req = urllib.request.Request(self.url(path, query), data=data, headers=headers, method=method.upper())
        try:
            with self.opener.open(req, timeout=120) as response:
                payload = response.read()
                self.save_cookies()
                if raw_response:
                    return payload.decode("utf-8", errors="replace")
                if not payload:
                    return {}
                content_type = response.headers.get("Content-Type", "")
                if "json" in content_type:
                    return json.loads(payload.decode("utf-8"))
                text = payload.decode("utf-8", errors="replace")
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return {"raw": text}
        except urllib.error.HTTPError as exc:
            detail_text = exc.read().decode("utf-8", errors="replace")
            try:
                detail: Any = json.loads(detail_text)
            except json.JSONDecodeError:
                detail = {"raw": detail_text}
            raise ConsoleApiHttpError(method, path, exc.code, detail) from exc
        except urllib.error.URLError as exc:
            raise ConsoleApiError(f"{method.upper()} {path} failed: {exc}") from exc

    def request_multipart(
        self,
        method: str,
        path: str,
        *,
        fields: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]],
        query: dict[str, Any] | None = None,
    ) -> Any:
        boundary = f"----dify-dsl-agent-{uuid.uuid4().hex}"
        body_parts: list[bytes] = []
        for name, value in (fields or {}).items():
            body_parts.extend(
                [
                    f"--{boundary}\r\n".encode("ascii"),
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                    str(value).encode("utf-8"),
                    b"\r\n",
                ]
            )
        for field_name, (filename, content, content_type) in files.items():
            body_parts.extend(
                [
                    f"--{boundary}\r\n".encode("ascii"),
                    (
                        f'Content-Disposition: form-data; name="{field_name}"; '
                        f'filename="{filename}"\r\n'
                    ).encode("utf-8"),
                    f"Content-Type: {content_type}\r\n\r\n".encode("ascii"),
                    content,
                    b"\r\n",
                ]
            )
        body_parts.append(f"--{boundary}--\r\n".encode("ascii"))
        data = b"".join(body_parts)

        headers = {
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        csrf = self.current_csrf_token()
        if csrf:
            headers["X-CSRF-Token"] = csrf

        req = urllib.request.Request(self.url(path, query), data=data, headers=headers, method=method.upper())
        try:
            with self.opener.open(req, timeout=120) as response:
                payload = response.read()
                self.save_cookies()
                if not payload:
                    return {}
                text = payload.decode("utf-8", errors="replace")
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return {"raw": text}
        except urllib.error.HTTPError as exc:
            detail_text = exc.read().decode("utf-8", errors="replace")
            try:
                detail: Any = json.loads(detail_text)
            except json.JSONDecodeError:
                detail = {"raw": detail_text}
            raise ConsoleApiHttpError(method, path, exc.code, detail) from exc
        except urllib.error.URLError as exc:
            raise ConsoleApiError(f"{method.upper()} {path} failed: {exc}") from exc

    def health(self) -> Any:
        return self.request("GET", "/health")

    def setup_status(self) -> Any:
        return self.request("GET", "/console/api/setup")

    def init_status(self) -> Any:
        return self.request("GET", "/console/api/init")

    def validate_init_password(self, password: str) -> Any:
        return self.request("POST", "/console/api/init", body={"password": password})

    def setup(
        self,
        *,
        email: str,
        name: str,
        password: str,
        language: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"email": email, "name": name, "password": password}
        if language:
            body["language"] = language
        return self.request("POST", "/console/api/setup", body=body)

    def current_workspace(self) -> Any:
        return self.request("POST", "/console/api/workspaces/current")

    def login(self, email: str, password: str, remember_me: bool = True, password_is_encoded: bool = False) -> Any:
        encoded_password = password if password_is_encoded else encode_sensitive_field(password)
        return self.request(
            "POST",
            "/console/api/login",
            body={"email": email, "password": encoded_password, "remember_me": remember_me},
        )

    def refresh_token(self) -> Any:
        return self.request("POST", "/console/api/refresh-token")

    def import_dsl(self, yaml_text: str, *, app_id: str | None = None, name: str | None = None) -> Any:
        body: dict[str, Any] = {"mode": "yaml-content", "yaml_content": yaml_text}
        if app_id:
            body["app_id"] = app_id
        if name:
            body["name"] = name
        return self.request("POST", "/console/api/apps/imports", body=body)

    def confirm_import(self, import_id: str) -> Any:
        return self.request("POST", f"/console/api/apps/imports/{import_id}/confirm")

    def app_detail(self, app_id: str) -> Any:
        return self.request("GET", f"/console/api/apps/{app_id}")

    def check_dependencies(self, app_id: str) -> Any:
        return self.request("GET", f"/console/api/apps/imports/{app_id}/check-dependencies")

    def workflow_runs(
        self,
        app_id: str,
        *,
        mode: str = "workflow",
        limit: int = 20,
        last_id: str | None = None,
        status: str | None = None,
        triggered_from: str = "debugging",
    ) -> Any:
        path = (
            f"/console/api/apps/{app_id}/advanced-chat/workflow-runs"
            if mode == "advanced-chat"
            else f"/console/api/apps/{app_id}/workflow-runs"
        )
        query: dict[str, Any] = {"limit": limit, "triggered_from": triggered_from}
        if last_id:
            query["last_id"] = last_id
        if status:
            query["status"] = status
        return self.request("GET", path, query=query)

    def workflow_run_detail(self, app_id: str, run_id: str) -> Any:
        return self.request("GET", f"/console/api/apps/{app_id}/workflow-runs/{run_id}")

    def workflow_run_node_executions(self, app_id: str, run_id: str) -> Any:
        return self.request("GET", f"/console/api/apps/{app_id}/workflow-runs/{run_id}/node-executions")

    def draft_run(self, app_id: str, inputs: dict[str, Any], files: list[dict[str, Any]] | None = None) -> Any:
        body: dict[str, Any] = {"inputs": inputs}
        if files is not None:
            body["files"] = files
        return self.request("POST", f"/console/api/apps/{app_id}/workflows/draft/run", body=body, raw_response=True)

    def advanced_chat_draft_run(
        self,
        app_id: str,
        *,
        query: str,
        inputs: dict[str, Any] | None = None,
        conversation_id: str | None = None,
        files: list[dict[str, Any]] | None = None,
    ) -> Any:
        body: dict[str, Any] = {"query": query, "inputs": inputs or {}}
        if conversation_id:
            body["conversation_id"] = conversation_id
        if files is not None:
            body["files"] = files
        return self.request(
            "POST",
            f"/console/api/apps/{app_id}/advanced-chat/workflows/draft/run",
            body=body,
            raw_response=True,
        )

    def node_run(self, app_id: str, node_id: str, inputs: dict[str, Any], query: str = "") -> Any:
        return self.request(
            "POST",
            f"/console/api/apps/{app_id}/workflows/draft/nodes/{node_id}/run",
            body={"inputs": inputs, "query": query},
        )

    def publish(self, app_id: str, marked_name: str | None = None, marked_comment: str | None = None) -> Any:
        body: dict[str, Any] = {}
        if marked_name:
            body["marked_name"] = marked_name
        if marked_comment:
            body["marked_comment"] = marked_comment
        return self.request("POST", f"/console/api/apps/{app_id}/workflows/publish", body=body)

    def enable_api(self, app_id: str, enabled: bool = True) -> Any:
        return self.request("POST", f"/console/api/apps/{app_id}/api-enable", body={"enable_api": enabled})

    def create_api_key(self, app_id: str) -> Any:
        return self.request("POST", f"/console/api/apps/{app_id}/api-keys", body={})

    def list_api_keys(self, app_id: str) -> Any:
        return self.request("GET", f"/console/api/apps/{app_id}/api-keys")

    def export_dsl(self, app_id: str, include_secret: bool = False, workflow_id: str | None = None) -> Any:
        query: dict[str, Any] = {"include_secret": str(include_secret).lower()}
        if workflow_id:
            query["workflow_id"] = workflow_id
        return self.request("GET", f"/console/api/apps/{app_id}/export", query=query)

    def install_plugins_from_marketplace(self, plugin_unique_identifiers: list[str]) -> Any:
        return self.request(
            "POST",
            "/console/api/workspaces/current/plugin/install/marketplace",
            body={"plugin_unique_identifiers": plugin_unique_identifiers},
        )

    def upload_plugin_pkg(self, pkg_file: Path) -> Any:
        return self.request_multipart(
            "POST",
            "/console/api/workspaces/current/plugin/upload/pkg",
            files={
                "pkg": (
                    pkg_file.name,
                    pkg_file.read_bytes(),
                    "application/octet-stream",
                )
            },
        )

    def install_plugins_from_pkg(self, plugin_unique_identifiers: list[str]) -> Any:
        return self.request(
            "POST",
            "/console/api/workspaces/current/plugin/install/pkg",
            body={"plugin_unique_identifiers": plugin_unique_identifiers},
        )

    def install_plugin_from_github(
        self,
        *,
        plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> Any:
        return self.request(
            "POST",
            "/console/api/workspaces/current/plugin/install/github",
            body={
                "plugin_unique_identifier": plugin_unique_identifier,
                "repo": repo,
                "version": version,
                "package": package,
            },
        )

    def plugin_tasks(self, page: int = 1, page_size: int = 256) -> Any:
        return self.request(
            "GET",
            "/console/api/workspaces/current/plugin/tasks",
            query={"page": page, "page_size": page_size},
        )

    def plugin_task(self, task_id: str) -> Any:
        return self.request("GET", f"/console/api/workspaces/current/plugin/tasks/{task_id}")

    def plugin_list(self, page: int = 1, page_size: int = 256) -> Any:
        return self.request(
            "GET",
            "/console/api/workspaces/current/plugin/list",
            query={"page": page, "page_size": page_size},
        )

    def model_providers(self, model_type: str | None = None) -> Any:
        query: dict[str, Any] = {}
        if model_type:
            query["model_type"] = model_type
        return self.request("GET", "/console/api/workspaces/current/model-providers", query=query or None)

    def validate_model_provider_credentials(self, provider: str, credentials: dict[str, Any]) -> Any:
        return self.request(
            "POST",
            f"/console/api/workspaces/current/model-providers/{provider}/credentials/validate",
            body={"credentials": credentials},
        )

    def create_model_provider_credential(
        self,
        provider: str,
        credentials: dict[str, Any],
        *,
        name: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {"credentials": credentials}
        if name:
            body["name"] = name
        return self.request(
            "POST",
            f"/console/api/workspaces/current/model-providers/{provider}/credentials",
            body=body,
        )

    def get_model_provider_credential(self, provider: str, credential_id: str | None = None) -> Any:
        query = {"credential_id": credential_id} if credential_id else None
        return self.request("GET", f"/console/api/workspaces/current/model-providers/{provider}/credentials", query=query)


def parse_json_arg(value: str | None, default: Any) -> Any:
    if value is None:
        return default
    return json.loads(value)


def parse_json_stdin() -> dict[str, Any]:
    raw = sys.stdin.read()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Expected JSON object from stdin.")
    return value


def encode_sensitive_field(value: str) -> str:
    """Match the Console frontend's UTF-8 Base64 encoding for login fields."""
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def dependency_unique_identifier(dependency: Any) -> str:
    if not isinstance(dependency, dict):
        return ""
    value = dependency.get("value")
    if not isinstance(value, dict):
        return ""
    for key in ("marketplace_plugin_unique_identifier", "plugin_unique_identifier", "github_plugin_unique_identifier"):
        identifier = value.get(key)
        if isinstance(identifier, str) and identifier:
            return identifier
    return ""


def extract_leaked_dependencies(dependencies_report: Any) -> list[dict[str, Any]]:
    if not isinstance(dependencies_report, dict):
        return []
    leaked = dependencies_report.get("leaked_dependencies")
    return [item for item in leaked if isinstance(item, dict)] if isinstance(leaked, list) else []


def install_task_id(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    task_id = result.get("task_id")
    return task_id if isinstance(task_id, str) and task_id else None


def task_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict) and isinstance(result.get("task"), dict):
        return result["task"]
    return result if isinstance(result, dict) else {}


def task_status(result: Any) -> str | None:
    status = task_payload(result).get("status")
    return str(status) if status else None


def wait_for_plugin_install_task(
    client: DifyConsoleClient,
    task_id: str,
    *,
    timeout_seconds: int,
    poll_interval_seconds: float,
) -> dict[str, Any]:
    started = time.monotonic()
    latest: Any = None
    while True:
        latest = client.plugin_task(task_id)
        status = task_status(latest)
        if status in PLUGIN_INSTALL_TERMINAL_STATUSES:
            return {"task_id": task_id, "status": status, "task": task_payload(latest), "timed_out": False}
        if time.monotonic() - started >= timeout_seconds:
            return {"task_id": task_id, "status": status, "task": task_payload(latest), "timed_out": True}
        time.sleep(poll_interval_seconds)


def run_install_dependencies_sequence(
    client: DifyConsoleClient,
    dependencies_report: Any,
    *,
    wait: bool,
    timeout_seconds: int,
    poll_interval_seconds: float,
) -> dict[str, Any]:
    leaked = extract_leaked_dependencies(dependencies_report)
    result: dict[str, Any] = {
        "leaked_count": len(leaked),
        "installed": [],
        "skipped": [],
        "waited_tasks": [],
        "errors": [],
        "ok": True,
    }
    marketplace_identifiers: list[str] = []
    package_identifiers: list[str] = []
    github_dependencies: list[dict[str, Any]] = []

    for dependency in leaked:
        dep_type = dependency.get("type")
        identifier = dependency_unique_identifier(dependency)
        value = dependency.get("value") if isinstance(dependency.get("value"), dict) else {}
        if not identifier:
            result["skipped"].append({"dependency": dependency, "reason": "missing unique identifier"})
            continue
        if dep_type == "marketplace":
            marketplace_identifiers.append(identifier)
        elif dep_type == "package":
            package_identifiers.append(identifier)
        elif dep_type == "github":
            github_dependencies.append(
                {
                    "plugin_unique_identifier": identifier,
                    "repo": value.get("repo"),
                    "version": value.get("version"),
                    "package": value.get("package"),
                }
            )
        else:
            result["skipped"].append({"dependency": dependency, "reason": f"unsupported dependency type `{dep_type}`"})

    def maybe_wait(install_result: Any) -> None:
        task_id = install_task_id(install_result)
        if not task_id or not wait:
            return
        result["waited_tasks"].append(
            wait_for_plugin_install_task(
                client,
                task_id,
                timeout_seconds=timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
            )
        )

    try:
        if marketplace_identifiers:
            install_result = client.install_plugins_from_marketplace(sorted(set(marketplace_identifiers)))
            result["installed"].append({"type": "marketplace", "identifiers": sorted(set(marketplace_identifiers)), "result": install_result})
            maybe_wait(install_result)
        if package_identifiers:
            install_result = client.install_plugins_from_pkg(sorted(set(package_identifiers)))
            result["installed"].append({"type": "package", "identifiers": sorted(set(package_identifiers)), "result": install_result})
            maybe_wait(install_result)
        for dependency in github_dependencies:
            if not dependency.get("repo") or not dependency.get("version") or not dependency.get("package"):
                result["skipped"].append({"dependency": dependency, "reason": "github dependency requires repo, version, and package"})
                continue
            install_result = client.install_plugin_from_github(
                plugin_unique_identifier=str(dependency["plugin_unique_identifier"]),
                repo=str(dependency["repo"]),
                version=str(dependency["version"]),
                package=str(dependency["package"]),
            )
            result["installed"].append({"type": "github", "dependency": dependency, "result": install_result})
            maybe_wait(install_result)
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("install_dependencies", exc))

    failed_tasks = [task for task in result["waited_tasks"] if task.get("timed_out") or task.get("status") == "failed"]
    result["ok"] = not result["errors"] and not failed_tasks
    return result


def print_result(result: Any, output: Path | None = None) -> None:
    if isinstance(result, str):
        text = result
    else:
        text = json.dumps(result, ensure_ascii=False, indent=2)
    if output:
        output.write_text(text)
    print(text)


def parse_sse_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event_name: str | None = None
    data_lines: list[str] = []

    def flush() -> None:
        nonlocal event_name, data_lines
        if not data_lines:
            event_name = None
            return
        payload_text = "\n".join(data_lines).strip()
        current_event = event_name
        event_name = None
        data_lines = []
        if not payload_text or payload_text == "[DONE]":
            return
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            payload = {"raw": payload_text}
        if isinstance(payload, dict):
            if current_event and "event" not in payload:
                payload["sse_event"] = current_event
            events.append(payload)
        else:
            events.append({"event": current_event, "data": payload})

    for line in text.splitlines():
        if not line.strip():
            flush()
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line.removeprefix("event:").strip()
            continue
        if line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").lstrip())
            continue
        if line.startswith("id:") or line.startswith("retry:"):
            continue
        data_lines.append(line)
    flush()
    return events


def summarize_stream_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "event_count": len(events),
        "task_id": None,
        "workflow_run_id": None,
        "status": None,
        "succeeded": None,
        "outputs": None,
        "node_statuses": [],
        "failed_nodes": [],
        "errors": [],
    }
    successful_statuses = {"succeeded", "partial-succeeded"}

    for event in events:
        name = str(event.get("event") or event.get("sse_event") or "")
        if event.get("task_id") and not summary["task_id"]:
            summary["task_id"] = event["task_id"]
        if event.get("workflow_run_id") and not summary["workflow_run_id"]:
            summary["workflow_run_id"] = event["workflow_run_id"]

        data = event.get("data")
        if not isinstance(data, dict):
            data = {}

        if name == "workflow_started":
            run_id = event.get("workflow_run_id") or data.get("id")
            if run_id and not summary["workflow_run_id"]:
                summary["workflow_run_id"] = run_id

        if name == "workflow_finished":
            status = data.get("status")
            summary["status"] = status
            summary["outputs"] = data.get("outputs")
            summary["succeeded"] = status in successful_statuses and not data.get("error")
            if data.get("error"):
                summary["errors"].append(
                    {
                        "event": name,
                        "message": data.get("error"),
                        "workflow_run_id": event.get("workflow_run_id"),
                    }
                )

        if name == "node_finished":
            node = {
                "node_id": data.get("node_id"),
                "node_type": data.get("node_type"),
                "title": data.get("title"),
                "status": data.get("status"),
                "error": data.get("error"),
                "elapsed_time": data.get("elapsed_time"),
            }
            summary["node_statuses"].append(node)
            if data.get("error") or data.get("status") not in successful_statuses:
                summary["failed_nodes"].append(node)
                if data.get("error"):
                    summary["errors"].append(
                        {
                            "event": name,
                            "node_id": data.get("node_id"),
                            "node_type": data.get("node_type"),
                            "title": data.get("title"),
                            "message": data.get("error"),
                        }
                    )

        if name == "error":
            message = event.get("message") or event.get("error") or event.get("err") or data.get("message")
            summary["errors"].append({"event": name, "message": str(message)})

    if summary["succeeded"] is None and summary["errors"]:
        summary["succeeded"] = False
    return summary


def format_stream_result(raw_text: str, *, include_raw: bool) -> dict[str, Any]:
    events = parse_sse_events(raw_text)
    result: dict[str, Any] = {
        "summary": summarize_stream_events(events),
        "events": events,
    }
    if include_raw:
        result["raw"] = raw_text
    return result


def truncate_raw_error_detail(detail: Any) -> Any:
    if isinstance(detail, dict):
        result: dict[str, Any] = {}
        for key, value in detail.items():
            if key == "raw" and isinstance(value, str) and len(value) > MAX_ERROR_RAW_LENGTH:
                result[key] = value[:MAX_ERROR_RAW_LENGTH] + "...[truncated]"
                result["raw_truncated"] = True
                result["raw_length"] = len(value)
            else:
                result[key] = truncate_raw_error_detail(value)
        return result
    if isinstance(detail, list):
        return [truncate_raw_error_detail(item) for item in detail]
    return detail


def console_error_to_dict(stage: str, exc: ConsoleApiError) -> dict[str, Any]:
    if isinstance(exc, ConsoleApiHttpError):
        result = exc.to_dict(stage=stage)
        result["detail"] = truncate_raw_error_detail(result.get("detail"))
        return result
    return {"stage": stage, "message": str(exc)}


def run_preflight_sequence(client: DifyConsoleClient) -> dict[str, Any]:
    result: dict[str, Any] = {
        "console_base": client.console_base,
        "health": None,
        "setup": None,
        "init": None,
        "workspace": None,
        "errors": [],
        "warnings": [],
        "ready": False,
        "next_action": None,
        "suggested_commands": [],
    }

    def start_local_ce_result() -> dict[str, Any]:
        result["next_action"] = "start_local_dify_ce"
        result["suggested_commands"].extend(
            [
                "open Docker Desktop",
                "cd dify/docker && cp .env.example .env && docker compose up -d",
            ]
        )
        return result

    health_error: dict[str, Any] | None = None
    try:
        result["health"] = client.health()
    except ConsoleApiError as exc:
        health_error = console_error_to_dict("health", exc)

    try:
        result["setup"] = client.setup_status()
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("setup_status", exc))

    try:
        result["init"] = client.init_status()
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("init_status", exc))

    if result["setup"] is None and result["init"] is None:
        if health_error:
            result["errors"].append(health_error)
        return start_local_ce_result()
    if health_error:
        result["warnings"].append(health_error)

    setup_step = result["setup"].get("step") if isinstance(result["setup"], dict) else None
    init_status = result["init"].get("status") if isinstance(result["init"], dict) else None
    if setup_step == "not_started":
        result["next_action"] = "setup_local_ce_admin"
        if init_status == "not_started":
            result["suggested_commands"].append(
                "python3 dify/scripts/dsl_agent/console_lifecycle.py init-validate --init-password YOUR_INIT_PASSWORD"
            )
        result["suggested_commands"].append(
            "python3 dify/scripts/dsl_agent/console_lifecycle.py setup --email you@example.com --name Admin --password 'YOUR_PASSWORD'"
        )
        return result

    try:
        result["workspace"] = client.current_workspace()
        result["ready"] = True
        result["next_action"] = "run_debug_loop"
        result["suggested_commands"].append(
            f"python3 dify/scripts/dsl_agent/debug_loop.py dify/scripts/dsl_agent/outputs/<run-id> --console-base {client.console_base} --mode workflow --inputs '{{}}' --install-missing-dependencies"
        )
        return result
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("current_workspace", exc))
        result["next_action"] = "login"
        result["suggested_commands"].append(
            "python3 dify/scripts/dsl_agent/console_lifecycle.py login --email you@example.com --password 'YOUR_PASSWORD'"
        )
        return result


def extract_app_id(*values: Any) -> str | None:
    for value in values:
        if not isinstance(value, dict):
            continue
        for key in ("app_id", "id"):
            found = value.get(key)
            if isinstance(found, str) and found:
                return found
        nested = value.get("app")
        if isinstance(nested, dict):
            found = nested.get("id")
            if isinstance(found, str) and found:
                return found
    return None


def run_import_debug_sequence(
    client: DifyConsoleClient,
    *,
    yaml_file: Path,
    app_id: str | None,
    name: str | None,
    confirm: bool,
    skip_dependencies: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "yaml_file": str(yaml_file),
        "requested_app_id": app_id,
        "import": None,
        "confirm": None,
        "dependencies": None,
        "app_id": app_id,
        "errors": [],
        "ok": False,
    }

    try:
        import_result = client.import_dsl(yaml_file.read_text(), app_id=app_id, name=name)
        result["import"] = import_result
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("import", exc))
        return result

    import_result = result["import"] if isinstance(result["import"], dict) else {}
    result["app_id"] = extract_app_id(import_result) or app_id
    import_status = import_result.get("status")

    if confirm and import_status == "pending" and isinstance(import_result.get("id"), str):
        try:
            confirm_result = client.confirm_import(import_result["id"])
            result["confirm"] = confirm_result
            result["app_id"] = extract_app_id(confirm_result, import_result) or app_id
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("confirm", exc))
            return result

    if not skip_dependencies and result["app_id"]:
        try:
            result["dependencies"] = client.check_dependencies(str(result["app_id"]))
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("check_dependencies", exc))

    statuses = [
        block.get("status")
        for block in (result.get("import"), result.get("confirm"))
        if isinstance(block, dict) and block.get("status")
    ]
    failed = any(status == "failed" for status in statuses)
    pending_without_confirm = import_status == "pending" and not confirm
    result["ok"] = not result["errors"] and not failed and not pending_without_confirm
    return result


def run_debug_draft_sequence(
    client: DifyConsoleClient,
    *,
    app_id: str,
    mode: str,
    inputs: dict[str, Any],
    query: str,
    files: list[dict[str, Any]] | None,
    skip_dependencies: bool,
    skip_run_records: bool,
    include_raw: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "app_id": app_id,
        "mode": mode,
        "dependencies": None,
        "draft_run": None,
        "run_detail": None,
        "node_executions": None,
        "errors": [],
    }

    if not skip_dependencies:
        try:
            result["dependencies"] = client.check_dependencies(app_id)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("check_dependencies", exc))

    try:
        if mode == "advanced-chat":
            raw = client.advanced_chat_draft_run(app_id, query=query, inputs=inputs, files=files)
        else:
            raw = client.draft_run(app_id, inputs, files)
        result["draft_run"] = format_stream_result(raw, include_raw=include_raw)
    except ConsoleApiError as exc:
        result["errors"].append(console_error_to_dict("draft_run", exc))
        return result

    summary = (result.get("draft_run") or {}).get("summary") if isinstance(result.get("draft_run"), dict) else {}
    run_id = summary.get("workflow_run_id") if isinstance(summary, dict) else None
    if run_id and not skip_run_records:
        try:
            result["run_detail"] = client.workflow_run_detail(app_id, run_id)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("workflow_run_detail", exc))
        try:
            result["node_executions"] = client.workflow_run_node_executions(app_id, run_id)
        except ConsoleApiError as exc:
            result["errors"].append(console_error_to_dict("workflow_run_node_executions", exc))

    return result


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE, help="Dify console origin, without /console/api.")
    parser.add_argument("--bearer-token", help="Existing console access token. Cookie login is preferred for CSRF.")
    parser.add_argument("--csrf-token", help="Explicit CSRF token for write requests.")
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("-o", "--output", type=Path)


def build_client(args: argparse.Namespace) -> DifyConsoleClient:
    return DifyConsoleClient(
        console_base=args.console_base,
        bearer_token=args.bearer_token,
        csrf_token=args.csrf_token,
        cookie_jar_path=args.cookie_jar,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Dify Console API lifecycle actions for DSL automation.")
    add_common_args(parser)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("preflight")
    subparsers.add_parser("setup-status")
    subparsers.add_parser("init-status")

    init_validate = subparsers.add_parser("init-validate")
    init_validate.add_argument("--init-password", required=True)

    setup = subparsers.add_parser("setup")
    setup.add_argument("--email", required=True)
    setup.add_argument("--name", required=True)
    setup.add_argument("--password", required=True)
    setup.add_argument("--language")

    subparsers.add_parser("workspace-current")

    login = subparsers.add_parser("login")
    login.add_argument("--email", required=True)
    login.add_argument("--password", required=True)
    login.add_argument("--password-encoded", action="store_true", help="Treat --password as already UTF-8 Base64 encoded.")
    login.add_argument("--no-remember-me", action="store_true")

    subparsers.add_parser("refresh-token")

    import_cmd = subparsers.add_parser("import")
    import_cmd.add_argument("yaml_file", type=Path)
    import_cmd.add_argument("--app-id")
    import_cmd.add_argument("--name")
    import_cmd.add_argument("--confirm", action="store_true")

    import_debug = subparsers.add_parser("import-debug")
    import_debug.add_argument("yaml_file", type=Path)
    import_debug.add_argument("--app-id")
    import_debug.add_argument("--name")
    import_debug.add_argument("--confirm", action="store_true")
    import_debug.add_argument("--skip-dependencies", action="store_true")

    confirm = subparsers.add_parser("confirm")
    confirm.add_argument("import_id")

    detail = subparsers.add_parser("app-detail")
    detail.add_argument("app_id")

    deps = subparsers.add_parser("check-dependencies")
    deps.add_argument("app_id")

    install_deps = subparsers.add_parser("install-missing-dependencies")
    install_deps.add_argument("app_id")
    install_deps.add_argument("--no-wait", action="store_true")
    install_deps.add_argument("--timeout-seconds", type=int, default=180)
    install_deps.add_argument("--poll-interval-seconds", type=float, default=2.0)

    plugin_marketplace = subparsers.add_parser("plugin-install-marketplace")
    plugin_marketplace.add_argument("plugin_unique_identifiers", nargs="+")
    plugin_marketplace.add_argument("--no-wait", action="store_true")
    plugin_marketplace.add_argument("--timeout-seconds", type=int, default=180)
    plugin_marketplace.add_argument("--poll-interval-seconds", type=float, default=2.0)

    plugin_upload_pkg = subparsers.add_parser("plugin-upload-pkg")
    plugin_upload_pkg.add_argument("pkg_file", type=Path)

    plugin_pkg = subparsers.add_parser("plugin-install-pkg")
    plugin_pkg.add_argument("plugin_unique_identifiers", nargs="+")
    plugin_pkg.add_argument("--no-wait", action="store_true")
    plugin_pkg.add_argument("--timeout-seconds", type=int, default=180)
    plugin_pkg.add_argument("--poll-interval-seconds", type=float, default=2.0)

    plugin_github = subparsers.add_parser("plugin-install-github")
    plugin_github.add_argument("plugin_unique_identifier")
    plugin_github.add_argument("--repo", required=True)
    plugin_github.add_argument("--version", required=True)
    plugin_github.add_argument("--package", required=True)
    plugin_github.add_argument("--no-wait", action="store_true")
    plugin_github.add_argument("--timeout-seconds", type=int, default=180)
    plugin_github.add_argument("--poll-interval-seconds", type=float, default=2.0)

    plugin_tasks = subparsers.add_parser("plugin-tasks")
    plugin_tasks.add_argument("--page", type=int, default=1)
    plugin_tasks.add_argument("--page-size", type=int, default=256)

    plugin_task = subparsers.add_parser("plugin-task")
    plugin_task.add_argument("task_id")

    plugin_list = subparsers.add_parser("plugin-list")
    plugin_list.add_argument("--page", type=int, default=1)
    plugin_list.add_argument("--page-size", type=int, default=256)

    model_providers = subparsers.add_parser("model-providers")
    model_providers.add_argument("--model-type")

    model_provider_validate = subparsers.add_parser("model-provider-validate")
    model_provider_validate.add_argument("provider")
    model_provider_validate.add_argument("--credentials-json")
    model_provider_validate.add_argument("--credentials-stdin", action="store_true")

    model_provider_create_credential = subparsers.add_parser("model-provider-create-credential")
    model_provider_create_credential.add_argument("provider")
    model_provider_create_credential.add_argument("--name")
    model_provider_create_credential.add_argument("--credentials-json")
    model_provider_create_credential.add_argument("--credentials-stdin", action="store_true")

    model_provider_get_credential = subparsers.add_parser("model-provider-get-credential")
    model_provider_get_credential.add_argument("provider")
    model_provider_get_credential.add_argument("--credential-id")

    runs = subparsers.add_parser("workflow-runs")
    runs.add_argument("app_id")
    runs.add_argument("--mode", choices=["workflow", "advanced-chat"], default="workflow")
    runs.add_argument("--limit", type=int, default=20)
    runs.add_argument("--last-id")
    runs.add_argument("--status", choices=["running", "succeeded", "failed", "stopped", "partial-succeeded"])
    runs.add_argument("--triggered-from", choices=["debugging", "app-run"], default="debugging")

    run_detail = subparsers.add_parser("workflow-run-detail")
    run_detail.add_argument("app_id")
    run_detail.add_argument("run_id")

    node_execs = subparsers.add_parser("workflow-run-node-executions")
    node_execs.add_argument("app_id")
    node_execs.add_argument("run_id")

    draft = subparsers.add_parser("draft-run")
    draft.add_argument("app_id")
    draft.add_argument("--inputs", default="{}")
    draft.add_argument("--files")
    draft.add_argument("--parse-events", action="store_true", help="Parse SSE output into structured events and a debug summary.")
    draft.add_argument("--hide-raw", action="store_true", help="When parsing SSE, omit the raw stream from output.")

    chat = subparsers.add_parser("advanced-chat-draft-run")
    chat.add_argument("app_id")
    chat.add_argument("--query", required=True)
    chat.add_argument("--inputs", default="{}")
    chat.add_argument("--conversation-id")
    chat.add_argument("--files")
    chat.add_argument("--parse-events", action="store_true", help="Parse SSE output into structured events and a debug summary.")
    chat.add_argument("--hide-raw", action="store_true", help="When parsing SSE, omit the raw stream from output.")

    debug = subparsers.add_parser("debug-draft")
    debug.add_argument("app_id")
    debug.add_argument("--mode", choices=["workflow", "advanced-chat"], default="workflow")
    debug.add_argument("--inputs", default="{}")
    debug.add_argument("--query", default="hello")
    debug.add_argument("--files")
    debug.add_argument("--skip-dependencies", action="store_true")
    debug.add_argument("--skip-run-records", action="store_true")
    debug.add_argument("--include-raw", action="store_true")

    node = subparsers.add_parser("node-run")
    node.add_argument("app_id")
    node.add_argument("node_id")
    node.add_argument("--inputs", default="{}")
    node.add_argument("--query", default="")

    publish = subparsers.add_parser("publish")
    publish.add_argument("app_id")
    publish.add_argument("--marked-name")
    publish.add_argument("--marked-comment")

    enable = subparsers.add_parser("api-enable")
    enable.add_argument("app_id")
    enable.add_argument("--disabled", action="store_true")

    api_key = subparsers.add_parser("api-key")
    api_key.add_argument("app_id")
    api_key.add_argument("--list", action="store_true")

    export = subparsers.add_parser("export")
    export.add_argument("app_id")
    export.add_argument("--include-secret", action="store_true")
    export.add_argument("--workflow-id")
    return parser.parse_args()


def run(args: argparse.Namespace) -> Any:
    client = build_client(args)
    if args.command == "preflight":
        return run_preflight_sequence(client)
    if args.command == "setup-status":
        return client.setup_status()
    if args.command == "init-status":
        return client.init_status()
    if args.command == "init-validate":
        return client.validate_init_password(args.init_password)
    if args.command == "setup":
        return client.setup(email=args.email, name=args.name, password=args.password, language=args.language)
    if args.command == "workspace-current":
        return client.current_workspace()
    if args.command == "login":
        return client.login(
            args.email,
            args.password,
            remember_me=not args.no_remember_me,
            password_is_encoded=args.password_encoded,
        )
    if args.command == "refresh-token":
        return client.refresh_token()
    if args.command == "import":
        result = client.import_dsl(args.yaml_file.read_text(), app_id=args.app_id, name=args.name)
        if args.confirm and result.get("status") == "pending":
            return client.confirm_import(result["id"])
        return result
    if args.command == "import-debug":
        return run_import_debug_sequence(
            client,
            yaml_file=args.yaml_file,
            app_id=args.app_id,
            name=args.name,
            confirm=args.confirm,
            skip_dependencies=args.skip_dependencies,
        )
    if args.command == "confirm":
        return client.confirm_import(args.import_id)
    if args.command == "app-detail":
        return client.app_detail(args.app_id)
    if args.command == "check-dependencies":
        return client.check_dependencies(args.app_id)
    if args.command == "install-missing-dependencies":
        dependencies = client.check_dependencies(args.app_id)
        install_result = run_install_dependencies_sequence(
            client,
            dependencies,
            wait=not args.no_wait,
            timeout_seconds=args.timeout_seconds,
            poll_interval_seconds=args.poll_interval_seconds,
        )
        refreshed = client.check_dependencies(args.app_id)
        install_result["dependencies_before"] = dependencies
        install_result["dependencies_after"] = refreshed
        install_result["remaining_leaked_count"] = len(extract_leaked_dependencies(refreshed))
        install_result["ok"] = install_result.get("ok") and install_result["remaining_leaked_count"] == 0
        return install_result
    if args.command == "plugin-install-marketplace":
        install_result = client.install_plugins_from_marketplace(args.plugin_unique_identifiers)
        result = {"install": install_result}
        task_id = install_task_id(install_result)
        if task_id and not args.no_wait:
            result["task"] = wait_for_plugin_install_task(
                client,
                task_id,
                timeout_seconds=args.timeout_seconds,
                poll_interval_seconds=args.poll_interval_seconds,
            )
        return result
    if args.command == "plugin-upload-pkg":
        return client.upload_plugin_pkg(args.pkg_file)
    if args.command == "plugin-install-pkg":
        install_result = client.install_plugins_from_pkg(args.plugin_unique_identifiers)
        result = {"install": install_result}
        task_id = install_task_id(install_result)
        if task_id and not args.no_wait:
            result["task"] = wait_for_plugin_install_task(
                client,
                task_id,
                timeout_seconds=args.timeout_seconds,
                poll_interval_seconds=args.poll_interval_seconds,
            )
        return result
    if args.command == "plugin-install-github":
        install_result = client.install_plugin_from_github(
            plugin_unique_identifier=args.plugin_unique_identifier,
            repo=args.repo,
            version=args.version,
            package=args.package,
        )
        result = {"install": install_result}
        task_id = install_task_id(install_result)
        if task_id and not args.no_wait:
            result["task"] = wait_for_plugin_install_task(
                client,
                task_id,
                timeout_seconds=args.timeout_seconds,
                poll_interval_seconds=args.poll_interval_seconds,
            )
        return result
    if args.command == "plugin-tasks":
        return client.plugin_tasks(page=args.page, page_size=args.page_size)
    if args.command == "plugin-task":
        return client.plugin_task(args.task_id)
    if args.command == "plugin-list":
        return client.plugin_list(page=args.page, page_size=args.page_size)
    if args.command == "model-providers":
        return client.model_providers(model_type=args.model_type)
    if args.command == "model-provider-validate":
        credentials = parse_json_stdin() if args.credentials_stdin else parse_json_arg(args.credentials_json, {})
        return client.validate_model_provider_credentials(args.provider, credentials)
    if args.command == "model-provider-create-credential":
        credentials = parse_json_stdin() if args.credentials_stdin else parse_json_arg(args.credentials_json, {})
        return client.create_model_provider_credential(args.provider, credentials, name=args.name)
    if args.command == "model-provider-get-credential":
        return client.get_model_provider_credential(args.provider, credential_id=args.credential_id)
    if args.command == "workflow-runs":
        return client.workflow_runs(
            args.app_id,
            mode=args.mode,
            limit=args.limit,
            last_id=args.last_id,
            status=args.status,
            triggered_from=args.triggered_from,
        )
    if args.command == "workflow-run-detail":
        return client.workflow_run_detail(args.app_id, args.run_id)
    if args.command == "workflow-run-node-executions":
        return client.workflow_run_node_executions(args.app_id, args.run_id)
    if args.command == "draft-run":
        raw = client.draft_run(args.app_id, parse_json_arg(args.inputs, {}), parse_json_arg(args.files, None))
        return format_stream_result(raw, include_raw=not args.hide_raw) if args.parse_events else raw
    if args.command == "advanced-chat-draft-run":
        raw = client.advanced_chat_draft_run(
            args.app_id,
            query=args.query,
            inputs=parse_json_arg(args.inputs, {}),
            conversation_id=args.conversation_id,
            files=parse_json_arg(args.files, None),
        )
        return format_stream_result(raw, include_raw=not args.hide_raw) if args.parse_events else raw
    if args.command == "debug-draft":
        return run_debug_draft_sequence(
            client,
            app_id=args.app_id,
            mode=args.mode,
            inputs=parse_json_arg(args.inputs, {}),
            query=args.query,
            files=parse_json_arg(args.files, None),
            skip_dependencies=args.skip_dependencies,
            skip_run_records=args.skip_run_records,
            include_raw=args.include_raw,
        )
    if args.command == "node-run":
        return client.node_run(args.app_id, args.node_id, parse_json_arg(args.inputs, {}), query=args.query)
    if args.command == "publish":
        return client.publish(args.app_id, marked_name=args.marked_name, marked_comment=args.marked_comment)
    if args.command == "api-enable":
        return client.enable_api(args.app_id, enabled=not args.disabled)
    if args.command == "api-key":
        return client.list_api_keys(args.app_id) if args.list else client.create_api_key(args.app_id)
    if args.command == "export":
        return client.export_dsl(args.app_id, include_secret=args.include_secret, workflow_id=args.workflow_id)
    raise ValueError(f"Unsupported command: {args.command}")


def main() -> int:
    try:
        args = parse_args()
        print_result(run(args), output=args.output)
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
