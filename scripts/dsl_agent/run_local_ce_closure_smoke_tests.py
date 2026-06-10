#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from local_ce_closure import build_debug_loop_command, missing_setup_info


def command_case() -> dict[str, object]:
    args = argparse.Namespace(
        run_dir=Path("scripts/dsl_agent/outputs/demo"),
        console_base="http://localhost",
        cookie_jar=Path("/tmp/dify-cookies.txt"),
        app_id="app-1",
        app_name="Demo App",
        mode="workflow",
        inputs='{"input":"hello"}',
        max_loops=3,
        repair_attempts=2,
        repair_model="gpt-5.5",
        query="hello",
        files=None,
        skip_install_missing_dependencies=False,
        no_confirm=False,
        no_repair=False,
        no_normalize_dependencies=False,
        skip_dependencies=False,
        no_wait_plugin_install=False,
        skip_run_records=False,
        include_raw=False,
        publish=True,
        publish_name="v1",
        publish_comment="smoke",
        enable_api=True,
        create_api_key=True,
        list_api_keys=False,
        export_backup=True,
        export_include_secret=False,
        service_regression=True,
        service_api_base=None,
        service_api_key=None,
        service_response_mode="blocking",
    )
    command = build_debug_loop_command(args)
    required = {
        "--install-missing-dependencies",
        "--publish",
        "--enable-api",
        "--create-api-key",
        "--export-backup",
        "--service-regression",
    }
    missing = sorted(item for item in required if item not in command)
    if missing:
        raise AssertionError(f"debug command missing {missing}: {command}")
    return {"name": "debug_command", "command": command}


def missing_setup_case() -> dict[str, object]:
    args = argparse.Namespace(init_password=None, email=None, password=None, admin_name=None)
    missing = missing_setup_info(args, {"init": {"status": "not_started"}})
    expected = {"INIT_PASSWORD or --init-password", "--email", "--password", "--admin-name"}
    if set(missing) != expected:
        raise AssertionError(f"unexpected missing setup info: {missing}")
    return {"name": "missing_setup_info", "missing": missing}


def main() -> int:
    cases = [command_case(), missing_setup_case()]
    print(json.dumps({"valid": True, "cases": cases}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
