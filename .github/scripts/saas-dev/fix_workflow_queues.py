#!/usr/bin/env python3
"""Opt-in, SaaS-dev-only repair for SNP-836; never starts a consumer.

Requires Python 3.10+, PyYAML, Docker Compose v2, and the existing API container.
The host's PyYAML is used only to locate YAML scalar spans; the file is not dumped
or reformatted, and neither resolved configuration nor credentials are printed.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

import yaml
from yaml.nodes import MappingNode, ScalarNode

TARGET = Path("/home/ubuntu/langgenius/docker-compose.yaml")
BASE_QUEUES = (
    "dataset",
    "mail",
    "ops_trace",
    "app_deletion",
    "pipeline",
    "workflow_storage",
    "conversation",
    "workflow_based_app_execution",
    "evaluation",
    "new_agent_beta",
)
WORKFLOW_QUEUES = ("workflow_professional", "workflow_team", "workflow_sandbox")


class UnsafeConfiguration(ValueError):
    pass


def field(node, name):
    if not isinstance(node, MappingNode):
        raise UnsafeConfiguration("Expected an explicit YAML mapping")
    matches = [
        (key, value)
        for key, value in node.value
        if isinstance(key, ScalarNode) and key.value == name
    ]
    if len(matches) != 1:
        raise UnsafeConfiguration(f"Expected exactly one explicit {name} field")
    key, value = matches[0]
    if value.start_mark.index < key.end_mark.index:
        raise UnsafeConfiguration(f"Aliased {name} field requires manual review")
    return value


def plan_patch(before):
    """Change only the unique, direct worker queue scalar; return UTF-8 bytes."""
    text = before.decode("utf-8")
    try:
        root = yaml.compose(text, Loader=yaml.SafeLoader)
    except yaml.YAMLError:
        raise UnsafeConfiguration(
            "Invalid YAML; details suppressed to protect credentials"
        ) from None
    worker = field(field(root, "services"), "worker")
    environment = field(worker, "environment")
    queue = field(environment, "CELERY_QUEUES")
    if not isinstance(queue, ScalarNode) or queue.tag != "tag:yaml.org,2002:str":
        raise UnsafeConfiguration("CELERY_QUEUES must be an explicit string")
    if (
        queue.style not in (None, "'", '"')
        or queue.start_mark.line != queue.end_mark.line
    ):
        raise UnsafeConfiguration(
            "Multiline or non-scalar queue syntax requires manual review"
        )
    # Aliases can refer to a scalar outside this service. Never mutate its source.
    if not (
        worker.start_mark.index
        < queue.start_mark.index
        < queue.end_mark.index
        <= worker.end_mark.index
    ):
        raise UnsafeConfiguration("Queue aliases outside worker require manual review")
    current = queue.value.split(",")
    if any(not re.fullmatch(r"[a-z_]+", item) for item in current):
        raise UnsafeConfiguration(
            "Queue interpolation, whitespace, or unsupported syntax requires review"
        )
    if len(current) != len(set(current)):
        raise UnsafeConfiguration("Duplicate queue names require manual review")
    if not set(BASE_QUEUES).issubset(current) or set(current) - set(
        BASE_QUEUES + WORKFLOW_QUEUES
    ):
        raise UnsafeConfiguration(
            "Worker queues differ from the reviewed SaaS dev baseline"
        )
    missing = [item for item in WORKFLOW_QUEUES if item not in current]
    if not missing:
        return before, current, current
    updated = current + missing
    raw = text[queue.start_mark.index : queue.end_mark.index]
    quoted = queue.style or ""
    # Refuse anchors, tags, escapes and aliases instead of rewriting them.
    if raw != quoted + queue.value + quoted:
        raise UnsafeConfiguration("Decorated queue scalar requires manual review")
    replacement = quoted + ",".join(updated) + quoted
    after = (
        text[: queue.start_mark.index] + replacement + text[queue.end_mark.index :]
    ).encode("utf-8")
    if plan_patch(after)[0] != after:
        raise UnsafeConfiguration("Candidate queue patch is not idempotent")
    return after, current, updated


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def safe_command(command, *, input_text=None):
    result = subprocess.run(
        command, input=input_text, text=True, capture_output=True, timeout=45
    )
    if result.returncode:
        raise UnsafeConfiguration(
            "Read-only Docker validation failed; output suppressed to protect credentials"
        )
    return result.stdout


def resolved_config(path):
    return json.loads(
        safe_command(
            [
                "docker",
                "compose",
                "--project-directory",
                str(TARGET.parent),
                "-f",
                str(path),
                "config",
                "--format",
                "json",
            ]
        )
    )


def validate_resolved(before, after, old_queues, new_queues):
    """Catch inherited overrides, YAML ambiguity, and accidental unrelated edits."""
    environment = before["services"]["worker"]["environment"]
    if environment.get("DEPLOYMENT_EDITION") != "CLOUD":
        raise UnsafeConfiguration("Expected CLOUD SaaS dev worker")
    if environment.get("CELERY_WORKER_QUEUES"):
        raise UnsafeConfiguration("CELERY_WORKER_QUEUES overrides CELERY_QUEUES")
    if environment.get("CELERY_QUEUES") != ",".join(old_queues):
        raise UnsafeConfiguration(
            "Resolved queues differ from the explicit queue scalar"
        )
    expected = copy.deepcopy(before)
    expected["services"]["worker"]["environment"]["CELERY_QUEUES"] = ",".join(
        new_queues
    )
    if after != expected:
        raise UnsafeConfiguration(
            "Resolved candidate changes more than worker CELERY_QUEUES"
        )


BROKER_CHECK = r"""
import json, os
from redis import Redis
try:
    if os.environ.get("REDIS_KEY_PREFIX"):
        raise ValueError("Unsupported broker namespace")
    client = Redis.from_url(os.environ["CELERY_BROKER_URL"], socket_timeout=10)
    counts = {}
    for queue in ("workflow_professional", "workflow_team", "workflow_sandbox"):
        name = queue.encode()
        keys = {name, *client.scan_iter(match=name + b"\x06\x16*")}
        counts[queue] = sum(client.llen(key) for key in keys)
    counts["unacked"] = client.hlen("unacked")
    counts["unacked_index"] = client.zcard("unacked_index")
    print(json.dumps(counts))
except Exception:
    print("Broker check failed; details suppressed", file=__import__("sys").stderr)
    raise SystemExit(1)
"""


def validate_broker_environments(config, runtime_environments):
    """Compare credentials only in memory; unsupported broker layouts fail shut."""
    expected = config["services"]["worker"]["environment"].get("CELERY_BROKER_URL")
    if not isinstance(expected, str) or not expected.startswith("redis://"):
        raise UnsafeConfiguration("Only the reviewed direct Redis broker is supported")
    environments = [
        config["services"][service]["environment"] for service in ("api", "worker")
    ]
    for environment in environments + list(runtime_environments):
        if environment.get("CELERY_BROKER_URL") != expected:
            raise UnsafeConfiguration(
                "API/worker broker mismatch; refusing an unreliable backlog check"
            )
        if environment.get("REDIS_KEY_PREFIX"):
            raise UnsafeConfiguration(
                "Redis key prefixes require a separate namespace-aware review"
            )
        for setting in ("CELERY_USE_SENTINEL", "BROKER_USE_SSL"):
            if str(environment.get(setting, "false")).lower() not in (
                "",
                "false",
                "none",
                "0",
            ):
                raise UnsafeConfiguration(
                    "Redis Sentinel or custom TLS requires separate review"
                )


def check_runtime_broker(config):
    workers = safe_command(
        [
            "docker",
            "ps",
            "-q",
            "--filter",
            "label=com.docker.compose.project=langgenius",
            "--filter",
            "label=com.docker.compose.service=worker",
        ]
    ).split()
    if (
        len(workers) != 2
        or config["services"]["worker"].get("deploy", {}).get("replicas") != 2
    ):
        raise UnsafeConfiguration("Expected the reviewed two-worker SaaS dev topology")
    containers = json.loads(
        safe_command(["docker", "inspect", "langgenius-api-1", *workers])
    )
    environments = []
    for container in containers:
        labels = container["Config"].get("Labels", {})
        service = labels.get("com.docker.compose.service")
        if (
            not container["State"]["Running"]
            or service not in ("api", "worker")
            or labels.get("com.docker.compose.project") != "langgenius"
            or labels.get("com.docker.compose.project.config_files") != str(TARGET)
        ):
            raise UnsafeConfiguration(
                "Running containers do not match the reviewed Compose deployment"
            )
        environment = dict(item.split("=", 1) for item in container["Config"]["Env"])
        environments.append(environment)
        if service == "worker":
            if environment.get("CELERY_WORKER_QUEUES"):
                raise UnsafeConfiguration(
                    "Runtime CELERY_WORKER_QUEUES overrides the reviewed queue setting"
                )
            argv = safe_command(
                ["docker", "exec", container["Id"], "cat", "/proc/1/cmdline"]
            ).split("\0")
            if (
                argv.count("-Q") != 1
                or argv.index("-Q") + 1 >= len(argv)
                or argv[argv.index("-Q") + 1] != environment.get("CELERY_QUEUES")
            ):
                raise UnsafeConfiguration(
                    "Runtime worker argv and queue environment differ"
                )
            queues = environment["CELERY_QUEUES"].split(",")
            if set(queues) - set(BASE_QUEUES + WORKFLOW_QUEUES) or not set(
                BASE_QUEUES
            ).issubset(queues):
                raise UnsafeConfiguration(
                    "Runtime queues differ from the reviewed baseline"
                )
    validate_broker_environments(config, environments)


def broker_check(config):
    check_runtime_broker(config)
    counts = json.loads(
        safe_command(
            [
                "docker",
                "exec",
                "-i",
                "langgenius-api-1",
                "/app/api/.venv/bin/python",
                "-",
            ],
            input_text=BROKER_CHECK,
        )
    )
    expected = set(WORKFLOW_QUEUES) | {"unacked", "unacked_index"}
    if set(counts) != expected or any(
        type(value) is not int or value != 0 for value in counts.values()
    ):
        raise UnsafeConfiguration(
            "Workflow backlog or unacked tasks exist; do not start new consumers"
        )
    return counts


def regular_file(path):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise UnsafeConfiguration(
            "Target must be a regular non-symlink, non-hardlinked file"
        )
    return metadata


def private_copy(path, content, metadata, prefix):
    fd, name = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    copy_path = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(handle.fileno(), stat.S_IMODE(metadata.st_mode))
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        return copy_path
    except BaseException:
        copy_path.unlink(missing_ok=True)
        raise


def apply_patch(path, before, after, expected_sha256, validate, preflight):
    """No service operations. Keep an exact backup and fail closed on drift."""
    import fcntl

    if sha256(before) != expected_sha256:
        raise UnsafeConfiguration("Expected SHA256 does not match the reviewed dry-run")
    metadata = regular_file(path)
    with path.open("rb") as original:
        fcntl.flock(original.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if path.read_bytes() != before:
            raise UnsafeConfiguration("Compose changed since the dry-run")
        candidate = private_copy(path, after, metadata, ".snp836-candidate-")
        try:
            validate(candidate)
            preflight()
            if before == after:
                return None
            backup = private_copy(
                path, before, metadata, "docker-compose.yaml.snp836-backup-"
            )
            if backup.read_bytes() != before:
                raise UnsafeConfiguration("Backup verification failed")
            if path.read_bytes() != before or path.stat().st_ino != metadata.st_ino:
                raise UnsafeConfiguration(
                    "Compose changed before replacement; backup retained"
                )
            os.replace(candidate, path)
            if path.read_bytes() != after:
                raise UnsafeConfiguration(
                    f"Post-write verification failed; restore backup {backup}"
                )
            return backup
        finally:
            candidate.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=["saas-dev"])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write only the reviewed queue change; never restart",
    )
    parser.add_argument(
        "--expected-sha256", help="Required with --apply; copy from a fresh dry-run"
    )
    args = parser.parse_args(argv)
    if args.apply and not args.expected_sha256:
        parser.error("--apply requires --expected-sha256")
    try:
        metadata = regular_file(TARGET)
        before = TARGET.read_bytes()
        after, old_queues, new_queues = plan_patch(before)
        resolved_before = resolved_config(TARGET)

        def validate(candidate):
            validate_resolved(
                resolved_before, resolved_config(candidate), old_queues, new_queues
            )

        if args.apply:
            backup = apply_patch(
                TARGET,
                before,
                after,
                args.expected_sha256,
                validate,
                lambda: broker_check(resolved_before),
            )
        else:
            # Compose reads secrets, so keep even a temporary candidate private.
            candidate = private_copy(TARGET, after, metadata, ".snp836-candidate-")
            try:
                validate(candidate)
                broker_check(resolved_before)
            finally:
                candidate.unlink(missing_ok=True)
            backup = None
        print(
            json.dumps(
                {
                    "target": "saas-dev",
                    "path": str(TARGET),
                    "mode": "apply" if args.apply else "dry-run",
                    "changed": before != after,
                    "before_sha256": sha256(before),
                    "after_sha256": sha256(after),
                    "queues_before": old_queues,
                    "queues_after": new_queues,
                    "backup": str(backup) if backup else None,
                    "services_restarted": False,
                },
                indent=2,
            )
        )
    except (
        UnsafeConfiguration,
        OSError,
        KeyError,
        ValueError,
        subprocess.SubprocessError,
    ) as exc:
        # Do not leak subprocess output, YAML snippets, broker URLs, or environment.
        message = (
            str(exc) if isinstance(exc, UnsafeConfiguration) else type(exc).__name__
        )
        parser.exit(1, f"Refused: {message}\n")


if __name__ == "__main__":
    main()
