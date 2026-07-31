from pathlib import Path

import pytest

from benchmarks.capacity import CapacityMatrixPoint
from benchmarks.orchestrator import (
    CapacityOptions,
    _redact_secret_in_directory,
    _services_for_point,
)
from benchmarks.scenario import load_scenario_manifest


def test_local_e2b_requires_credentials_and_selected_concurrency_limit() -> None:
    with pytest.raises(ValueError, match="API_KEY"):
        CapacityOptions(mode="local-e2b")

    with pytest.raises(ValueError, match="at least 20"):
        CapacityOptions(
            mode="local-e2b",
            e2b_api_key="secret",
            e2b_template="template",
            e2b_max_concurrency=10,
        )

    options = CapacityOptions(
        mode="local-e2b",
        e2b_api_key="secret",
        e2b_template="template",
        e2b_max_concurrency=10,
        concurrency=10,
    )
    assert "secret" not in repr(options)


def test_secret_redaction_covers_nested_text_artifacts(tmp_path: Path) -> None:
    nested = tmp_path / "logs"
    nested.mkdir()
    artifact = nested / "service.log"
    artifact.write_text("before e2b-secret after")

    _redact_secret_in_directory(tmp_path, "e2b-secret")

    assert artifact.read_text() == "before [redacted] after"


def test_basic_e2b_point_does_not_start_public_callback_proxy() -> None:
    manifest = load_scenario_manifest()
    basic = CapacityMatrixPoint(
        mode="local-e2b",
        scenario=manifest.get("basic"),
        requested_concurrency=1,
        minimum_successful_runs=100,
    )
    shell = basic.model_copy(update={"scenario": manifest.get("shell")})

    assert _services_for_point(basic) == ("redis", "fake-deps", "agent")
    assert _services_for_point(shell) == ("redis", "fake-deps", "agent", "agent-stub-proxy")
