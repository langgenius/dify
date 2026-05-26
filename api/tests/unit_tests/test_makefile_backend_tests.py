import subprocess
from pathlib import Path


def test_default_make_test_runs_backend_unit_suites():
    repo_root = Path(__file__).resolve().parents[3]

    completed = subprocess.run(["make", "-n", "test"], cwd=repo_root, check=True, capture_output=True, text=True)
    dry_run_output = completed.stdout

    assert "api/tests/unit_tests" in dry_run_output
    assert "api/providers/vdb/*/tests/unit_tests" in dry_run_output
    assert "api/providers/trace/*/tests/unit_tests" in dry_run_output
    assert "-p no:benchmark" in dry_run_output
    assert "api/tests/unit_tests/controllers" in dry_run_output
    assert "--start-middleware" not in dry_run_output
    assert "api/tests/integration_tests/workflow" not in dry_run_output
    assert "api/tests/test_containers_integration_tests" not in dry_run_output
    assert "--start-vdb" not in dry_run_output
    assert "api/providers/vdb/vdb-chroma/tests/integration_tests" not in dry_run_output


def test_make_test_all_runs_backend_pytest_suites():
    repo_root = Path(__file__).resolve().parents[3]

    completed = subprocess.run(["make", "-n", "test-all"], cwd=repo_root, check=True, capture_output=True, text=True)
    dry_run_output = completed.stdout

    assert "api/tests/unit_tests" in dry_run_output
    assert "api/providers/vdb/*/tests/unit_tests" in dry_run_output
    assert "api/providers/trace/*/tests/unit_tests" in dry_run_output
    assert "-p no:benchmark" in dry_run_output
    assert "--start-middleware" in dry_run_output
    assert "api/tests/integration_tests/workflow" in dry_run_output
    assert "api/tests/integration_tests/tools" in dry_run_output
    assert "api/tests/test_containers_integration_tests" in dry_run_output
    assert "--start-vdb" in dry_run_output
    assert "api/providers/vdb/vdb-chroma/tests/integration_tests" in dry_run_output
    assert "api/providers/vdb/vdb-pgvector/tests/integration_tests" in dry_run_output
    assert "api/providers/vdb/vdb-qdrant/tests/integration_tests" in dry_run_output
    assert "api/providers/vdb/vdb-weaviate/tests/integration_tests" in dry_run_output
