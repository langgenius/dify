#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from console_lifecycle import (
    DEFAULT_COOKIE_JAR,
    DEFAULT_CONSOLE_BASE,
    ConsoleApiError,
    DifyConsoleClient,
    console_error_to_dict,
    run_preflight_sequence,
)


SCRIPT_DIR = Path(__file__).resolve().parent


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def build_debug_loop_command(args: argparse.Namespace) -> list[str]:
    command = [
        sys.executable,
        str(SCRIPT_DIR / "debug_loop.py"),
        str(args.run_dir),
        "--skip-preflight",
        "--console-base",
        args.console_base,
        "--mode",
        args.mode,
        "--inputs",
        args.inputs,
        "--max-loops",
        str(args.max_loops),
        "--repair-attempts",
        str(args.repair_attempts),
        "--repair-model",
        args.repair_model,
    ]
    if args.cookie_jar:
        command.extend(["--cookie-jar", str(args.cookie_jar)])
    if args.app_id:
        command.extend(["--app-id", args.app_id])
    if args.app_name:
        command.extend(["--name", args.app_name])
    if args.query:
        command.extend(["--query", args.query])
    if args.files:
        command.extend(["--files", args.files])
    if not args.skip_install_missing_dependencies:
        command.append("--install-missing-dependencies")
    if args.no_confirm:
        command.append("--no-confirm")
    if args.no_repair:
        command.append("--no-repair")
    if args.no_normalize_dependencies:
        command.append("--no-normalize-dependencies")
    if args.skip_dependencies:
        command.append("--skip-dependencies")
    if args.no_wait_plugin_install:
        command.append("--no-wait-plugin-install")
    if args.skip_run_records:
        command.append("--skip-run-records")
    if args.include_raw:
        command.append("--include-raw")
    if args.publish:
        command.append("--publish")
    if args.publish_name:
        command.extend(["--publish-name", args.publish_name])
    if args.publish_comment:
        command.extend(["--publish-comment", args.publish_comment])
    if args.enable_api:
        command.append("--enable-api")
    if args.create_api_key:
        command.append("--create-api-key")
    if args.list_api_keys:
        command.append("--list-api-keys")
    if args.export_backup:
        command.append("--export-backup")
    if args.export_include_secret:
        command.append("--export-include-secret")
    if args.service_regression:
        command.append("--service-regression")
    if args.service_api_base:
        command.extend(["--service-api-base", args.service_api_base])
    if args.service_api_key:
        command.extend(["--service-api-key", args.service_api_key])
    if args.service_response_mode:
        command.extend(["--service-response-mode", args.service_response_mode])
    return command


def missing_setup_info(args: argparse.Namespace, preflight: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    init_status = preflight.get("init", {}).get("status") if isinstance(preflight.get("init"), dict) else None
    if init_status == "not_started" and not args.init_password:
        missing.append("INIT_PASSWORD or --init-password")
    if not args.email:
        missing.append("--email")
    if not args.password:
        missing.append("--password")
    if not args.admin_name:
        missing.append("--admin-name")
    return missing


def run_setup_if_requested(client: DifyConsoleClient, args: argparse.Namespace, report: dict[str, Any]) -> bool:
    preflight = report["preflight"][-1]
    missing = missing_setup_info(args, preflight)
    if missing:
        report["blocked"] = {
            "reason": "missing_setup_info",
            "missing": missing,
        }
        return False

    init_status = preflight.get("init", {}).get("status") if isinstance(preflight.get("init"), dict) else None
    if init_status == "not_started" and args.init_password:
        try:
            report["actions"].append(
                {
                    "stage": "init_validate",
                    "result": client.validate_init_password(args.init_password),
                }
            )
        except ConsoleApiError as exc:
            report["errors"].append(console_error_to_dict("init_validate", exc))
            return False

    try:
        report["actions"].append(
            {
                "stage": "setup",
                "result": client.setup(
                    email=args.email,
                    name=args.admin_name,
                    password=args.password,
                    language=args.language,
                ),
            }
        )
    except ConsoleApiError as exc:
        report["errors"].append(console_error_to_dict("setup", exc))
        return False

    return True


def run_login_if_requested(client: DifyConsoleClient, args: argparse.Namespace, report: dict[str, Any]) -> bool:
    if not args.email or not args.password:
        report["blocked"] = {
            "reason": "missing_login_info",
            "missing": [item for item, value in (("--email", args.email), ("--password", args.password)) if not value],
        }
        return False
    try:
        report["actions"].append(
            {
                "stage": "login",
                "result": client.login(args.email, args.password, remember_me=not args.no_remember_me),
            }
        )
        return True
    except ConsoleApiError as exc:
        report["errors"].append(console_error_to_dict("login", exc))
        return False


def run(args: argparse.Namespace) -> int:
    args.run_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output or args.run_dir / "local_ce_closure_report.json"
    client = DifyConsoleClient(
        console_base=args.console_base,
        bearer_token=args.bearer_token,
        csrf_token=args.csrf_token,
        cookie_jar_path=args.cookie_jar,
    )
    report: dict[str, Any] = {
        "run_dir": str(args.run_dir),
        "console_base": args.console_base,
        "preflight": [],
        "actions": [],
        "debug_loop": None,
        "blocked": None,
        "errors": [],
        "ok": False,
    }

    preflight = run_preflight_sequence(client)
    report["preflight"].append(preflight)
    if preflight.get("next_action") == "start_local_dify_ce":
        report["blocked"] = {"reason": "local_ce_not_reachable", "suggested_commands": preflight.get("suggested_commands", [])}
        write_json(report_path, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    if args.dry_run:
        command = build_debug_loop_command(args)
        report["debug_loop"] = {"skipped": True, "reason": "--dry-run", "command": command}
        report["ok"] = preflight.get("ready") is True
        write_json(report_path, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 2

    if preflight.get("next_action") == "setup_local_ce_admin":
        if args.no_setup or not run_setup_if_requested(client, args, report):
            write_json(report_path, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 2
        preflight = run_preflight_sequence(client)
        report["preflight"].append(preflight)

    if preflight.get("next_action") == "login":
        if args.no_login or not run_login_if_requested(client, args, report):
            write_json(report_path, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 2
        preflight = run_preflight_sequence(client)
        report["preflight"].append(preflight)

    if not preflight.get("ready"):
        report["blocked"] = {
            "reason": "preflight_not_ready",
            "next_action": preflight.get("next_action"),
            "suggested_commands": preflight.get("suggested_commands", []),
        }
        write_json(report_path, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    command = build_debug_loop_command(args)
    if args.no_run:
        report["debug_loop"] = {"skipped": True, "reason": "--no-run", "command": command}
        report["ok"] = True
        write_json(report_path, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    completed = subprocess.run(command, cwd=SCRIPT_DIR.parents[1], text=True, capture_output=True)
    report["debug_loop"] = {
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    report["ok"] = completed.returncode == 0
    write_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return completed.returncode


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Dify CE DSL import/debug/publish closure.")
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--console-base", default=DEFAULT_CONSOLE_BASE)
    parser.add_argument("--bearer-token")
    parser.add_argument("--csrf-token")
    parser.add_argument("--cookie-jar", type=Path, default=DEFAULT_COOKIE_JAR)
    parser.add_argument("--email", default=os.environ.get("DIFY_CONSOLE_EMAIL"))
    parser.add_argument("--password", default=os.environ.get("DIFY_CONSOLE_PASSWORD"))
    parser.add_argument("--init-password", default=os.environ.get("DIFY_INIT_PASSWORD") or os.environ.get("INIT_PASSWORD"))
    parser.add_argument("--admin-name", default=os.environ.get("DIFY_CONSOLE_ADMIN_NAME", "Admin"))
    parser.add_argument("--language")
    parser.add_argument("--no-setup", action="store_true")
    parser.add_argument("--no-login", action="store_true")
    parser.add_argument("--no-remember-me", action="store_true")
    parser.add_argument("--no-run", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--app-id")
    parser.add_argument("--app-name")
    parser.add_argument("--mode", choices=["auto", "workflow", "advanced-chat"], default="auto")
    parser.add_argument("--inputs", default="{}")
    parser.add_argument("--query", default="hello")
    parser.add_argument("--files")
    parser.add_argument("--max-loops", type=int, default=2)
    parser.add_argument("--repair-attempts", type=int, default=1)
    parser.add_argument("--repair-model", default=os.environ.get("OPENAI_MODEL", "gpt-5.5"))
    parser.add_argument("--no-confirm", action="store_true")
    parser.add_argument("--no-repair", action="store_true")
    parser.add_argument("--no-normalize-dependencies", action="store_true")
    parser.add_argument("--skip-dependencies", action="store_true")
    parser.add_argument("--skip-install-missing-dependencies", action="store_true")
    parser.add_argument("--no-wait-plugin-install", action="store_true")
    parser.add_argument("--skip-run-records", action="store_true")
    parser.add_argument("--include-raw", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--publish-name")
    parser.add_argument("--publish-comment")
    parser.add_argument("--enable-api", action="store_true")
    parser.add_argument("--create-api-key", action="store_true")
    parser.add_argument("--list-api-keys", action="store_true")
    parser.add_argument("--export-backup", action="store_true")
    parser.add_argument("--export-include-secret", action="store_true")
    parser.add_argument("--service-regression", action="store_true")
    parser.add_argument("--service-api-base")
    parser.add_argument("--service-api-key")
    parser.add_argument("--service-response-mode", choices=["blocking", "streaming"], default="blocking")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    try:
        return run(parse_args())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
