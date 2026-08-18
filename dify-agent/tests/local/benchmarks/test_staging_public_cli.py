from __future__ import annotations

import json
from pathlib import Path
import sys
from zipfile import ZipFile

from benchmarks import staging_public_cli


def _plugin_package(path: Path) -> Path:
    with ZipFile(path, "w") as archive:
        archive.writestr("manifest.yaml", "version: 0.1.2\ntype: plugin\n")
    return path


def test_cli_fails_before_network_without_confirmation(monkeypatch, capsys) -> None:
    monkeypatch.delenv("BENCH_CONFIRM_STAGING_RUN", raising=False)
    monkeypatch.setenv("BENCH_STAGING_API_KEY", "secret-never-print")
    monkeypatch.setattr(sys, "argv", ["staging-public-cli"])

    assert staging_public_cli.main() == 2
    captured = capsys.readouterr()
    assert "BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK" in captured.err
    assert "secret-never-print" not in captured.err


def test_cli_requires_api_key_from_environment(monkeypatch, capsys) -> None:
    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.delenv("BENCH_STAGING_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", ["staging-public-cli"])

    assert staging_public_cli.main() == 2
    captured = capsys.readouterr()
    assert "BENCH_STAGING_API_KEY must be provided through the environment" in captured.err


def test_cli_rejects_missing_plugin_package_before_network(monkeypatch, capsys, tmp_path: Path) -> None:
    called = False

    def unexpected_network(_request):
        nonlocal called
        called = True
        raise AssertionError("load engine must not start")

    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", "secret-never-print")
    monkeypatch.setattr(staging_public_cli, "run_staging_public_smoke", unexpected_network)
    monkeypatch.setattr(
        sys,
        "argv",
        ["staging-public-cli", "--plugin-package", str(tmp_path / "missing.difypkg")],
    )

    assert staging_public_cli.main() == 2
    assert not called
    captured = capsys.readouterr()
    assert "plugin package was not found" in captured.err
    assert "secret-never-print" not in captured.err


def test_cli_rejects_wrong_plugin_version_before_network(monkeypatch, capsys, tmp_path: Path) -> None:
    package = tmp_path / "old.difypkg"
    with ZipFile(package, "w") as archive:
        archive.writestr("manifest.yaml", "version: 0.1.1\ntype: plugin\n")
    called = False

    def unexpected_network(_request):
        nonlocal called
        called = True
        raise AssertionError("load engine must not start")

    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", "secret-never-print")
    monkeypatch.setattr(staging_public_cli, "run_staging_public_smoke", unexpected_network)
    monkeypatch.setattr(
        sys,
        "argv",
        ["staging-public-cli", "--plugin-package", str(package)],
    )

    assert staging_public_cli.main() == 2
    assert not called
    captured = capsys.readouterr()
    assert "expected 0.1.2, found 0.1.1" in captured.err
    assert "secret-never-print" not in captured.err


def test_cli_persists_redacted_fail_closed_diagnostics_for_worker_crash(
    monkeypatch,
    capsys,
    tmp_path: Path,
) -> None:
    secret = "secret-never-write"
    package = _plugin_package(tmp_path / "plugin.difypkg")
    results_root = tmp_path / "results"
    artifact_dir = results_root / "worker-crash-staging-public-smoke"

    def worker_crash(_request):
        assert artifact_dir.is_dir(), "artifact directory must exist before the worker starts"
        raise RuntimeError(f"isolated public Locust worker failed with exit 2: bearer {secret}")

    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", secret)
    monkeypatch.setattr(staging_public_cli, "run_staging_public_smoke", worker_crash)
    monkeypatch.setattr(staging_public_cli, "_git_identity", lambda: ("a" * 40, True))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "staging-public-cli",
            "--run-id",
            "worker-crash",
            "--plugin-package",
            str(package),
            "--results-root",
            str(results_root),
        ],
    )

    assert staging_public_cli.main() == 2

    diagnostics = json.loads((artifact_dir / "diagnostics.json").read_text(encoding="utf-8"))
    cleanup = json.loads((artifact_dir / "cleanup.json").read_text(encoding="utf-8"))
    assert diagnostics == {
        "cleanup": "unknown",
        "error": "isolated public Locust worker failed with exit 2: bearer [REDACTED]",
        "failure_kind": "worker_crash",
        "failure_stage": "locust_worker",
        "normal_result_written": False,
        "status": "failed",
    }
    assert cleanup["attempted"] is False
    assert cleanup["conversation_deleted"] is False
    assert cleanup["complete"] is False
    assert cleanup["error"].startswith("unknown:")
    assert not (artifact_dir / "result.json").exists()
    log = (artifact_dir / "logs" / "worker-failure.log").read_text(encoding="utf-8")
    assert "cleanup=unknown" in log
    assert secret not in "\n".join(
        path.read_text(encoding="utf-8") for path in artifact_dir.rglob("*") if path.is_file()
    )
    captured = capsys.readouterr()
    assert str(artifact_dir) in captured.err
    assert "[REDACTED]" in captured.err
    assert secret not in captured.err


def test_cli_classifies_timeout_and_invalid_worker_result_diagnostics(
    monkeypatch,
    tmp_path: Path,
) -> None:
    package = _plugin_package(tmp_path / "plugin.difypkg")
    results_root = tmp_path / "results"
    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", "secret-never-write")
    monkeypatch.setattr(staging_public_cli, "_git_identity", lambda: ("a" * 40, True))

    cases = (
        (
            "worker-timeout",
            "isolated public Locust worker exceeded its process timeout",
            "worker_timeout",
        ),
        (
            "worker-invalid",
            "isolated public Locust worker returned an invalid result",
            "worker_invalid_result",
        ),
    )
    for run_id, failure_message, expected_kind in cases:

        def fail_worker(_request, *, message=failure_message):
            raise RuntimeError(message)

        monkeypatch.setattr(staging_public_cli, "run_staging_public_smoke", fail_worker)
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "staging-public-cli",
                "--run-id",
                run_id,
                "--plugin-package",
                str(package),
                "--results-root",
                str(results_root),
            ],
        )

        assert staging_public_cli.main() == 2
        diagnostics_path = results_root / f"{run_id}-staging-public-smoke" / "diagnostics.json"
        diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
        assert diagnostics["failure_kind"] == expected_kind
        assert diagnostics["cleanup"] == "unknown"
        assert diagnostics["normal_result_written"] is False
