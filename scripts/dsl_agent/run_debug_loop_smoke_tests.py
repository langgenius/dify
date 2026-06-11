#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path
from typing import Any

import debug_loop
from debug_loop import (
    align_yaml_dependencies_to_current_identifiers,
    collect_workflow_app_logs,
    cleanup_created_app,
    draft_debug_succeeded,
    extract_api_key_token,
    redact_sensitive_values,
    run_post_success_lifecycle,
    validate_post_success_args,
    write_export_artifact,
)
from validator import validate_yaml_text


MINIMAL_DSL = """app:
  description: smoke
  icon: 🤖
  icon_background: '#FFEAD5'
  mode: workflow
  name: smoke
dependencies: []
kind: app
version: 0.6.0
workflow:
  conversation_variables: []
  environment_variables: []
  features:
    file_upload:
      enabled: false
    opening_statement: ''
    retriever_resource:
      enabled: false
    sensitive_word_avoidance:
      enabled: false
    speech_to_text:
      enabled: false
    suggested_questions: []
    suggested_questions_after_answer:
      enabled: false
    text_to_speech:
      enabled: false
      language: ''
      voice: ''
  graph:
    edges:
    - data:
        sourceType: start
        targetType: end
      id: start-source-end-target
      source: start
      sourceHandle: source
      target: end
      targetHandle: target
      type: custom
    nodes:
    - data:
        title: Start
        type: start
        variables:
        - label: query
          required: true
          type: text-input
          variable: query
      id: start
      position:
        x: 0
        y: 0
      sourcePosition: right
      targetPosition: left
      type: custom
    - data:
        outputs:
        - value_selector:
          - start
          - query
          value_type: string
          variable: query
        title: End
        type: end
      id: end
      position:
        x: 300
        y: 0
      sourcePosition: right
      targetPosition: left
      type: custom
    viewport:
      x: 0
      y: 0
      zoom: 1
"""


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def publish(self, app_id: str, marked_name: str | None = None, marked_comment: str | None = None) -> dict[str, Any]:
        self.calls.append({"method": "publish", "app_id": app_id, "marked_name": marked_name, "marked_comment": marked_comment})
        return {"result": "success"}

    def enable_api(self, app_id: str, enabled: bool = True) -> dict[str, Any]:
        self.calls.append({"method": "enable_api", "app_id": app_id, "enabled": enabled})
        return {"result": "success"}

    def list_api_keys(self, app_id: str) -> dict[str, Any]:
        self.calls.append({"method": "list_api_keys", "app_id": app_id})
        return {"data": [{"id": "key-1", "token": "app-secret-token", "created_at": 1}]}

    def export_dsl(self, app_id: str, include_secret: bool = False) -> dict[str, Any]:
        self.calls.append({"method": "export_dsl", "app_id": app_id, "include_secret": include_secret})
        return {"data": MINIMAL_DSL}

    def delete_app(self, app_id: str) -> dict[str, Any]:
        self.calls.append({"method": "delete_app", "app_id": app_id})
        return {"result": "success"}

    def workflow_app_logs(self, app_id: str, *, limit: int = 20, detail: bool = False) -> dict[str, Any]:
        self.calls.append({"method": "workflow_app_logs", "app_id": app_id, "limit": limit, "detail": detail})
        return {"data": [{"id": "log-1", "workflow_run_id": "run-1", "status": "succeeded"}], "total": 1}


def assert_api_key_helpers() -> dict[str, Any]:
    cases = [
        ({"token": "top"}, "top"),
        ({"data": {"token": "nested"}}, "nested"),
        ({"data": [{"token": "first"}]}, "first"),
        ({"data": [{"token": ""}, {"token": "second"}]}, "second"),
    ]
    for payload, expected in cases:
        found = extract_api_key_token(payload)
        if found != expected:
            raise AssertionError(f"expected {expected}, got {found} from {payload}")

    redacted = redact_sensitive_values(
        {
            "token": "top",
            "nested": [{"api_key": "key"}, {"label": "safe"}],
            "Authorization": "Bearer secret",
            "password": "",
        }
    )
    if redacted["token"] != "[redacted]":
        raise AssertionError(f"token was not redacted: {redacted}")
    if redacted["nested"][0]["api_key"] != "[redacted]":
        raise AssertionError(f"api_key was not redacted: {redacted}")
    if redacted["nested"][1]["label"] != "safe":
        raise AssertionError(f"safe value should not be redacted: {redacted}")
    if redacted["Authorization"] != "[redacted]":
        raise AssertionError(f"Authorization was not redacted: {redacted}")
    if redacted["password"] != "":
        raise AssertionError(f"empty password should remain empty: {redacted}")
    return {"name": "api_key_helpers", "valid": True}


def assert_export_artifact() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        output = Path(write_export_artifact(run_dir, {"data": MINIMAL_DSL}))
        yaml_text = output.read_text()
        validation = validate_yaml_text(yaml_text).to_dict()
        if not validation.get("valid"):
            raise AssertionError(f"expected valid exported DSL: {validation}")

        raw_output = Path(write_export_artifact(run_dir, {"raw": MINIMAL_DSL}))
        if raw_output.read_text() != MINIMAL_DSL:
            raise AssertionError("raw export body was not written verbatim")
    return {"name": "export_artifact", "valid": True}


def assert_draft_success_summary() -> dict[str, Any]:
    succeeded = draft_debug_succeeded({"draft_run": {"summary": {"succeeded": True}}, "errors": []})
    failed = draft_debug_succeeded({"draft_run": {"summary": {"succeeded": False}}, "errors": []})
    errored = draft_debug_succeeded({"draft_run": {"summary": {"succeeded": True}}, "errors": [{"message": "boom"}]})
    if not succeeded or failed or errored:
        raise AssertionError(f"unexpected draft success states: {succeeded=}, {failed=}, {errored=}")
    return {"name": "draft_success_summary", "valid": True}


def assert_post_success_lifecycle() -> dict[str, Any]:
    captured: dict[str, Any] = {}
    original_post_json = debug_loop.post_json

    def fake_post_json(url: str, api_key: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        captured["url"] = url
        captured["api_key"] = api_key
        captured["payload"] = payload
        return 200, {"data": {"status": "succeeded", "outputs": payload["inputs"]}}

    debug_loop.post_json = fake_post_json
    try:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            args = argparse.Namespace(
                publish=True,
                publish_name="smoke",
                publish_comment="ok",
                enable_api=True,
                create_api_key=False,
                list_api_keys=True,
                service_api_key=None,
                export_backup=True,
                export_include_secret=False,
                service_regression=True,
                service_api_base="http://localhost/v1",
                console_base="http://localhost",
                service_response_mode="blocking",
            )
            client = FakeClient()
            result = run_post_success_lifecycle(
                client=client,  # type: ignore[arg-type]
                run_dir=run_dir,
                app_id="app-1",
                mode="workflow",
                inputs={"query": "hello"},
                query="ignored",
                args=args,
            )
            if not result.get("ok"):
                raise AssertionError(f"expected ok lifecycle: {result}")
            if captured.get("api_key") != "app-secret-token":
                raise AssertionError(f"service regression did not receive original key: {captured}")
            serialized = json.dumps(result, ensure_ascii=False)
            if "app-secret-token" in serialized:
                raise AssertionError(f"result leaked API key: {serialized}")
            if "[redacted]" not in serialized:
                raise AssertionError(f"result did not include redacted marker: {serialized}")
            exported = (run_dir / "exported.yml").read_text()
            if not validate_yaml_text(exported).to_dict().get("valid"):
                raise AssertionError(f"exported YAML is invalid: {exported}")
    finally:
        debug_loop.post_json = original_post_json
    return {"name": "post_success_lifecycle", "valid": True, "calls": client.calls, "service_url": captured.get("url")}


def assert_post_success_arg_validation() -> dict[str, Any]:
    base_args = {
        "publish": True,
        "publish_name": "x" * 21,
        "publish_comment": "ok",
        "enable_api": True,
        "create_api_key": False,
        "list_api_keys": False,
        "service_api_key": None,
        "export_backup": False,
        "export_include_secret": False,
        "service_regression": False,
        "service_api_base": "http://localhost/v1",
        "console_base": "http://localhost",
        "service_response_mode": "blocking",
    }
    errors = validate_post_success_args(argparse.Namespace(**base_args))
    if not errors or errors[0].get("field") != "publish_name":
        raise AssertionError(f"expected publish_name validation error: {errors}")

    comment_args = argparse.Namespace(**{**base_args, "publish_name": "ok", "publish_comment": "y" * 101})
    errors = validate_post_success_args(comment_args)
    if not errors or errors[0].get("field") != "publish_comment":
        raise AssertionError(f"expected publish_comment validation error: {errors}")

    with tempfile.TemporaryDirectory() as tmp:
        client = FakeClient()
        result = run_post_success_lifecycle(
            client=client,  # type: ignore[arg-type]
            run_dir=Path(tmp),
            app_id="app-1",
            mode="workflow",
            inputs={"query": "hello"},
            query="ignored",
            args=argparse.Namespace(**base_args),
        )
        if result.get("ok"):
            raise AssertionError(f"expected invalid lifecycle result: {result}")
        if client.calls:
            raise AssertionError(f"validation should stop API calls, got: {client.calls}")
    return {"name": "post_success_arg_validation", "valid": True}


def assert_dependency_alignment() -> dict[str, Any]:
    yaml_text = """dependencies:
- type: marketplace
  value:
    marketplace_plugin_unique_identifier: langgenius/openai:0.4.2@newhash
  current_identifier: null
kind: app
"""
    dependency_report = {
        "leaked_dependencies": [
            {
                "type": "marketplace",
                "value": {
                    "marketplace_plugin_unique_identifier": "langgenius/openai:0.4.2@newhash",
                    "version": "0.4.2",
                },
                "current_identifier": "langgenius/openai:0.0.19@oldhash",
            }
        ]
    }
    aligned, report = align_yaml_dependencies_to_current_identifiers(yaml_text, dependency_report)
    if not report.get("changed"):
        raise AssertionError(f"expected dependency alignment to change YAML: {report}")
    if "langgenius/openai:0.0.19@oldhash" not in aligned:
        raise AssertionError(f"expected current identifier in aligned YAML: {aligned}")
    if "langgenius/openai:0.4.2@newhash" in aligned:
        raise AssertionError(f"stale requested identifier remained in aligned YAML: {aligned}")

    mismatched_report = {
        "leaked_dependencies": [
            {
                "type": "marketplace",
                "value": {"marketplace_plugin_unique_identifier": "langgenius/openai:0.4.2@newhash"},
                "current_identifier": "langgenius/anthropic:0.1.0@otherhash",
            }
        ]
    }
    unchanged, unchanged_report = align_yaml_dependencies_to_current_identifiers(yaml_text, mismatched_report)
    if unchanged != yaml_text or unchanged_report.get("changed"):
        raise AssertionError(f"must not align dependencies across plugin ids: {unchanged_report}")

    return {"name": "dependency_alignment", "valid": True, "replacements": report.get("replacements")}


def assert_cleanup_created_app() -> dict[str, Any]:
    client = FakeClient()
    disabled = cleanup_created_app(client=client, app_id="app-1", initial_app_id=None, enabled=False)  # type: ignore[arg-type]
    if disabled.get("skipped") is not True or client.calls:
        raise AssertionError(f"disabled cleanup should not call delete_app: {disabled}, calls={client.calls}")

    existing = cleanup_created_app(client=client, app_id="app-1", initial_app_id="app-1", enabled=True)  # type: ignore[arg-type]
    if existing.get("skipped") is not True or client.calls:
        raise AssertionError(f"existing app cleanup should be skipped: {existing}, calls={client.calls}")

    deleted = cleanup_created_app(client=client, app_id="app-2", initial_app_id=None, enabled=True)  # type: ignore[arg-type]
    if deleted.get("ok") is not True or client.calls[-1] != {"method": "delete_app", "app_id": "app-2"}:
        raise AssertionError(f"created app cleanup did not delete app: {deleted}, calls={client.calls}")

    return {"name": "cleanup_created_app", "valid": True}


def assert_collect_workflow_app_logs() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        client = FakeClient()
        disabled = collect_workflow_app_logs(
            client=client,  # type: ignore[arg-type]
            run_dir=run_dir,
            app_id="app-1",
            mode="workflow",
            iteration=1,
            enabled=False,
            limit=10,
            detail=True,
        )
        if disabled.get("skipped") is not True or client.calls:
            raise AssertionError(f"disabled app log collection should not call API: {disabled}, calls={client.calls}")

        advanced_chat = collect_workflow_app_logs(
            client=client,  # type: ignore[arg-type]
            run_dir=run_dir,
            app_id="app-1",
            mode="advanced-chat",
            iteration=1,
            enabled=True,
            limit=10,
            detail=True,
        )
        if advanced_chat.get("skipped") is not True or client.calls:
            raise AssertionError(f"advanced-chat app log collection should be skipped: {advanced_chat}, calls={client.calls}")

        collected = collect_workflow_app_logs(
            client=client,  # type: ignore[arg-type]
            run_dir=run_dir,
            app_id="app-1",
            mode="workflow",
            iteration=1,
            enabled=True,
            limit=10,
            detail=True,
        )
        artifact = Path(str(collected.get("artifact")))
        if collected.get("ok") is not True or collected.get("count") != 1 or not artifact.exists():
            raise AssertionError(f"expected collected app logs with artifact: {collected}")
        if not (run_dir / "workflow_app_logs.json").exists():
            raise AssertionError("canonical workflow_app_logs.json was not written")

    return {"name": "collect_workflow_app_logs", "valid": True, "calls": client.calls}


def main() -> int:
    cases = [
        assert_api_key_helpers(),
        assert_export_artifact(),
        assert_draft_success_summary(),
        assert_post_success_lifecycle(),
        assert_post_success_arg_validation(),
        assert_dependency_alignment(),
        assert_cleanup_created_app(),
        assert_collect_workflow_app_logs(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
