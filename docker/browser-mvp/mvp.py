#!/usr/bin/env python3
"""Small reproducible launcher for the optional single-user browser MVP."""

import argparse
import json
import secrets
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DOCKER = ROOT / "docker"
STATE = HERE / "state"
parser = argparse.ArgumentParser()
parser.add_argument(
    "action",
    choices=[
        "prepare",
        "build",
        "up",
        "down",
        "status",
        "provision",
        "accept",
        "local-chrome",
    ],
)
parser.add_argument(
    "--variant", choices=["headless", "novnc", "local-chrome"], default="novnc"
)
args, extra = parser.parse_known_args()
base = [
    "docker",
    "compose",
    "-f",
    "docker-compose.yaml",
    "-f",
    "browser-mvp/compose.yaml",
]
if args.variant != "headless":
    base += ["-f", f"browser-mvp/compose.{args.variant}.yaml"]


def run(command, cwd=ROOT):
    subprocess.run(command, cwd=cwd, check=True)


def script(name, arguments):
    run(
        [
            "uv",
            "run",
            "--project",
            "api",
            "--no-sync",
            "python",
            str(HERE / "scripts" / name),
            *arguments,
        ]
    )


if args.action == "prepare":
    run([sys.executable, str(HERE / "scripts/prepare.py"), *extra])
elif args.action == "build":
    source = json.loads((STATE / "source.json").read_text())["sha"]
    actual = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    if source != actual:
        raise SystemExit(
            "Source SHA changed; use the pinned checkout for this deployment."
        )
    tag = source[:12]
    run(
        [
            "docker",
            "build",
            "-f",
            "api/Dockerfile",
            "--build-arg",
            "COMMIT_SHA=" + source,
            "-t",
            "dify-browser-mvp-api:" + tag,
            ".",
        ]
    )
    run(
        [
            "docker",
            "build",
            "-f",
            "dify-agent/Dockerfile",
            "--build-arg",
            "COMMIT_SHA=" + source,
            "-t",
            "dify-browser-mvp-agent:" + tag,
            ".",
        ]
    )
    run(
        [
            "docker",
            "build",
            "-f",
            "docker/Dockerfile",
            "-t",
            "dify-agent-local-sandbox:browser-mvp-base",
            ".",
        ],
        ROOT / "dify-agent-runtime",
    )
    run([*base, "build", "local_sandbox", "browser", "fixture"], DOCKER)
elif args.action == "up":
    if args.variant == "novnc" and not (STATE / "vnc-password").exists():
        password = secrets.token_hex(4)
        (STATE / "vnc-password.txt").write_text(password + "\n")
        (STATE / "vnc-password.txt").chmod(0o600)
        # x11vnc stores VNC's password encoding; do not print the credential.
        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--user",
                "root",
                "-v",
                str(STATE) + ":/state",
                "--entrypoint",
                "x11vnc",
                "dify-browser-mvp-browser:novnc",
                "-storepasswd",
                password,
                "/state/vnc-password",
            ],
            check=True,
            capture_output=True,
        )
        (STATE / "vnc-password").chmod(0o644)
    if args.variant == "local-chrome" and not (STATE / "host-token").exists():
        raise SystemExit(
            "Run local-chrome first to start the dedicated browser and create its token."
        )
    run(
        [
            *base,
            "up",
            "-d",
            "api",
            "agent_backend",
            "local_sandbox",
            "agent_ssrf_proxy",
            "ssrf_proxy",
            "fixture",
            "browser",
        ],
        DOCKER,
    )
elif args.action == "down":
    run([*base, "down"], DOCKER)  # Deliberately keep all data volumes.
elif args.action == "status":
    run([*base, "ps"], DOCKER)
elif args.action == "provision":
    script("provision.py", extra)
elif args.action == "accept":
    script("accept.py", extra)
elif args.action == "local-chrome":
    script("start-local-chrome.py", extra)
