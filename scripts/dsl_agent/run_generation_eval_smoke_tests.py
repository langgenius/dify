#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

from run_generation_eval import append_post_success_args, debug_loop_skip_reason, summarize_post_success


def assert_post_success_args() -> dict[str, object]:
    args = argparse.Namespace(
        publish=True,
        publish_name="smoke",
        publish_comment="ok",
        enable_api=True,
        create_api_key=True,
        list_api_keys=False,
        export_backup=True,
        export_include_secret=False,
        service_regression=True,
        service_api_base="http://localhost/v1",
        service_api_key=None,
        service_response_mode="blocking",
        cleanup_app=True,
    )
    cmd: list[str] = []
    append_post_success_args(cmd, args)
    expected = [
        "--publish",
        "--publish-name",
        "smoke",
        "--publish-comment",
        "ok",
        "--enable-api",
        "--create-api-key",
        "--export-backup",
        "--service-regression",
        "--service-api-base",
        "http://localhost/v1",
        "--service-response-mode",
        "blocking",
        "--cleanup-app",
    ]
    if cmd != expected:
        raise AssertionError(f"unexpected post-success args: {cmd}")
    return {"name": "post_success_args", "valid": True}


def assert_post_success_summary() -> dict[str, object]:
    report = {
        "post_success": {
            "ok": True,
            "errors": [],
            "publish": {"result": "success"},
            "api_enable": {"result": "success"},
            "api_key": {"token": "secret-token"},
            "api_key_token_available": True,
            "export": {"artifact": "/tmp/exported.yml"},
            "service_regression": {"ok": True, "status": 200},
            "service_regression_artifact": "/tmp/service_regression.json",
        }
    }
    summary = summarize_post_success(report)
    if summary is None:
        raise AssertionError("expected post-success summary")
    if summary.get("published") is not True or summary.get("api_enabled") is not True:
        raise AssertionError(f"unexpected publish/API summary: {summary}")
    if summary.get("service_regression_status") != 200 or summary.get("service_regression_ok") is not True:
        raise AssertionError(f"unexpected service regression summary: {summary}")
    serialized = json.dumps(summary, ensure_ascii=False)
    if "secret-token" in serialized:
        raise AssertionError(f"summary should not expose API key payload: {serialized}")
    return {"name": "post_success_summary", "valid": True}


def assert_rag_bootstrap_skip_override() -> dict[str, object]:
    case = {
        "debug": {
            "skip": True,
            "bootstrap_rag_dataset": True,
            "reason": "needs dataset",
        }
    }
    skipped = debug_loop_skip_reason(case, argparse.Namespace(bootstrap_rag_dataset=False))
    if skipped != "needs dataset":
        raise AssertionError(f"expected skip reason without bootstrap, got {skipped}")
    bypassed = debug_loop_skip_reason(case, argparse.Namespace(bootstrap_rag_dataset=True))
    if bypassed is not None:
        raise AssertionError(f"expected bootstrap to bypass skip, got {bypassed}")
    return {"name": "rag_bootstrap_skip_override", "valid": True}


def main() -> int:
    cases = [
        assert_post_success_args(),
        assert_post_success_summary(),
        assert_rag_bootstrap_skip_override(),
    ]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
