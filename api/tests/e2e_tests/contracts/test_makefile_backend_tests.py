import subprocess
from pathlib import Path


def test_default_make_test_runs_backend_unit_suites():
    repo_root = Path(__file__).resolve().parents[4]

    completed = subprocess.run(["make", "-n", "test"], cwd=repo_root, check=True, capture_output=True, text=True)
    dry_run_output = completed.stdout

    assert "api/tests/unit_tests" in dry_run_output
    assert "api/providers/vdb/*/tests/unit_tests" in dry_run_output
    assert "api/providers/trace/*/tests/unit_tests" in dry_run_output
    assert "-p no:benchmark" in dry_run_output
    assert "api/tests/unit_tests/controllers" in dry_run_output
    assert "--start-middleware" not in dry_run_output
    assert "api/tests/e2e_tests/middleware/workflow" not in dry_run_output
    assert "api/tests/e2e_tests/containers" not in dry_run_output
    assert "--start-vdb" not in dry_run_output
    assert "api/providers/vdb/vdb-chroma/tests/e2e_tests" not in dry_run_output


def test_make_test_all_runs_backend_pytest_suites():
    repo_root = Path(__file__).resolve().parents[4]

    completed = subprocess.run(["make", "-n", "test-all"], cwd=repo_root, check=True, capture_output=True, text=True)
    dry_run_output = completed.stdout

    assert "api/tests/unit_tests" in dry_run_output
    assert "api/providers/vdb/*/tests/unit_tests" in dry_run_output
    assert "api/providers/trace/*/tests/unit_tests" in dry_run_output
    assert "-p no:benchmark" in dry_run_output
    assert "--start-middleware" in dry_run_output
    assert "api/tests/e2e_tests/middleware/workflow" in dry_run_output
    assert "api/tests/e2e_tests/middleware/tools" in dry_run_output
    assert "api/tests/e2e_tests/containers" in dry_run_output
    assert "--start-vdb" in dry_run_output
    assert "api/providers/vdb/vdb-chroma/tests/e2e_tests" in dry_run_output
    assert "api/providers/vdb/vdb-pgvector/tests/e2e_tests" in dry_run_output
    assert "api/providers/vdb/vdb-qdrant/tests/e2e_tests" in dry_run_output
    assert "api/providers/vdb/vdb-weaviate/tests/e2e_tests" in dry_run_output
