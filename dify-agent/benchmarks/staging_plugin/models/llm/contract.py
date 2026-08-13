"""Pure deterministic response contract shared by the plugin and its tests."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast


MODEL_NAME = "dify-agent-benchmark-deterministic"
MODEL_DELAY_SECONDS = 0.010
SHELL_TOOL_NAME = "shell_run"
CONFIG_SKILL_COUNT = 3
CONFIG_FILE_COUNT = 10
CONFIG_ITEM_BYTES = 4096
CONFIG_ITEM_COUNT = CONFIG_SKILL_COUNT + CONFIG_FILE_COUNT
CONFIG_TOTAL_BYTES = CONFIG_ITEM_COUNT * CONFIG_ITEM_BYTES
CONFIG_EXPECTED_SHA256 = "318fdd5b5ef72c47b2df2890d724cf8fbb4764dee352911f9de8535af4748dc3"
BENCHMARK_REQUEST_PREFIX = "DIFY_BENCHMARK_REQUEST:"

_SUPPORTED_SCENARIOS = frozenset({"basic", "shell", "config"})
_IDENTITY_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
_MARKER_PREFIX = "DIFY_BENCHMARK_MARKER:"
_REQUEST_KEYS = frozenset({"benchmark_run_id", "scenario_id", "scenario_version"})


@dataclass(frozen=True, slots=True)
class BenchmarkIdentity:
    benchmark_run_id: str
    scenario_id: str
    scenario_version: int

    @classmethod
    def from_request(cls, request: Mapping[str, object]) -> "BenchmarkIdentity":
        keys = set(request)
        if keys != set(_REQUEST_KEYS):
            missing = sorted(_REQUEST_KEYS - keys)
            extras = sorted(keys - _REQUEST_KEYS)
            raise ValueError(f"benchmark request keys were invalid: missing={missing!r} extras={extras!r}")
        benchmark_run_id = request.get("benchmark_run_id")
        scenario_id = request.get("scenario_id")
        scenario_version = request.get("scenario_version")
        if not isinstance(benchmark_run_id, str) or not _IDENTITY_PATTERN.fullmatch(benchmark_run_id):
            raise ValueError("benchmark_run_id must contain only benchmark-safe identity characters")
        if not isinstance(scenario_id, str) or scenario_id not in _SUPPORTED_SCENARIOS:
            raise ValueError(f"unsupported benchmark scenario: {scenario_id!r}")
        if not isinstance(scenario_version, int) or isinstance(scenario_version, bool) or scenario_version != 1:
            raise ValueError("scenario_version must be exactly 1")
        return cls(
            benchmark_run_id=benchmark_run_id,
            scenario_id=scenario_id,
            scenario_version=scenario_version,
        )

    def marker(self, *, round_number: int, kind: str) -> str:
        return _MARKER_PREFIX + json.dumps(
            {
                "benchmark_run_id": self.benchmark_run_id,
                "scenario_id": self.scenario_id,
                "scenario_version": self.scenario_version,
                "round": round_number,
                "kind": kind,
            },
            separators=(",", ":"),
            sort_keys=True,
        )


@dataclass(frozen=True, slots=True)
class ResponsePlan:
    round_number: int
    content: str
    finish_reason: str
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_arguments: str | None = None


def build_response_plan(*, identity: BenchmarkIdentity, tool_result_count: int) -> ResponsePlan:
    if tool_result_count < 0:
        raise ValueError("tool_result_count cannot be negative")
    if identity.scenario_id == "basic":
        if tool_result_count:
            raise ValueError("basic benchmark cannot contain a tool result")
        return ResponsePlan(
            round_number=1,
            content=identity.marker(round_number=1, kind="terminal"),
            finish_reason="stop",
        )
    if tool_result_count == 0:
        marker = identity.marker(round_number=1, kind="tool_call")
        return ResponsePlan(
            round_number=1,
            content=marker,
            finish_reason="tool_calls",
            tool_call_id=(
                f"benchmark:{identity.benchmark_run_id}:{identity.scenario_id}:v{identity.scenario_version}:r1"
            ),
            tool_name=SHELL_TOOL_NAME,
            tool_arguments=json.dumps(
                {"script": _runtime_script(identity)},
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
    if tool_result_count == 1:
        return ResponsePlan(
            round_number=2,
            content=identity.marker(round_number=2, kind="terminal"),
            finish_reason="stop",
        )
    raise ValueError("runtime benchmark supports exactly one tool round")


def build_benchmark_request(identity: BenchmarkIdentity) -> str:
    """Build the only accepted public-query envelope."""

    return BENCHMARK_REQUEST_PREFIX + json.dumps(
        {
            "benchmark_run_id": identity.benchmark_run_id,
            "scenario_id": identity.scenario_id,
            "scenario_version": identity.scenario_version,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def parse_benchmark_request(content: object) -> BenchmarkIdentity:
    """Parse one exact, canonical benchmark envelope from a user message."""

    if not isinstance(content, str) or not content.startswith(BENCHMARK_REQUEST_PREFIX):
        raise ValueError(f"latest user message must be exactly {BENCHMARK_REQUEST_PREFIX}<compact JSON>")
    raw_payload = content.removeprefix(BENCHMARK_REQUEST_PREFIX)
    if not raw_payload:
        raise ValueError("benchmark request JSON cannot be empty")
    try:
        decoded = cast(object, json.loads(raw_payload, object_pairs_hook=_unique_object))
    except json.JSONDecodeError as exc:
        raise ValueError("benchmark request JSON was invalid") from exc
    if not isinstance(decoded, dict):
        raise ValueError("benchmark request JSON must be an object")
    pairs = cast(dict[str, object], decoded)
    identity = BenchmarkIdentity.from_request(pairs)
    if content != build_benchmark_request(identity):
        raise ValueError("benchmark request must use the canonical compact JSON encoding")
    return identity


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"benchmark request contained duplicate key {key!r}")
        result[key] = value
    return result


def _runtime_script(identity: BenchmarkIdentity) -> str:
    marker = identity.marker(round_number=1, kind="tool_call")
    if identity.scenario_id == "shell":
        return "\n".join(
            [
                "set -eu",
                "python - <<'PY'",
                f"print({'DIFY_BENCHMARK_SHELL_OK|' + marker!r})",
                "PY",
            ]
        )
    if identity.scenario_id == "config":
        skill_names = [f"benchmark-skill-{index}" for index in range(CONFIG_SKILL_COUNT)]
        file_names = [f"benchmark-file-{index}.bin" for index in range(CONFIG_FILE_COUNT)]
        paths = [
            *(f".dify_conf/skills/benchmark-skill-{index}/SKILL.md" for index in range(CONFIG_SKILL_COUNT)),
            *(f".dify_conf/files/benchmark-file-{index}.bin" for index in range(CONFIG_FILE_COUNT)),
        ]
        return "\n".join(
            [
                "set -eu",
                "rm -rf .dify_conf/skills .dify_conf/files",
                "dify-agent config skills pull --json " + " ".join(skill_names) + " >/dev/null",
                "dify-agent config files pull --json " + " ".join(file_names) + " >/dev/null",
                "python - <<'PY'",
                "from hashlib import sha256",
                "from pathlib import Path",
                f"paths = {paths!r}",
                f"expected_digest = {CONFIG_EXPECTED_SHA256!r}",
                "digest = sha256()",
                "total_bytes = 0",
                "for raw_path in paths:",
                "    payload = Path(raw_path).read_bytes()",
                "    total_bytes += len(payload)",
                "    digest.update(raw_path.encode())",
                "    digest.update(b'\\0')",
                "    digest.update(len(payload).to_bytes(8, 'big'))",
                "    digest.update(payload)",
                "actual_digest = digest.hexdigest()",
                f"if len(paths) != {CONFIG_ITEM_COUNT} or total_bytes != {CONFIG_TOTAL_BYTES} or actual_digest != expected_digest:",
                "    raise SystemExit('DIFY_BENCHMARK_CONFIG_INTEGRITY_FAILED')",
                f"print({('DIFY_BENCHMARK_CONFIG_SHA256|' + marker + f'|items={CONFIG_ITEM_COUNT}|bytes={CONFIG_TOTAL_BYTES}|sha256=')!r} + actual_digest)",
                "PY",
            ]
        )
    raise ValueError(f"scenario {identity.scenario_id!r} has no Runtime script")


__all__ = [
    "BenchmarkIdentity",
    "BENCHMARK_REQUEST_PREFIX",
    "CONFIG_EXPECTED_SHA256",
    "CONFIG_FILE_COUNT",
    "CONFIG_ITEM_COUNT",
    "CONFIG_ITEM_BYTES",
    "CONFIG_SKILL_COUNT",
    "CONFIG_TOTAL_BYTES",
    "MODEL_DELAY_SECONDS",
    "MODEL_NAME",
    "ResponsePlan",
    "SHELL_TOOL_NAME",
    "build_benchmark_request",
    "build_response_plan",
    "parse_benchmark_request",
]
