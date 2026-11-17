"""Collect coverage from the OpenAPI tools' real process boundaries."""

import os
from pathlib import Path

import coverage
import pytest


@pytest.fixture(autouse=True)
def openapi_subprocess_coverage(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    if request.path.name not in {"test_cached_console_openapi.py", "test_generate_swagger_specs.py"}:
        return
    current = coverage.Coverage.current()
    if current is None:
        return
    # Scope process instrumentation to these CLI tests instead of changing how
    # every backend test launches subprocesses. pytest-cov combines the parallel
    # data files with its own report after all fixtures have torn down.
    config = tmp_path / "subprocess-coverage.ini"
    api_root = Path(__file__).resolve().parents[3]
    data_file = current.get_option("run:data_file")
    assert isinstance(data_file, str)
    data_file = str(Path(data_file).absolute())
    omitted = current.get_option("run:omit") or []
    assert isinstance(omitted, list)
    # Children run from temporary directories. Preserve the parent report's
    # exclusions, resolving repository-relative patterns before changing cwd.
    isolated_dev = tmp_path / "api/dev"
    sources = [str(api_root)]
    if request.path.name == "test_cached_console_openapi.py":
        sources.append(str(isolated_dev))
    omit = "\n    ".join(
        [str(Path(pattern).absolute()) for pattern in omitted]
        + [
            str(isolated_dev / name)
            for name in ("__init__.py", "generate_swagger_specs.py", "export_console_openapi.py")
        ]
    )
    patches = ["subprocess", "_exit"]
    if hasattr(os, "fork"):
        patches.extend(["fork", "execv"])
    config.write_text(
        "[run]\n"
        f"data_file = {data_file}\n"
        f"branch = {current.get_option('run:branch')}\n"
        "parallel = true\n"
        "source =\n    " + "\n    ".join(sources) + "\n"
        f"omit =\n    {omit}\n"
        f"patch = {', '.join(patches)}\n"
    )
    monkeypatch.setenv("COVERAGE_PROCESS_START", str(config))
    # CI supplies a relative COVERAGE_FILE, which takes precedence over the ini.
    monkeypatch.setenv("COVERAGE_FILE", data_file)
